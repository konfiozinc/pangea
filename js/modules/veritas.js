/* ============================================================================
 * PANGEA · js/modules/veritas.js
 * VERITAS — Capa de verificación colectiva de información.
 *
 * Principios de diseño (por qué está hecho así):
 *  · Todo se calcula EN EL DISPOSITIVO. El motor de consenso, el detector de
 *    anomalías y la credibilidad son funciones puras y auditables: cualquiera
 *    puede leerlas, discutirlas y reimplementarlas. No hay caja negra.
 *  · Cada afirmación y cada voto se firman (ECDSA P-256) a través de
 *    ctx.publish → llevan un sobre `.sig` verificable offline años después.
 *  · Un voto por persona y afirmación: el id del voto es DETERMINISTA
 *    (`${claimId}::${huella}`), así que volver a votar REEMPLAZA el voto
 *    anterior en lugar de sumar uno nuevo. Nadie puede inflar un consenso
 *    repitiendo votos desde la misma identidad.
 *  · La única salida de red es la consulta externa de fact-checking, que la
 *    persona dispara explícitamente y que es totalmente opcional.
 * ==========================================================================*/

import { h, icon, scope, clear, fmt, uid, download, jsonFetch, debounce, clamp, copyText } from '../utils.js';
import { Store, COLLECTIONS } from '../store.js';
import { Crypto } from '../crypto.js';

/**
 * Constructor de nodos tolerante.
 *
 * `h(tag, props, ...hijos)` consume SIEMPRE el segundo argumento como objeto de
 * props: si ahí va un nodo o un texto (por ejemplo el primer elemento de un
 * `...array.map(...)`), ese contenido se perdería silenciosamente. `mk` detecta
 * ese caso y lo reinserta como primer hijo, de modo que construir listas y
 * tarjetas es seguro sin tener que escribir `null` en cada llamada.
 */
function mk(tag, props, ...children) {
  const isProps = !!props && typeof props === 'object' && !(props instanceof Node);
  return isProps ? h(tag, props, ...children) : h(tag, null, props, ...children);
}

/* ════════════════════════════ 1. MODELO DE DATOS ═══════════════════════════
 *
 * claims: { id, text, context, category (id de la taxonomía compartida), sources:[{title,url}],
 *           status, lang, createdAt, author:{fingerprint,name,anon}, sig }
 * votes:  { id: `${claimId}::${huella}`, claimId, voter:{fingerprint,name},
 *           value:'true'|'false'|'context'|'unverifiable', evidence, sources:[{title,url}],
 *           at (ms), lang, createdAt, author, sig }
 * ==========================================================================*/

/** Los cuatro veredictos posibles. El orden define el orden visual. */
const VOTE_VALUES = ['true', 'false', 'context', 'unverifiable'];

const VOTE_LABEL_KEY = {
  true: 'veritas.vote.true',
  false: 'veritas.vote.false',
  context: 'veritas.vote.context',
  unverifiable: 'veritas.vote.unverifiable',
};

const VOTE_ICON = { true: 'check', false: 'x', context: 'balance', unverifiable: 'microscope' };

/** Colores de la distribución de votos (coherentes con los tokens del tema). */
const VOTE_COLOR = {
  true: 'var(--accent)',
  false: 'var(--danger)',
  context: 'var(--warn)',
  unverifiable: 'var(--text-faint)',
};

/**
 * PESOS DEL MOTOR DE CONSENSO.
 * Un voto "verdadero" empuja hacia +1, uno "falso" hacia -1. "Falta contexto"
 * es una corrección parcial (la afirmación no es falsa, pero induce a error),
 * así que pesa +0.35. "No verificable" NO es una opinión sobre la verdad:
 * se excluye del denominador para que no diluya el acuerdo.
 */
const VOTE_WEIGHT = { true: 1, false: -1, context: 0.35, unverifiable: 0 };

const WINDOW_BURST_MS = 90_000;   // ventana de ráfaga (90 s)
const WINDOW_RAPID_MS = 20_000;   // ventana de fuego rápido (20 s)
const MIN_VOTES_FOR_STATUS = 5;   // por debajo de 5 votos la votación sigue abierta
const PCT_FOR_CONSENSUS = 66;     // umbral de consenso
const MIN_EVIDENCE = 12;          // longitud mínima de la evidencia (texto o motivo)
const MIN_CLAIM_TEXT = 12;        // longitud mínima del enunciado de una afirmación
const FACT_KEY_KV = 'veritas.factcheck.key';

const FILTERS = [
  { id: 'all', labelKey: 'action.filter' },
  { id: 'abierta', labelKey: 'state.open' },
  { id: 'consenso', labelKey: 'veritas.consensus' },
  { id: 'disputada', labelKey: 'state.disputed' },
];

/* ══════════════════════════ 2. FUNCIONES PURAS ═════════════════════════════
 * Sin DOM, sin IndexedDB, sin red: fáciles de razonar y de probar.
 * ==========================================================================*/

/** Timestamp de un voto: `at` es el momento del juicio; createdAt es el respaldo. */
const tsOf = (rec) => Number((rec && (rec.at || rec.createdAt)) || 0);

/** Normaliza evidencia para comparar: minúsculas, sin espacios redundantes. */
const normEvidence = (v) => String((v && v.evidence) || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Huella acortada para la interfaz: PAN-3F9K…4QW2 */
function shortenFp(fp) {
  const s = String(fp || '');
  if (!s) return '';
  return s.length > 18 ? `${s.slice(0, 7)}…${s.slice(-4)}` : s;
}

/** Sólo permitimos enlaces http/https: nunca `javascript:` ni rutas relativas. */
function safeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

/** Fecha ISO → ms (con validación, porque la API externa puede devolver basura). */
function parseDateMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * MOTOR DE CONSENSO (exacto, sin heurísticas ocultas):
 *
 *   pesos:        true = +1 · false = -1 · context = +0.35 · unverifiable = 0
 *   denominador:  votos con valor true, false o context (los "no verificable"
 *                 quedan excluidos: no son un juicio sobre la verdad)
 *   agreement  =  suma_ponderada / denominador        → rango -1..1
 *   pct        =  round(|agreement| · 100)            → 0..100
 *   positive   =  agreement >= 0                      → el acuerdo apunta a "verdadero"
 *   estado     =  'consenso' si votos >= 5 y pct >= 66
 *                 'disputada' si votos >= 5 y pct < 66
 *                 'abierta'   en cualquier otro caso (aún no hay muestra suficiente)
 *
 * Nota: el módulo de `agreement` se usa para el sello, y su SIGNO indica la
 * dirección. Así una afirmación con 15 votos "falso" produce el mismo sello
 * del 100 % que una con 15 votos "verdadero", pero apuntando al otro lado.
 */
export function consensusOf(votes = []) {
  const counts = { true: 0, false: 0, context: 0, unverifiable: 0 };
  let weightedSum = 0;
  let denominator = 0;

  for (const v of votes) {
    const value = VOTE_VALUES.includes(v && v.value) ? v.value : 'unverifiable';
    counts[value] += 1;
    weightedSum += VOTE_WEIGHT[value];
    if (value !== 'unverifiable') denominator += 1;
  }

  const agreement = denominator ? weightedSum / denominator : 0;
  const pct = Math.round(Math.abs(agreement) * 100);
  const positive = agreement >= 0;
  const total = votes.length;
  const status = total >= MIN_VOTES_FOR_STATUS
    ? (pct >= PCT_FOR_CONSENSUS ? 'consenso' : 'disputada')
    : 'abierta';

  return { counts, weightedSum, denominator, agreement, pct, positive, status, total };
}

/**
 * DETECTOR DE ANOMALÍAS — la parte que protege la deliberación.
 *
 * Una votación legítima tarda: la gente lee, busca, escribe evidencia. La
 * manipulación, en cambio, es rápida y repetitiva. Medimos tres cosas:
 *
 *  1) burstShare — el mayor número de votos que cae dentro de CUALQUIER ventana
 *     deslizante de 90 s, dividido por el total. Se calcula con dos punteros
 *     (O(n log n) por el ordenado): miramos TODAS las ventanas, no sólo la
 *     primera, porque una ráfaga puede empezar en cualquier momento.
 *  2) uniqueEvidenceRatio — evidencias distintas / total de votos. Si 10 votos
 *     comparten la misma evidencia (o ninguno aporta ninguna), no hay
 *     verificación independiente: hay copia.
 *  3) rapidFire — alguna ventana de 20 s con 3 o más votos. En 20 segundos
 *     nadie lee una afirmación, contrasta una fuente y razona su postura.
 *
 * Se marca anomalía cuando:
 *   (burstShare > 0.5 && votos >= 4) || uniqueEvidenceRatio < 0.4 || rapidFire
 *
 * Devolvemos además el conjunto `suspicious` (ids concretos) para poder señalar
 * los votos implicados en la interfaz en lugar de desconfiar de todo el mundo.
 */
const idOfVote = (v) => (v && (v.id || (v.voter && v.voter.fingerprint))) || '';

export function detectAnomaly(votes = []) {
  const n = votes.length;
  const out = {
    flagged: false, total: n,
    burstCount: 0, burstShare: 0, burstFrom: 0, burstTo: 0, burstFlag: false,
    rapidCount: 0, rapidFire: false,
    distinctEvidence: 0, uniqueEvidenceRatio: 1,
    suspicious: new Set(),
  };
  if (!n) return out;

  const rows = votes
    .map((v) => ({ vote: v, at: tsOf(v), ev: normEvidence(v) }))
    .sort((a, b) => a.at - b.at);

  /** Ventana deslizante genérica: devuelve la ventana MÁS poblada de ancho `ms`. */
  const bestWindow = (ms) => {
    let i = 0, best = 0, from = 0, to = 0;
    for (let j = 0; j < rows.length; j++) {
      while (rows[j].at - rows[i].at > ms) i += 1;
      const c = j - i + 1;
      if (c > best) { best = c; from = i; to = j; }
    }
    return { count: best, from, to, rows: rows.slice(from, to + 1) };
  };

  /* 1) Ráfaga de 90 s */
  const burst = bestWindow(WINDOW_BURST_MS);
  out.burstCount = burst.count;
  out.burstShare = burst.count / n;
  out.burstFrom = rows[burst.from] ? rows[burst.from].at : 0;
  out.burstTo = rows[burst.to] ? rows[burst.to].at : 0;
  out.burstFlag = out.burstShare > 0.5 && n >= 4;

  /* 3) Fuego rápido de 20 s */
  const rapid = bestWindow(WINDOW_RAPID_MS);
  out.rapidCount = rapid.count;
  out.rapidFire = rapid.count >= 3;

  /* 2) Diversidad de evidencia. Una cadena vacía cuenta como UN valor distinto:
   * votar sin aportar nada no es verificación independiente. */
  const freq = new Map();
  for (const r of rows) freq.set(r.ev, (freq.get(r.ev) || 0) + 1);
  out.distinctEvidence = freq.size;
  out.uniqueEvidenceRatio = freq.size / n;

  /* Veredicto global */
  out.flagged = out.burstFlag || out.uniqueEvidenceRatio < 0.4 || out.rapidFire;

  /* Votos concretos señalados: los de la ráfaga, los del fuego rápido y los que
   * repiten evidencia ajena (sólo si aportan algo: repetir vacío ya lo castiga
   * uniqueEvidenceRatio, no hace falta estigmatizar cada voto importado). */
  if (out.burstFlag) for (const r of burst.rows) out.suspicious.add(idOfVote(r.vote));
  if (out.rapidFire) for (const r of rapid.rows) out.suspicious.add(idOfVote(r.vote));
  for (const r of rows) if (r.ev && freq.get(r.ev) > 1) out.suspicious.add(idOfVote(r.vote));

  return out;
}

/**
 * CREDIBILIDAD 0..100 — un solo número explicable, no una caja negra:
 *
 *   base            = min(45, round(log2(votos + 1) · 12))   → más votos, más base,
 *                     pero con rendimientos decrecientes (los primeros votos valen más)
 *   evidenceQuality = min(25, round(media_longitud_evidencia / 8)) → evidencia escrita
 *                     y detallada vale más que un "sí" sin argumentos
 *   sourceBonus     = min(15, fuentes_totales · 3)           → fuentes de la afirmación
 *                     + fuentes aportadas en los votos
 *   anomalyPenalty  = 25 si se detectó anomalía, 0 si el patrón es sano
 *   credibilidad    = clamp(base + evidenceQuality + sourceBonus − anomalyPenalty, 0, 100)
 */
export function credibilityOf(votes = [], claim = null, anomaly = null) {
  const n = votes.length;
  const base = Math.min(45, Math.round(Math.log2(n + 1) * 12));

  const lengths = votes.map((v) => String((v && v.evidence) || '').trim().length);
  const avgLen = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const evidenceQuality = Math.min(25, Math.round(avgLen / 8));

  const claimSources = (claim && Array.isArray(claim.sources) ? claim.sources.length : 0);
  const voteSources = votes.reduce((acc, v) => acc + (Array.isArray(v && v.sources) ? v.sources.length : 0), 0);
  const totalSources = claimSources + voteSources;
  const sourceBonus = Math.min(15, totalSources * 3);

  const anomalyPenalty = anomaly && anomaly.flagged ? 25 : 0;
  const value = clamp(base + evidenceQuality + sourceBonus - anomalyPenalty, 0, 100);

  return { value, base, evidenceQuality, sourceBonus, anomalyPenalty, totalSources, avgLen: Math.round(avgLen) };
}

/** Color del anillo según el tramo de credibilidad. */
const credColor = (v) => (v >= PCT_FOR_CONSENSUS ? 'var(--accent)' : v >= 34 ? 'var(--warn)' : 'var(--danger)');

/* ══════════════════════════════ 3. MÓDULO ═════════════════════════════════ */

export default {
  id: 'veritas',
  icon: 'shield',
  accent: 'emerald',
  titleKey: 'veritas.title',
  subKey: 'veritas.sub',

  async mount(root, ctx) {
    const t = (key, params) => ctx.t(key, params);
    const lang = () => ctx.I18n.lang;
    const lite = !!ctx.state.lite;
    const voteLabel = (v) => t(VOTE_LABEL_KEY[v] || 'veritas.votes');
    /* Convención del proyecto: el módulo construye dentro de un `div.view`. */
    const view = mk('div.view');
    root.append(view);
    const s = scope(view);
    const PAGE_SIZE = lite ? 12 : 30;
    const AUTO_VERIFY_MAX = lite ? 0 : 8;   // en nodos ligeros sólo se verifica a demanda

    /* ---------------------------------------------------------- estado ------ */
    let destroyed = false;
    let claims = [];
    let byClaim = new Map();          // claimId → votos ordenados por `at`
    let me = { fingerprint: 'local-anon', name: '—', anon: true };
    let filter = 'all';
    let page = 1;
    let factKey = '';
    let verifyQueue = [];
    let draining = false;
    let drainScheduled = false;

    /* ------------------------------------------------------ referencias ----- */
    const countBadge = mk('span.badge.primary');
    const tabsEl = mk('div.tabs', { role: 'tablist', 'aria-label': t('veritas.title') });
    const statusEl = mk('p.hint', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const listHost = mk('div');

    const fcBodyId = `veritas-fc-${uid('fc')}`;
    const factKeyInput = mk('input.input', {
      type: 'text', spellcheck: 'false', autocomplete: 'off',
      placeholder: t('veritas.factCheckKey'), 'aria-label': t('veritas.factCheckKey'),
    });
    const factStatusEl = mk('p.hint', { role: 'status', 'aria-live': 'polite' });
    const factBadge = mk('span.badge');
    const fcToggleLabel = mk('span', { text: t('action.open') });
    const fcBody = mk('div.card-body.stack', { id: fcBodyId, hidden: true });

    /* --------------------------------------------------------- utilidades --- */
    function announce(message) { statusEl.textContent = message || ''; }

    function setFactStatus(message, kind = '') {
      factStatusEl.textContent = message || '';
      factStatusEl.className = `hint${kind ? ` ${kind}` : ''}`;
    }

    function refreshFactBadge() {
      clear(factBadge);
      if (factKey) {
        factBadge.className = 'badge ok';
        factBadge.append(icon('check', 12), mk('span', { text: t('state.saved') }));
      } else {
        factBadge.className = 'badge';
        factBadge.append(mk('span', { text: t('field.optional') }));
      }
    }

    const isMine = (v) => !!v && !!v.voter && v.voter.fingerprint === me.fingerprint;
    const votesOf = (claimId) => byClaim.get(claimId) || [];
    const statusOf = (claim) => consensusOf(votesOf(claim.id)).status;

    function visibleClaims() {
      if (filter === 'all') return claims;
      return claims.filter((c) => statusOf(c) === filter);
    }

    /* -------------------------------------------------------- anillo SVG --- */
    function ratioRing(value, label, color) {
      const NS = 'http://www.w3.org/2000/svg';
      const R = 22, SIZE = 58, C = 2 * Math.PI * R, c = SIZE / 2;
      const dash = (clamp(value, 0, 100) / 100) * C;
      /* OJO: el nombre no puede ser `mk`, o taparía al constructor de nodos del
       * módulo y el anillo acabaría siendo un elemento SVG llamado
       * "div.ratio-ring". */
      const mkSvg = (name, attrs) => {
        const el = document.createElementNS(NS, name);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
        return el;
      };
      const ringSvg = mkSvg('svg', { width: SIZE, height: SIZE, viewBox: `0 0 ${SIZE} ${SIZE}`, 'aria-hidden': 'true', focusable: 'false' });
      ringSvg.append(
        mkSvg('circle', { cx: c, cy: c, r: R, fill: 'none', stroke: 'var(--border)', 'stroke-width': 5 }),
        mkSvg('circle', {
          cx: c, cy: c, r: R, fill: 'none', stroke: color, 'stroke-width': 5,
          'stroke-linecap': 'round', 'stroke-dasharray': `${dash.toFixed(2)} ${(C - dash).toFixed(2)}`,
        }),
      );
      return mk('div.ratio-ring', {
        style: `width:${SIZE}px;height:${SIZE}px`,
        role: 'img', 'aria-label': `${label}: ${value}/100`, title: `${label}: ${value}/100`,
      }, ringSvg, mk('span.val', { text: String(value) }));
    }

    /* -------------------------------------------------------- medidor ------ */
    function voteMeter(counts, total) {
      const label = `${t('veritas.distribution')}: ${VOTE_VALUES
        .map((v) => `${voteLabel(v)} ${counts[v] || 0}`).join(' · ')}`;
      const meter = mk('div.meter', { role: 'img', 'aria-label': label, title: label });
      if (total > 0) {
        for (const v of VOTE_VALUES) {
          const n = counts[v] || 0;
          if (!n) continue;
          meter.append(mk('span', { style: `width:${((n / total) * 100).toFixed(2)}%;background:${VOTE_COLOR[v]}` }));
        }
      }
      return meter;
    }

    /* -------------------------------------------------------- fuentes ------ */
    function sourceItem(src) {
      const href = safeUrl(src && src.url);
      const title = (src && (src.title || src.url)) || '';
      const inner = mk('div.grow',
        mk('div.sm.bold', { text: fmt.trunc(title, 120) }),
        src && src.url ? mk('div.tiny.dim.break', { text: src.url }) : null,
      );
      return href
        ? mk('a.source-item', { href, target: '_blank', rel: 'noopener noreferrer' }, icon('link', 16), inner)
        : mk('div.source-item', icon('link', 16), inner);
    }

    /* ------------------------------------------- editor de fuentes (form) -- */
    function sourcesEditor(initial = []) {
      const list = mk('div.stack.sm');
      const addRow = (src = {}) => {
        const titleInput = mk('input.input', {
          type: 'text', value: src.title || '',
          placeholder: t('veritas.sourceTitle'), 'aria-label': t('veritas.sourceTitle'),
        });
        const urlInput = mk('input.input', {
          type: 'url', inputmode: 'url', value: src.url || '',
          placeholder: t('veritas.sourceUrl'), 'aria-label': t('veritas.sourceUrl'),
        });
        const row = mk('div.source-item', icon('link', 16),
          mk('div.grow.stack.sm', titleInput, urlInput),
          mk('button.btn.icon.ghost.sm', {
            type: 'button', 'aria-label': t('action.remove'),
            onclick: () => { row.remove(); addBtn.focus(); },
          }, icon('x', 15)),
        );
        list.append(row);
        return row;
      };
      const addBtn = mk('button.btn.sm', {
        type: 'button',
        onclick: () => { const row = addRow(); row.querySelector('input')?.focus(); },
      }, icon('plus', 15), t('veritas.addSource'));

      (Array.isArray(initial) ? initial : []).forEach(addRow);

      const el = mk('div.field',
        mk('span.label', t('veritas.sources')),
        list,
        addBtn,
      );
      const get = () => Array.from(list.querySelectorAll('.source-item')).map((row) => {
        const inputs = row.querySelectorAll('input');
        return { title: (inputs[0] ? inputs[0].value : '').trim(), url: (inputs[1] ? inputs[1].value : '').trim() };
      }).filter((src) => src.url || src.title);
      return { el, get };
    }

    /* -------------------------------------------------------- firma -------- */
    function sigChip(rec, verdictEl) {
      const fp = rec && rec.sig ? rec.sig.fp : null;
      const btn = mk('button.sig', {
        type: 'button',
        title: fp ? t('nexus.signedBy', { fp }) : t('state.unverified'),
        'aria-label': fp ? `${t('action.verify')} · ${t('nexus.signedBy', { fp })}` : t('state.unverified'),
      }, icon(fp ? 'shield' : 'x', 12), mk('span', { text: fp ? shortenFp(fp) : t('state.unverified') }));
      /* Listener directo (no con `scope`): la tarjeta se recrea en cada pintado y
       * un AbortSignal compartido retendría todos los nodos antiguos. */
      if (fp) btn.addEventListener('click', () => { verifyChip(btn, rec, verdictEl, { silent: false }); });
      return btn;
    }

    /** Verifica la firma de un registro y refleja el veredicto (J). */
    async function verifyChip(btn, rec, verdictEl, { silent = false } = {}) {
      if (!rec || !rec.sig || btn.dataset.busy === '1') return null;
      btn.dataset.busy = '1';
      btn.setAttribute('aria-busy', 'true');
      if (verdictEl) { verdictEl.className = 'tiny dim'; verdictEl.textContent = t('veritas.review'); }

      const res = await ctx.verifyRecord(rec);

      let fp = res.fingerprint;
      if (!fp && rec.sig && rec.sig.pub) {
        try {
          fp = await Crypto.fingerprintOf(typeof rec.sig.pub === 'string' ? rec.sig.pub : JSON.stringify(rec.sig.pub));
        } catch { fp = null; }
      }

      btn.classList.toggle('valid', !!res.valid);
      btn.classList.toggle('invalid', !res.valid);
      btn.dataset.busy = '';
      btn.removeAttribute('aria-busy');

      if (verdictEl) {
        verdictEl.className = res.valid ? 'tiny badge ok' : 'tiny badge danger';
        verdictEl.textContent = res.valid ? t('nexus.signatureValid') : t('nexus.signatureInvalid');
      }
      if (!silent) {
        announce(`${res.valid ? t('nexus.signatureValid') : t('nexus.signatureInvalid')} · ${shortenFp(fp || '')}`);
      }
      return res;
    }

    /* Cola de verificación diferida: la criptografía no debe bloquear el pintado. */
    function queueVerify(job) {
      if (lite || destroyed) return;
      verifyQueue.push(job);
      scheduleDrain();
    }

    function scheduleDrain() {
      if (drainScheduled || lite || destroyed) return;
      drainScheduled = true;
      s.timeout(async () => {
        drainScheduled = false;
        if (draining || destroyed) return;
        draining = true;
        while (verifyQueue.length && !destroyed) {
          const job = verifyQueue.shift();
          try { await job(); } catch { /* una firma ilegible no rompe la vista */ }
        }
        draining = false;
      }, 90);
    }

    /* ══════════════════════ 4. TARJETA DE AFIRMACIÓN ═════════════════════ */

    function voterRow(v, anomaly) {
      const suspicious = anomaly.suspicious.has(idOfVote(v));
      const name = (v.voter && v.voter.name) || (v.author && v.author.name) || t('field.author');
      const sources = Array.isArray(v.sources) ? v.sources : [];
      return mk('div.source-item',
        icon(VOTE_ICON[v.value] || 'flag', 16),
        mk('div.grow',
          mk('div.row.gap-2.wrap',
            mk('span.sm.bold', { text: name }),
            mk('span.badge', { text: voteLabel(v.value) }),
            suspicious ? mk('span.badge.warn', {
              title: t('veritas.suspiciousHint'),
              'aria-label': `${t('veritas.suspicious')} · ${t('veritas.suspiciousHint')}`,
            }, icon('sos', 12), t('veritas.suspicious')) : null,
          ),
          v.evidence ? mk('p.sm.dim', { text: fmt.trunc(v.evidence, 220) }) : null,
          mk('div.tiny.faint', { text: fmt.rel(tsOf(v) || Date.now(), lang()) }),
          sources.length ? mk('div.stack.sm.mt-2', ...sources.map(sourceItem)) : null,
        ),
      );
    }

    function claimCard(claim, index) {
      const votes = votesOf(claim.id);
      const cons = consensusOf(votes);
      const anomaly = detectAnomaly(votes);
      const cred = credibilityOf(votes, claim, anomaly);
      const mine = votes.find(isMine) || null;
      const textId = `veritas-claim-${claim.id}`;

      const card = mk('article.card.claim-card', { 'aria-labelledby': textId, 'data-status': cons.status });

      /* — cabecera: categoría + estado + fecha relativa — */
      const catChip = mk('span.chip.static', { title: ctx.catLabel(claim.category) },
        mk('span.cat-dot', { style: `background:${ctx.catColor(claim.category)}` }),
        mk('span', { text: ctx.catLabel(claim.category) }),
      );
      const statusBadge = cons.status === 'consenso'
        ? mk('span.badge.ok', icon('check', 12), t('veritas.claimVerified'))
        : cons.status === 'disputada'
          ? mk('span.badge.warn', icon('balance', 12), t('veritas.claimDisputed'))
          : mk('span.badge.info', icon('clock', 12), t('veritas.votingOpen'));

      const createdMs = Number(claim.createdAt || Date.now());
      card.append(mk('div.row.between.wrap.gap-3',
        mk('div.row.gap-2.wrap', catChip, statusBadge),
        mk('time.tiny.dim', { datetime: new Date(createdMs).toISOString(), text: fmt.rel(createdMs, lang()) }),
      ));

      /* — enunciado — */
      card.append(mk('p.claim-text', { id: textId, text: claim.text }));

      /* — contexto (opcional y secundario; ausente en afirmaciones antiguas) — */
      if (claim.context) {
        card.append(mk('p.sm.dim', { text: String(claim.context).slice(0, 800) }));
      }

      /* — autoría + firma verificable — */
      const authorName = (claim.author && claim.author.name && claim.author.name !== '—')
        ? claim.author.name
        : t('field.author');
      const fp = (claim.author && claim.author.fingerprint) || (claim.sig && claim.sig.fp) || '';
      const hue = fmt.hueOf(fp || authorName);
      const verdictEl = mk('span.tiny.dim');
      const sigBtn = sigChip(claim, verdictEl);
      if (index < AUTO_VERIFY_MAX && claim.sig) {
        queueVerify(() => verifyChip(sigBtn, claim, verdictEl, { silent: true }));
      }
      card.append(mk('div.row.between.wrap.gap-3',
        mk('div.row.gap-2',
          mk('span.avatar.sm', {
            'aria-hidden': 'true',
            style: `background:linear-gradient(135deg, hsl(${hue} 68% 56%), hsl(${(hue + 60) % 360} 68% 48%))`,
            text: fmt.initials(authorName),
          }),
          mk('div',
            mk('div.sm.bold', { text: authorName }),
            fp ? mk('div.tiny.faint.mono', { text: shortenFp(fp) })
               : mk('div.tiny.faint', { text: t('state.unverified') }),
          ),
        ),
        mk('div.row.gap-2.wrap', sigBtn, verdictEl),
      ));

      /* — fuentes de la afirmación — */
      const claimSources = Array.isArray(claim.sources) ? claim.sources : [];
      if (claimSources.length) {
        card.append(mk('div.stack.sm',
          mk('div.section-title', icon('link', 14), t('veritas.sources')),
          ...claimSources.map(sourceItem),
        ));
      }

      /* — consenso: sello + verificadores + distribución — *
       * El sello es una afirmación pública sobre el estado de la deliberación,
       * así que solo se estampa cuando hay algo que afirmar. Una afirmación sin
       * votos mostraría un «0 % de acuerdo» en rojo, que se lee como disputa
       * cuando en realidad significa que nadie ha opinado todavía: en ese caso
       * se muestra el estado «votación abierta» y nada más. */
      const hasVotes = cons.total > 0;
      const sealClass = cons.pct >= PCT_FOR_CONSENSUS ? '' : cons.pct >= 34 ? 'low' : 'bad';
      const sealTitle = `${t('veritas.collective')} · ${t('veritas.consensusSeal')} · ${t('veritas.agreement')} ${cons.pct}% (${cons.positive ? t('veritas.vote.true') : t('veritas.vote.false')})`;
      const seal = hasVotes
        ? mk('div.seal', { class: sealClass, role: 'img', 'aria-label': sealTitle, title: sealTitle },
            mk('span.pct', { text: `${cons.pct}%` }),
            mk('span.lbl', { text: t('veritas.agreement') }))
        : mk('span.badge.info', icon('clock', 13), mk('span', { text: t('veritas.votingOpen') }));
      card.append(mk('div.consensus-head',
        seal,
        mk('div.grow',
          mk('div.row.between.wrap.gap-2',
            mk('span.sm.dim', { text: t('veritas.verifiers', { n: fmt.num(cons.total, lang()) }) }),
            mk('span.tiny.dim', { text: t('veritas.distribution') }),
          ),
          voteMeter(cons.counts, cons.total),
          mk('p.sm.dim', { text: t('veritas.consensusNote') }),
        ),
      ));

      /* — anomalías — *
       * Ética del etiquetado: la marca señala un PATRÓN DE ACTIVIDAD (votos
       * agrupados o evidencia repetida), nunca a una persona ni a una cuenta.
       * Un patrón anómalo no implica mala fe (prisa, copia compartida, un grupo
       * votando a la vez), por eso la interfaz habla de «actividad sospechosa» y
       * exige revisión humana: se describe el patrón, jamás se etiqueta a la
       * persona como si fuera una máquina. */
      if (anomaly.flagged) {
        const pctBurst = Math.round(anomaly.burstShare * 100);
        const pctEv = Math.round(anomaly.uniqueEvidenceRatio * 100);
        const why = (ico, text) => mk('div.why-item', icon(ico, 14), mk('span.mono', { text }));
        card.append(mk('div.stack.sm',
          mk('div.row.gap-2.wrap',
            mk('span.anomaly-flag', icon('sos', 14), t('veritas.anomaly')),
            anomaly.suspicious.size
              ? mk('span.badge.warn', {
                  title: t('veritas.suspiciousHint'),
                  'aria-label': `${t('veritas.suspicious')} · ${fmt.num(anomaly.suspicious.size, lang())} · ${t('veritas.suspiciousHint')}`,
                }, icon('sos', 12), `${t('veritas.suspicious')} · ${fmt.num(anomaly.suspicious.size, lang())}`)
              : null,
          ),
          mk('div.banner.warn', icon('sos', 20),
            mk('div.grow',
              mk('strong', { text: t('veritas.anomalyHint') }),
              mk('div.why-list',
                why(anomaly.burstFlag ? 'sos' : 'clock', `${t('veritas.votes')} ≤ 90 s: ${anomaly.burstCount}/${anomaly.total} · ${pctBurst}%`),
                why(anomaly.uniqueEvidenceRatio < 0.4 ? 'sos' : 'copy', `${t('field.evidence')}: ${anomaly.distinctEvidence}/${anomaly.total} · ${pctEv}%`),
                why(anomaly.rapidFire ? 'sos' : 'bolt', `${t('veritas.suspicious')} ≤ 20 s: ${anomaly.rapidCount}`),
              ),
              mk('p.sm.dim.mt-2', { text: t('veritas.suspiciousHint') }),
            ),
          ),
        ));
      } else {
        card.append(mk('div.row.gap-2',
          mk('span.badge.ok', icon('check', 12), t('veritas.anomalyClear')),
        ));
      }

      /* — credibilidad explicada — */
      card.append(mk('div.row.gap-4.wrap',
        ratioRing(cred.value, t('veritas.credibility'), credColor(cred.value)),
        mk('div.grow',
          mk('div.section-title', icon('chart', 14), t('veritas.credibility')),
          mk('div.tiny.dim', {
            text: [
              `${t('veritas.votes')} +${cred.base}`,
              `${t('field.evidence')} +${cred.evidenceQuality}`,
              `${t('veritas.sources')} +${cred.sourceBonus}`,
              cred.anomalyPenalty ? `${t('veritas.anomaly')} −${cred.anomalyPenalty}` : null,
            ].filter(Boolean).join(' · '),
          }),
        ),
      ));

      /* — votación — */
      card.append(mk('div.vote-row', {
        role: 'group',
        'aria-label': `${t('veritas.votes')}: ${fmt.trunc(claim.text, 70)}`,
      }, ...VOTE_VALUES.map((value) => {
        const chosen = !!(mine && mine.value === value);
        return mk('button.vote-btn', {
          'data-vote': value,
          class: chosen ? 'chosen' : '',
          'aria-pressed': String(chosen),
          'aria-label': `${voteLabel(value)} · ${cons.counts[value] || 0} · ${chosen ? t('veritas.changeVote') : t('veritas.myVote')}`,
          onclick: () => openVoteModal(claim, value, mine),
        },
          icon(VOTE_ICON[value], 18),
          mk('span', { text: voteLabel(value) }),
          mk('span.count', { text: fmt.num(cons.counts[value] || 0, lang()) }),
        );
      })));

      /* — mi voto / cambiar voto — */
      if (mine) {
        card.append(mk('div.row.between.wrap.gap-2',
          mk('div.row.gap-2.wrap',
            mk('span.badge.info', icon('id', 12), t('veritas.myVote')),
            mk('span.badge', { text: voteLabel(mine.value) }),
            mk('span.tiny.faint', { text: fmt.rel(tsOf(mine) || Date.now(), lang()) }),
          ),
          mk('button.btn.sm.link', { type: 'button', onclick: () => openVoteModal(claim, mine.value, mine) }, t('veritas.changeVote')),
        ));
      }

      /* — lista de votos (con marca de patrón de actividad sospechoso) — */
      const votersBox = mk('div.stack.sm', { hidden: true });
      const toggleVoters = mk('button.btn.sm.ghost', {
        type: 'button', 'aria-expanded': 'false',
        onclick: () => {
          const open = votersBox.hidden;
          if (open && votersBox.dataset.filled !== '1') {
            clear(votersBox);
            votersBox.append(...votes.map((v) => voterRow(v, anomaly)));
            votersBox.dataset.filled = '1';
          }
          votersBox.hidden = !open;
          toggleVoters.setAttribute('aria-expanded', String(open));
        },
      }, icon('users', 15), `${t('veritas.votes')} · ${fmt.num(cons.total, lang())}`);

      card.append(mk('div.row.between.wrap.gap-2',
        toggleVoters,
        mk('div.row.gap-2.wrap',
          mk('button.btn.sm', {
            type: 'button',
            onclick: (e) => runFactCheck(claim, e.currentTarget),
          }, icon('search', 15), t('veritas.runFactCheck')),
          mk('button.btn.sm.ghost', {
            type: 'button', 'aria-label': `${t('action.export')}: ${fmt.trunc(claim.text, 40)}`,
            onclick: () => exportClaim(claim, votes, cons, anomaly, cred),
          }, icon('download', 15), t('action.export')),
        ),
      ));
      card.append(votersBox);

      return card;
    }

    /* ═══════════════════════ 5. MODALES DE ACCIÓN ════════════════════════ */

    async function startNewClaim() {
      const identity = await ctx.requireIdentity();
      if (!identity) { ctx.navigate('nexus'); return; }
      openClaimModal();
    }

    function openClaimModal() {
      const taId = `veritas-new-${uid('c')}`;
      const ta = mk('textarea.textarea.tall', {
        id: taId, placeholder: t('veritas.claimPh'), 'aria-label': t('field.description'),
      });
      const counter = mk('span.char-count', { text: `0 / ${MIN_CLAIM_TEXT}` });
      ta.addEventListener('input', () => { counter.textContent = `${ta.value.trim().length} / ${MIN_CLAIM_TEXT}`; });

      const ctxId = `veritas-ctx-${uid('ctx')}`;
      const contextTa = mk('textarea.textarea', {
        id: ctxId, maxlength: '800',
        placeholder: t('field.optional'), 'aria-label': t('field.context'),
      });

      const cats = ctx.categories();
      const options = cats.length ? cats : [{ id: 'conocimiento' }];
      const catSelect = mk('select.select', { 'aria-label': t('field.category') },
        ...options.map((c, i) => mk('option', { value: c.id, selected: i === 0, text: ctx.catLabel(c.id) })),
      );
      /* La primera categoría es la predeterminada; el respaldo evita enviar una
       * categoría vacía si el navegador no fija la opción seleccionada. */
      const chosenCategory = () => catSelect.value || (options[0] && options[0].id) || '';

      const sources = sourcesEditor([]);
      const body = mk('div',
        mk('div.field',
          mk('label.label', { for: taId }, t('field.description'), mk('span.req', { text: '*' })),
          ta, counter,
        ),
        mk('div.field',
          mk('label.label', { for: ctxId }, t('field.context'), mk('span.opt', { text: t('field.optional') })),
          contextTa,
        ),
        mk('div.field', mk('label.label', t('field.category')), catSelect),
        sources.el,
      );

      ctx.openModal({
        title: t('veritas.newClaim'), iconName: 'shield', body,
        actions: [
          { label: t('action.cancel') },
          {
            label: t('action.publish'), variant: 'primary', iconName: 'send',
            onClick: async () => {
              const text = ta.value.trim();
              if (text.length < MIN_CLAIM_TEXT) {
                ctx.toast(t('toast.fieldsRequired'), 'warn');
                ta.focus();
                return false;
              }
              await ctx.publish(COLLECTIONS.claims, {
                text,
                context: contextTa.value.trim(),
                category: chosenCategory(),
                sources: sources.get(),
                status: 'abierta',
              });
              ctx.toast(t('toast.published'), 'ok');
              announce(t('toast.published'));
              await ctx.awardPoints(3, t('veritas.newClaim'));
              return true;
            },
          },
        ],
      });
    }

    function openVoteModal(claim, value, mine) {
      const ta = mk('textarea.textarea', {
        placeholder: t('veritas.evidencePh'), 'aria-label': t('field.evidence'),
        value: mine && mine.evidence ? mine.evidence : '',
      });
      const sources = sourcesEditor(mine && Array.isArray(mine.sources) ? mine.sources : []);
      const body = mk('div',
        mk('p.sm.dim', { text: fmt.trunc(claim.text, 180) }),
        mk('div.row.gap-2.wrap.mb-4',
          mk('span.badge.primary', icon(VOTE_ICON[value], 12), voteLabel(value)),
          mine ? mk('span.badge.warn', { text: t('veritas.changeVote') }) : mk('span.badge', { text: t('veritas.myVote') }),
        ),
        mk('div.field',
          mk('label.label', t('field.evidence'), mk('span.req', { text: '*' })),
          ta,
          mk('span.char-count', { text: t('veritas.needEvidence') }),
        ),
        sources.el,
      );

      let busy = false;
      ctx.openModal({
        title: `${mine ? t('veritas.changeVote') : t('veritas.myVote')} · ${voteLabel(value)}`,
        iconName: 'shield', body,
        actions: [
          { label: t('action.cancel') },
          {
            label: mine ? t('veritas.changeVote') : t('action.publish'),
            variant: 'primary', iconName: 'send',
            onClick: async () => {
              if (busy) return false;
              const evidence = ta.value.trim();
              if (evidence.length < MIN_EVIDENCE) {
                ctx.toast(t('veritas.needEvidence'), 'warn');
                ta.focus();
                return false;
              }
              busy = true;
              /* Id determinista → un voto por identidad y afirmación: revotar
               * REEMPLAZA el registro anterior (Store.put con la misma clave). */
              await ctx.publish(COLLECTIONS.votes, {
                id: `${claim.id}::${me.fingerprint}`,
                claimId: claim.id,
                voter: { fingerprint: me.fingerprint, name: me.name },
                value,
                evidence,
                sources: sources.get(),
                at: Date.now(),
              });
              ctx.toast(t('toast.published'), 'ok');
              announce(`${t('veritas.myVote')}: ${voteLabel(value)}`);
              await ctx.awardPoints(1, t('veritas.votes'));
              return true;
            },
          },
        ],
      });
    }

    /* ═══════════════ 6. VERIFICACIÓN EXTERNA (OPCIONAL) ══════════════════ */

    function showFactResults(claim, matches) {
      const body = mk('div.stack');
      body.append(mk('p.sm.dim', { text: fmt.trunc(claim.text, 220) }));

      if (!matches.length) {
        body.append(mk('p.sm.dim', { text: t('veritas.noResultsExternal') }));
      } else {
        for (const match of matches.slice(0, 12)) {
          const reviews = Array.isArray(match.claimReview) ? match.claimReview : [];
          const dateMs = parseDateMs(match.claimDate);
          body.append(mk('div.source-item', icon('search', 16),
            mk('div.grow',
              mk('div.sm.bold', { text: fmt.trunc(match.text || claim.text, 160) }),
              match.claimant ? mk('div.tiny.dim', { text: `${t('field.author')}: ${match.claimant}` }) : null,
              ...reviews.map((r) => {
                const href = safeUrl(r.url);
                return mk('div.stack.sm.mt-2',
                  mk('div.row.gap-2.wrap',
                    mk('span.badge.info', { text: (r.publisher && r.publisher.name) || t('field.source') }),
                    mk('span.badge.warn', { text: r.textualRating || t('veritas.review') }),
                  ),
                  r.title ? mk('div.sm', { text: fmt.trunc(r.title, 160) }) : null,
                  href ? mk('a.sm.break', { href, target: '_blank', rel: 'noopener noreferrer', text: r.url }) : null,
                  mk('button.btn.sm.ghost', {
                    type: 'button', 'aria-label': `${t('action.copy')} · ${t('field.source')}`,
                    onclick: async () => {
                      const ok = await copyText(String(r.url || ''));
                      ctx.toast(ok ? t('toast.copied') : t('toast.error'), ok ? 'ok' : 'err');
                    },
                  }, icon('copy', 14), t('action.copy')),
                );
              }),
              dateMs ? mk('div.tiny.faint.mt-2', { text: fmt.date(dateMs, lang()) }) : null,
            ),
          ));
        }
      }

      ctx.openModal({
        title: t('veritas.resultsExternal'), iconName: 'search', body,
        actions: [{ label: t('action.close') }],
      });
    }

    /**
     * Consulta la API pública de Google Fact Check Tools. Es la ÚNICA llamada de
     * red del módulo y sólo ocurre cuando la persona pulsa el botón: sin clave,
     * sin conexión o con error, VERITAS sigue funcionando al 100 % en local.
     */
    async function runFactCheck(claim, btn) {
      if (!factKey) {
        ctx.toast(`${t('veritas.factCheck')}: ${t('veritas.factCheckKey')}`, 'warn');
        fcBody.hidden = false;
        fcToggle.setAttribute('aria-expanded', 'true');
        fcToggleLabel.textContent = t('action.close');
        setFactStatus(t('veritas.factCheckKey'), 'error');
        factKeyInput.focus();
        return;
      }
      if (!ctx.state.online) { ctx.toast(t('toast.offline'), 'warn'); setFactStatus(t('state.offline'), 'error'); return; }

      const url = 'https://factchecktools.googleapis.com/v1alpha1/claims:search'
        + `?query=${encodeURIComponent(String(claim.text).slice(0, 300))}`
        + `&languageCode=${encodeURIComponent(ctx.I18n.lang)}`
        + `&key=${encodeURIComponent(factKey)}`;

      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      setFactStatus(t('state.loading'));
      try {
        const data = await jsonFetch(url);
        const matches = Array.isArray(data && data.claims) ? data.claims : [];
        setFactStatus(matches.length
          ? `${t('veritas.resultsExternal')}: ${fmt.num(matches.length, lang())}`
          : t('veritas.noResultsExternal'), matches.length ? 'ok' : '');
        showFactResults(claim, matches);
      } catch (err) {
        setFactStatus(`${t('toast.error')}${err && err.message ? `: ${err.message}` : ''}`, 'error');
        ctx.toast(t('toast.error'), 'err');
      } finally {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
      }
    }

    /* ══════════════════════ 7. EXPORTAR (malla) ══════════════════════════ */

    /** Paquete verificable para llevar por USB, radio o mensajería: incluye los
     *  votos firmados y los números medidos, para que otro nodo audite todo. */
    function exportClaim(claim, votes, cons, anomaly, cred) {
      const payload = {
        format: 'pangea-veritas-claim', spec: '1.0', app: 'PANGEA',
        exportedAt: new Date().toISOString(),
        claim,
        votes,
        weights: VOTE_WEIGHT,
        consensus: {
          weightedSum: cons.weightedSum, denominator: cons.denominator,
          agreement: cons.agreement, pct: cons.pct, status: cons.status, counts: cons.counts,
        },
        anomaly: {
          flagged: anomaly.flagged, burstCount: anomaly.burstCount, burstShare: anomaly.burstShare,
          distinctEvidence: anomaly.distinctEvidence, uniqueEvidenceRatio: anomaly.uniqueEvidenceRatio,
          rapidCount: anomaly.rapidCount, rapidFire: anomaly.rapidFire,
          suspiciousIds: Array.from(anomaly.suspicious),
        },
        credibility: {
          value: cred.value, base: cred.base, evidenceQuality: cred.evidenceQuality,
          sourceBonus: cred.sourceBonus, anomalyPenalty: cred.anomalyPenalty,
        },
      };
      download(`veritas-${String(claim.id).slice(0, 24)}.json`, JSON.stringify(payload, null, 2), 'application/json');
      ctx.toast(t('toast.exported'), 'ok');
    }

    /* ═══════════════════════ 8. PINTADO DE LA VISTA ══════════════════════ */

    function renderTabs() {
      clear(tabsEl);
      for (const f of FILTERS) {
        const count = f.id === 'all' ? claims.length : claims.filter((c) => statusOf(c) === f.id).length;
        const active = filter === f.id;
        tabsEl.append(mk('button.tab', {
          type: 'button', role: 'tab', class: active ? 'active' : '',
          'aria-selected': String(active),
          onclick: () => { filter = f.id; page = 1; renderTabs(); renderList(); },
        },
          mk('span', { text: t(f.labelKey) }),
          mk('span.count', { text: fmt.num(count, lang()) }),
        ));
      }
    }

    function emptyAll() {
      return mk('div.empty', icon('shield', 30),
        mk('div.empty-title', { text: t('veritas.noClaims') }),
        mk('div.empty-body', { text: t('veritas.sub') }),
        mk('button.btn.primary.mt-2', { onclick: startNewClaim }, icon('plus', 18), t('veritas.newClaim')),
      );
    }

    function emptyFiltered() {
      return mk('div.empty', icon('search', 28),
        mk('div.empty-title', { text: t('state.empty') }),
        mk('button.btn.sm.mt-2', {
          onclick: () => { filter = 'all'; page = 1; renderTabs(); renderList(); },
        }, icon('refresh', 15), t('action.reset')),
      );
    }

    function renderList() {
      verifyQueue = [];                 // los nodos anteriores ya no existen
      clear(listHost);
      if (!claims.length) { listHost.append(emptyAll()); return; }

      const visible = visibleClaims();
      if (!visible.length) { listHost.append(emptyFiltered()); return; }

      const slice = visible.slice(0, page * PAGE_SIZE);
      listHost.append(mk('div.grid.grid-auto.wide', ...slice.map((c, i) => claimCard(c, i))));

      if (visible.length > slice.length) {
        const rest = visible.length - slice.length;
        listHost.append(mk('div.row.center.mt-4',
          mk('button.btn', {
            'aria-label': `${t('action.next')} · ${fmt.num(rest, lang())}`,
            onclick: () => { page += 1; renderList(); },
          }, icon('layers', 16), `${t('action.next')} · ${fmt.num(rest, lang())}`),
        ));
      }
    }

    function paint() {
      if (destroyed) return;
      clear(countBadge);
      countBadge.setAttribute('aria-label', `${t('veritas.title')}: ${fmt.num(claims.length, lang())}`);
      countBadge.append(icon('shield', 13), mk('span', { text: fmt.num(claims.length, lang()) }));
      renderTabs();
      renderList();
    }

    /* ══════════════════════ 9. CARGA DESDE EL STORE ══════════════════════ */

    async function load() {
      const [rows, votes, author] = await Promise.all([
        Store.sorted(COLLECTIONS.claims, 'desc'),   // más recientes primero
        Store.all(COLLECTIONS.votes),
        ctx.author(),
      ]);
      if (destroyed) return;
      me = author || me;
      claims = rows;
      byClaim = new Map();
      for (const v of votes) {
        const list = byClaim.get(v.claimId) || [];
        list.push(v);
        byClaim.set(v.claimId, list);
      }
      for (const list of byClaim.values()) list.sort((a, b) => tsOf(a) - tsOf(b));
    }

    const reload = debounce(async () => {
      if (destroyed) return;
      try { await load(); paint(); } catch (e) { console.error('[veritas] recarga', e); }
    }, 120);

    /* ═══════════════════════════ 10. ESTRUCTURA ══════════════════════════ */

    /* Verificación externa opcional: plegada por defecto. */
    const fcToggle = mk('button.btn.sm', {
      type: 'button', 'aria-expanded': 'false', 'aria-controls': fcBodyId,
      onclick: () => {
        const open = fcBody.hidden;
        fcBody.hidden = !open;
        fcToggle.setAttribute('aria-expanded', String(open));
        fcToggleLabel.textContent = open ? t('action.close') : t('action.open');
      },
    }, icon('search', 15), fcToggleLabel);

    fcBody.append(
      mk('p.sm.dim', { text: t('veritas.factCheckHint') }),
      mk('div.field',
        mk('label.label', t('veritas.factCheckKey')),
        mk('div.input-group',
          factKeyInput,
          mk('button.btn', {
            type: 'button',
            onclick: async () => {
              factKey = factKeyInput.value.trim();
              await Store.setKv(FACT_KEY_KV, factKey);
              refreshFactBadge();
              setFactStatus(t('state.saved'), 'ok');
              ctx.toast(t('state.saved'), 'ok');
            },
          }, icon('check', 16), t('action.save')),
        ),
      ),
      factStatusEl,
    );

    const fcCard = mk('section.card.mb-4',
      mk('div.card-head',
        mk('h3.row.gap-2', icon('search', 18), t('veritas.factCheck')),
        mk('div.row.gap-2', factBadge, fcToggle),
      ),
      fcBody,
    );

    view.append(
      mk('header.view-header',
        mk('div.view-heading',
          mk('h1.view-title', icon('shield', 26), t('veritas.title')),
          mk('p.view-sub', { text: t('veritas.sub') }),
        ),
        mk('div.view-actions',
          countBadge,
          mk('button.btn.primary', { onclick: startNewClaim }, icon('plus', 18), t('veritas.newClaim')),
        ),
      ),

      fcCard,
      tabsEl,
      statusEl,
      listHost,
    );

    /* ═════════════════════════ 11. ARRANQUE ═════════════════════════════ */

    factKey = (await Store.kv(FACT_KEY_KV, '')) || '';
    factKeyInput.value = factKey;
    refreshFactBadge();

    await load();
    paint();

    /* El panel deja una intención («Quiero verificar información») para que el
     * formulario se abra solo: quien pulsó el botón no debe buscarlo de nuevo. */
    if (ctx.takeIntent('compose:claim')) openClaimModal();

    const unsubClaims = ctx.onStore(COLLECTIONS.claims, reload);
    const unsubVotes = ctx.onStore(COLLECTIONS.votes, reload);

    /* ═══════════════════════ 12. LIMPIEZA ═══════════════════════════════ */

    return () => {
      destroyed = true;
      verifyQueue = [];
      try { unsubClaims(); } catch { /* el bus ya podía estar vacío */ }
      try { unsubVotes(); } catch { /* idem */ }
      if (reload && typeof reload.cancel === 'function') reload.cancel();
      s.destroy();
    };
  },
};
