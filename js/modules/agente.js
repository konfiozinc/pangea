/* ============================================================================
 * PANGEA · js/modules/agente.js
 * AGENTE — tu representante personal ante la red.
 *
 * Un motor de reglas LOCAL, AUDITABLE y EXPLICABLE. No usa inteligencia
 * artificial externa: puntúa cada problema y cada capacidad de la red con seis
 * reglas transparentes y solo te muestra lo que merece tu atención.
 *
 *  · Funciona sin conexión: la afinidad semántica la resuelve ctx.Engine, que
 *    degrada a embeddings locales (hashing de n-gramas) cuando el modelo
 *    neuronal no está disponible.
 *  · Cada puntuación se muestra siempre desglosada regla a regla. Nunca un
 *    número desnudo: si no puedes auditar la decisión, no es tu agente.
 *  · El motor de lenguaje externo (OpenAI-compatible) es 100 % opcional y su
 *    fallo jamás afecta al resto del módulo.
 *
 * Colecciones: LEE problems/capacities/matches (escritas por SYNAPSE, nunca las
 * muta) y ESCRIBE agents (registro único id 'self') y matches (propuestas).
 * ==========================================================================*/

import { h, icon, scope, clear, fmt, uid, debounce, clamp, jsonFetch } from '../utils.js';
import { Store, COLLECTIONS } from '../store.js';
import { Crypto } from '../crypto.js';

/* ------------------------------------------------------------- Constantes -- */

const SELF_ID = 'self';
const MAX_LOG = 50;                     // decisiones conservadas en el registro
const MAX_SUGGESTIONS = 5;              // sugerencias visibles
const SUGGESTION_THRESHOLD = 55;        // umbral para merecer tu atención
const AUTO_MATCH_THRESHOLD = 75;        // umbral para actuar sin preguntar
const AUTO_MATCH_MAX = 3;               // emparejamientos automáticos por sesión
const DEFAULT_MODEL = 'gpt-4o-mini';
const LLM_TIMEOUT = 8000;
const SAVE_MS = 400;                    // debounce de persistencia (perfil)
const RECOMPUTE_MS = 300;               // debounce de recálculo del motor

const AVAILABILITIES = ['available', 'busy', 'unavailable'];
const AUTONOMIES = ['low', 'mid', 'high'];

/** Pesos de las reglas. Son la ley del agente y están a la vista del usuario. */
const POINTS = Object.freeze({
  AREA: 34,
  AFFINITY: 22,
  URGENCY_CRITICAL: 14,
  URGENCY_HIGH: 8,
  LANG: 10,
  LANG_UNKNOWN: 4,
  AVAILABILITY: 10,
  AVAILABILITY_BUSY: 4,
  SELF: -20,
});

/** Las seis reglas, en el orden en que se muestran y se aplican. */
const RULES = Object.freeze([
  { id: 'area', icon: 'layers' },
  { id: 'affinity', icon: 'spark' },
  { id: 'urgency', icon: 'sos' },
  { id: 'lang', icon: 'translate' },
  { id: 'availability', icon: 'clock' },
  { id: 'self', icon: 'id' },
]);

/** Contadores de sesión (sobreviven a la navegación dentro de la misma página). */
let autoMatchDone = false;
let autoMatchCount = 0;

/* ------------------------------------------------------------- Utilidades -- */

/** Número corto y estable: entero si lo es, un decimal si no. */
function num(n) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Puntos con signo explícito (+7 / −20 / 0). */
function signed(n) {
  const v = Number(n) || 0;
  if (v === 0) return '0';
  return (v > 0 ? '+' : '−') + num(Math.abs(v));
}

/** Vuelca nodos en un contenedor ya existente. */
function paint(el, ...nodes) {
  clear(el);
  for (const n of nodes.flat(Infinity)) if (n) el.append(n);
  return el;
}

/** ¿Existe ya un emparejamiento que toque este registro? (anti-duplicados) */
function matchesRecord(list, id) {
  if (!id) return false;
  return (list || []).some((m) => !!m && (m.needId === id || m.offerId === id));
}

/** Etiqueta de una regla, compuesta solo con claves i18n existentes. */
function ruleLabel(id, ctx) {
  const t = (k, p) => ctx.t(k, p);
  switch (id) {
    case 'area': return `${t('field.category')} · ${t('agente.interests')}`;
    case 'affinity': return t('synapse.semanticClose');
    case 'urgency': return `${t('field.urgency')} · ${t('urgency.critical')}/${t('urgency.high')}`;
    case 'lang': return t('field.language');
    case 'availability': return t('agente.availability');
    case 'self': return `${t('field.author')} = ${t('nexus.title')}`;
    default: return id;
  }
}

/** Peso máximo de una regla, tal como se anuncia en la política. */
function ruleWeight(id, ctx) {
  const t = (k, p) => ctx.t(k, p);
  switch (id) {
    case 'area': return `+${POINTS.AREA}`;
    case 'affinity': return `+${POINTS.AFFINITY} × ${t('synapse.matchScore')}`;
    case 'urgency': return `+${POINTS.URGENCY_CRITICAL} / +${POINTS.URGENCY_HIGH}`;
    case 'lang': return `+${POINTS.LANG} / +${POINTS.LANG_UNKNOWN}`;
    case 'availability': return `+${POINTS.AVAILABILITY} / +${POINTS.AVAILABILITY_BUSY}`;
    case 'self': return `−${Math.abs(POINTS.SELF)}`;
    default: return '';
  }
}

/** Detalle concreto de una regla para el perfil actual (transparencia). */
function ruleDetail(id, agent, me, ctx) {
  const t = (k, p) => ctx.t(k, p);
  const langs = (agent.langs || []).join(' · ');
  switch (id) {
    case 'area': return (agent.areas || []).map((a) => ctx.catLabel(a)).join(', ') || '—';
    case 'affinity': {
      const mode = ctx.Engine && ctx.Engine.state ? ctx.Engine.state.mode : 'local';
      return mode === 'neural' ? t('synapse.engineModel') : t('synapse.engineLocal');
    }
    case 'urgency': return `${t('urgency.critical')} +${POINTS.URGENCY_CRITICAL} · ${t('urgency.high')} +${POINTS.URGENCY_HIGH}`;
    case 'lang': return langs || '—';
    case 'availability': return t(`agente.${AVAILABILITIES.includes(agent.availability) ? agent.availability : 'available'}`);
    case 'self': return me && me.fingerprint ? me.fingerprint : '—';
    default: return '';
  }
}

/** Cadena de consulta del agente: sus áreas + su nombre. */
function agentQuery(agent, ctx) {
  const areas = (agent.areas || []).map((id) => ctx.catLabel(id)).join(', ');
  const name = (agent.name || '').trim();
  return [areas, name].filter(Boolean).join(' ') || ctx.t('agente.interests');
}

/** Traduce urgencia a la variante de insignia existente en components.css. */
function urgencyClass(urgency) {
  if (urgency === 'critical') return 'danger';
  if (urgency === 'high') return 'warn';
  if (urgency === 'medium') return 'info';
  return '';
}

/** Icono del registro de decisiones por tipo de decisión. */
const KIND_ICON = { match: 'handshake', suggest: 'send', skip: 'x', notify: 'bolt' };

/** Nombre legible del tipo de decisión (solo claves i18n existentes). */
function kindLabel(kind, ctx) {
  switch (kind) {
    case 'match': return ctx.t('synapse.tabMatches');
    case 'suggest': return ctx.t('state.suggested');
    case 'skip': return ctx.t('action.skip');
    case 'notify': return ctx.t('agente.notifications');
    default: return ctx.t('agente.logTitle');
  }
}

/* ------------------------------------------------------------ Motor local -- */

/**
 * Puntúa un registro (problema o capacidad) con las seis reglas del agente.
 * Devuelve `{ score, affinity, rules }`, donde cada regla lleva sus puntos ya
 * concedidos para que la interfaz pueda explicar la decisión completa.
 */
async function evaluateRecord(record, agent, me, ctx) {
  const urgency = typeof record.urgency === 'string' ? record.urgency : null;
  const rules = [];

  /* 1 · Área de interés · +34 si la categoría está entre tus áreas. */
  const inArea = !!(record.category && Array.isArray(agent.areas) && agent.areas.includes(record.category));
  rules.push({ id: 'area', points: inArea ? POINTS.AREA : 0, applied: inArea });

  /* 2 · Afinidad semántica · +22 × afinidad (0..1).
   *     ctx.Engine.similarity SIEMPRE resuelve: modelo neuronal si está listo,
   *     embeddings locales si no. NaN y valores fuera de rango se neutralizan. */
  const query = agentQuery(agent, ctx);
  const text = [record.title, record.body].filter(Boolean).join(' ').trim();
  let affinity = 0;
  try {
    affinity = await ctx.Engine.similarity(query, text);
  } catch (e) {
    affinity = 0;
  }
  affinity = clamp(Number.isFinite(affinity) ? affinity : 0, 0, 1);
  rules.push({ id: 'affinity', points: POINTS.AFFINITY * affinity, applied: affinity > 0 });

  /* 3 · Urgencia · +14 crítica · +8 alta · 0 en el resto. */
  const urgencyPoints = urgency === 'critical' ? POINTS.URGENCY_CRITICAL
    : urgency === 'high' ? POINTS.URGENCY_HIGH : 0;
  rules.push({ id: 'urgency', points: urgencyPoints, applied: urgencyPoints > 0 });

  /* 4 · Idioma · +10 si lo hablas · +4 si el registro no declara idioma. */
  const langs = Array.isArray(agent.langs) ? agent.langs : [];
  const langPoints = record.lang
    ? (langs.includes(record.lang) ? POINTS.LANG : 0)
    : POINTS.LANG_UNKNOWN;
  rules.push({ id: 'lang', points: langPoints, applied: langPoints > 0 });

  /* 5 · Disponibilidad · +10 disponible · +4 ocupado solo ante urgencia. */
  let availPoints = 0;
  if (agent.availability === 'available') availPoints = POINTS.AVAILABILITY;
  else if (agent.availability === 'busy' && (urgency === 'critical' || urgency === 'high')) availPoints = POINTS.AVAILABILITY_BUSY;
  rules.push({ id: 'availability', points: availPoints, applied: availPoints > 0 });

  /* 6 · Autoría propia · −20: el agente nunca te empareja contigo. */
  const mine = !!(me && me.fingerprint && record.author && record.author.fingerprint === me.fingerprint);
  rules.push({ id: 'self', points: mine ? POINTS.SELF : 0, applied: mine });

  const raw = rules.reduce((n, r) => n + r.points, 0);
  return { score: clamp(Math.round(raw), 0, 100), affinity, rules };
}

/** ¿El candidato merece interrumpirte? */
function qualifies(agent, score) {
  return score >= SUGGESTION_THRESHOLD && agent.active === true && agent.availability !== 'unavailable';
}

/* ------------------------------------------------------------ Persistencia - */

/** Registro normalizado del agente (tolerante a datos incompletos). */
function normalizeAgent(rec, prefs, ctx) {
  const r = rec && typeof rec === 'object' ? rec : {};
  const llm = Object.assign({ endpoint: '', key: '', model: DEFAULT_MODEL }, r.llm || {});
  if (!llm.endpoint && prefs && prefs.endpoint) llm.endpoint = prefs.endpoint;
  if (!llm.key && prefs && prefs.key) llm.key = prefs.key;
  if (!llm.model) llm.model = DEFAULT_MODEL;
  const langs = Array.isArray(r.langs) ? r.langs.filter((x) => typeof x === 'string') : [];
  return {
    id: SELF_ID,
    name: typeof r.name === 'string' ? r.name : '',
    areas: Array.isArray(r.areas) ? r.areas.filter((x) => typeof x === 'string') : [],
    langs: langs.length ? langs : [ctx.I18n.lang || 'es'],
    availability: AVAILABILITIES.includes(r.availability) ? r.availability : 'available',
    autonomy: AUTONOMIES.includes(r.autonomy) ? r.autonomy : 'mid',
    notify: r.notify !== false,
    autoMatch: r.autoMatch === true,
    active: r.active !== false,
    llm,
    log: Array.isArray(r.log) ? r.log.filter((e) => !!e && typeof e === 'object').slice(0, MAX_LOG) : [],
    createdAt: Number(r.createdAt) || Date.now(),
    updatedAt: Number(r.updatedAt) || Date.now(),
  };
}

/* ------------------------------------------------------------ Controles ---- */

/** Grupo segmentado accesible (usa .segmented de components.css). */
function segmented(ariaLabel, options, current, onPick) {
  const group = h('div.segmented', { role: 'group', 'aria-label': ariaLabel });
  for (const opt of options) {
    group.append(h('button', {
      type: 'button',
      class: opt.value === current ? 'active' : '',
      'aria-pressed': String(opt.value === current),
      on: {
        click: (e) => {
          for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', 'false');
          e.currentTarget.setAttribute('aria-pressed', 'true');
          onPick(opt.value);
        },
      },
    }, opt.label));
  }
  return group;
}

/** Chip conmutable accesible (.chip + aria-pressed). */
function chip(label, active, onToggle, extra = null) {
  return h('button.chip', {
    type: 'button',
    'aria-pressed': String(active),
    on: { click: onToggle },
  }, extra, h('span', { text: label }));
}

/** Interruptor accesible (.switch, la etiqueta envuelve al input). */
function switchRow(checked, label, onChange) {
  return h('label.switch',
    h('input', { type: 'checkbox', checked, on: { change: (e) => onChange(e.target.checked) } }),
    h('span.switch-track'),
    h('span.switch-label', { text: label }),
  );
}

/* ---------------------------------------------------------------- Módulo --- */

export default {
  id: 'agente',
  icon: 'bot',
  accent: 'cyan',
  titleKey: 'agente.title',
  subKey: 'agente.sub',

  async mount(root, ctx) {
    const t = (k, p) => ctx.t(k, p);
    const view = h('div.view');
    root.append(view);
    const s = scope(root);

    /* ------------------------------------------------------ Estado local -- */
    const stored = await Store.get(COLLECTIONS.agents, SELF_ID).catch(() => null);
    const prefs = {
      endpoint: await Store.kv('pref.llm.endpoint', ''),
      key: await Store.kv('pref.llm.key', ''),
    };
    const agent = normalizeAgent(stored, prefs, ctx);
    let me = await Crypto.current().catch(() => null);

    let dirty = false;
    let kvDirty = false;
    const writeAgent = () => {
      if (!dirty) return;
      dirty = false;
      Store.put(COLLECTIONS.agents, { ...agent, updatedAt: Date.now() }).catch(() => {});
    };
    const writeKv = () => {
      if (!kvDirty) return;
      kvDirty = false;
      Store.setKv('pref.llm.endpoint', agent.llm.endpoint).catch(() => {});
      Store.setKv('pref.llm.key', agent.llm.key).catch(() => {});
    };
    const persist = debounce(writeAgent, SAVE_MS);
    const persistKv = debounce(writeKv, SAVE_MS);

    /** Cualquier cambio del perfil se guarda y recalcula el motor. */
    const save = (opts = {}) => {
      dirty = true;
      agent.updatedAt = Date.now();
      persist();
      if (opts.recompute !== false) scheduleRecompute();
    };

    const flushAll = () => {
      persist.cancel();
      persistKv.cancel();
      writeAgent();
      writeKv();
    };

    /* El cierre de pestaña no debe perder el último cambio. */
    s.on(window, 'beforeunload', flushAll);

    /* ------------------------------------------------- Encabezado / estado */
    const statusBadge = h('span.badge');
    const availBadge = h('span.badge');
    const rulesBadge = h('span.badge');
    const evaluatedBadge = h('span.badge');

    view.append(h('div.view-header',
      h('div.view-heading',
        h('h1.view-title', icon('bot', 26), h('span', { text: t('agente.title') })),
        h('p.view-sub', { text: t('agente.sub') }),
      ),
      h('div.view-actions', statusBadge, availBadge, rulesBadge, evaluatedBadge),
    ));

    /* Aviso de soberanía: todo ocurre en tu dispositivo. */
    view.append(h('div.banner', { role: 'note' },
      icon('lock', 20),
      h('div',
        h('strong', { text: t('agente.simulated') }),
        h('div', { text: t('app.localFirst') }),
      ),
    ));

    const topGrid = h('div.grid.grid-2.mt-6');
    view.append(topGrid);

    /* --------------------------------------------------------- Orb + perfil */
    const orb = h('div.agent-orb', { 'aria-hidden': 'true' }, icon('bot', 32));

    const nameInput = h('input#agente-name.input', {
      type: 'text',
      value: agent.name,
      placeholder: t('agente.agentNamePh'),
      maxlength: '60',
      autocomplete: 'off',
      'aria-label': t('agente.agentName'),
      on: { input: (e) => { agent.name = e.target.value; save(); } },
    });

    const availabilitySeg = segmented(t('agente.availability'), [
      { value: 'available', label: t('agente.available') },
      { value: 'busy', label: t('agente.busy') },
      { value: 'unavailable', label: t('agente.unavailable') },
    ], agent.availability, (value) => {
      agent.availability = value;
      save();
      paintStatus();
      paintRuleDetails();
    });

    const autonomyHint = h('p.hint', { text: t(`agente.autonomy.${agent.autonomy}`) });

    const autonomySeg = segmented(t('agente.autonomy'), [
      { value: 'low', label: t('agente.autonomy.low') },
      { value: 'mid', label: t('agente.autonomy.mid') },
      { value: 'high', label: t('agente.autonomy.high') },
    ], agent.autonomy, (value) => {
      agent.autonomy = value;
      save();
      autonomyHint.textContent = t(`agente.autonomy.${value}`);
      paintSuggestions();
    });

    const areasChips = h('div.chips', { role: 'group', 'aria-label': t('agente.interests') });
    const langsChips = h('div.chips', { role: 'group', 'aria-label': t('agente.languages') });

    const activateBtn = h('button.btn', { type: 'button', on: { click: () => toggleActive() } });

    function paintAreas() {
      clear(areasChips);
      const cats = ctx.categories() || [];
      if (!cats.length) {
        areasChips.append(h('span.hint', { text: t('state.empty') }));
        return;
      }
      for (const c of cats) {
        const on = agent.areas.includes(c.id);
        areasChips.append(chip(ctx.catLabel(c.id), on, (e) => {
          const i = agent.areas.indexOf(c.id);
          if (i >= 0) agent.areas.splice(i, 1); else agent.areas.push(c.id);
          /* Se actualiza en el sitio para no perder el foco del teclado. */
          e.currentTarget.setAttribute('aria-pressed', String(i < 0));
          save();
          paintRuleDetails();
        }, h('span.cat-dot', { style: `background:${ctx.catColor(c.id)}` })));
      }
    }

    function paintLangs() {
      clear(langsChips);
      for (const lang of ctx.I18n.LANGUAGES) {
        const on = agent.langs.includes(lang.code);
        langsChips.append(chip(`${lang.flag} ${lang.native}`, on, (e) => {
          const i = agent.langs.indexOf(lang.code);
          if (i >= 0) agent.langs.splice(i, 1); else agent.langs.push(lang.code);
          e.currentTarget.setAttribute('aria-pressed', String(i < 0));
          save();
          paintRuleDetails();
        }));
      }
    }

    function paintOrb() {
      orb.className = 'agent-orb ' + (agent.active ? 'active' : 'idle');
    }

    function paintActivate() {
      activateBtn.className = 'btn ' + (agent.active ? '' : 'primary');
      paint(activateBtn,
        icon(agent.active ? 'pause' : 'play', 18),
        h('span', { text: agent.active ? t('agente.deactivate') : t('agente.activate') }),
      );
      activateBtn.setAttribute('aria-pressed', String(agent.active));
    }

    function toggleActive() {
      agent.active = !agent.active;
      save();
      paintOrb();
      paintActivate();
      paintStatus();
      paintSuggestions();
    }

    const profileCard = h('div.card',
      h('div.card-head',
        h('h3.row.gap-2', icon('id', 18), h('span', { text: t('agente.agentName') })),
        activateBtn,
      ),
      h('div.card-body.stack.sm',
        h('div.agent-card',
          orb,
          h('div.grow.stack.sm',
            h('div.field',
              h('label.label', { for: 'agente-name', text: t('agente.agentName') }),
              nameInput,
            ),
            h('div.field',
              h('span.label', { text: t('agente.availability') }),
              availabilitySeg,
            ),
          ),
        ),
        h('div.field',
          h('span.label', { text: t('agente.interests') }),
          areasChips,
        ),
        h('div.field',
          h('span.label', { text: t('agente.languages') }),
          langsChips,
        ),
        h('div.field',
          h('span.label', { text: t('agente.autonomy') }),
          autonomySeg,
          autonomyHint,
        ),
        h('div.stack.sm.mt-2',
          switchRow(agent.notify, t('agente.notifications'), (on) => { agent.notify = on; save(); }),
          switchRow(agent.autoMatch, t('agente.autoMatch'), (on) => { agent.autoMatch = on; save(); }),
        ),
      ),
    );

    /* ------------------------------------------------------- Política visible */
    const ruleDetailNodes = new Map();
    const rulesList = h('div.stack.sm');
    for (const rule of RULES) {
      const detail = h('div.tiny.dim');
      ruleDetailNodes.set(rule.id, detail);
      rulesList.append(h('div.rule-row',
        h('div.row.gap-3',
          icon(rule.icon, 18),
          h('div',
            h('div', { text: ruleLabel(rule.id, ctx) }),
            detail,
          ),
        ),
        h('span.rule-weight', { text: ruleWeight(rule.id, ctx) }),
      ));
    }

    function paintRuleDetails() {
      for (const rule of RULES) {
        const node = ruleDetailNodes.get(rule.id);
        if (node) node.textContent = ruleDetail(rule.id, agent, me, ctx);
      }
    }

    const rulesCard = h('div.card',
      h('div.card-head',
        h('h3.row.gap-2', icon('balance', 18), h('span', { text: t('agente.rulesTitle') })),
        h('span.badge.primary', { text: String(RULES.length) }),
      ),
      h('div.card-body.stack.sm',
        h('p.sm.dim', { text: t('agente.rulesBody') }),
        rulesList,
      ),
    );

    topGrid.append(profileCard, rulesCard);

    /* ------------------------------------------------------------ Sugerencias */
    const suggestionsBox = h('div.stack.sm', { 'aria-live': 'polite', 'aria-busy': 'false' });
    const suggestionsCount = h('span.badge.primary');
    const busySpinner = h('span.spinner.sm', { hidden: true, 'aria-hidden': 'true' });
    const engineState = { evaluated: 0, suggestions: [], matches: [] };

    const refreshBtn = h('button.btn.icon.ghost.sm', {
      type: 'button',
      'aria-label': t('action.refresh'),
      title: t('action.refresh'),
      on: { click: () => recompute() },
    }, icon('refresh', 16));

    const suggestionsCard = h('div.card.mt-4',
      h('div.card-head',
        h('h3.row.gap-2', icon('handshake', 18), h('span', { text: t('agente.suggestions') })),
        h('div.row.gap-2', busySpinner, suggestionsCount, refreshBtn),
      ),
      h('div.card-body', suggestionsBox),
    );
    view.append(suggestionsCard);

    /* ------------------------------------------------------------------ Log -- */
    const logBox = h('div.stack.sm');
    const logCount = h('span.badge');

    const clearLogBtn = h('button.btn.icon.ghost.sm', {
      type: 'button',
      'aria-label': t('action.reset'),
      title: t('action.reset'),
      on: { click: () => clearLog() },
    }, icon('refresh', 16));

    const logCard = h('div.card',
      h('div.card-head',
        h('h3.row.gap-2', icon('clock', 18), h('span', { text: t('agente.logTitle') })),
        h('div.row.gap-2', logCount, clearLogBtn),
      ),
      h('div.card-body', logBox),
    );

    /* ------------------------------------------------- Motor de lenguaje (opt) */
    const llmStatus = h('div', { role: 'status', 'aria-live': 'polite' });

    const llmEndpoint = h('input#agente-llm-endpoint.input', {
      type: 'url',
      value: agent.llm.endpoint,
      placeholder: 'https://localhost:11434/v1',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': t('agente.llmEndpoint'),
      on: { input: (e) => { agent.llm.endpoint = e.target.value; kvDirty = true; persistKv(); save({ recompute: false }); } },
    });

    const llmKey = h('input#agente-llm-key.input', {
      type: 'password',
      value: agent.llm.key,
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': t('agente.llmKey'),
      on: { input: (e) => { agent.llm.key = e.target.value; kvDirty = true; persistKv(); save({ recompute: false }); } },
    });

    const llmModel = h('input#agente-llm-model.input', {
      type: 'text',
      value: agent.llm.model,
      placeholder: DEFAULT_MODEL,
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': `${t('agente.llmTitle')} · ${t('field.name')}`,
      on: { input: (e) => { agent.llm.model = e.target.value; save({ recompute: false }); } },
    });

    const llmTestBtn = h('button.btn', {
      type: 'button',
      on: { click: () => testLLM() },
    }, icon('bolt', 16), h('span', { text: t('agente.llmTest') }));

    const llmCard = h('div.card',
      h('div.card-head',
        h('h3.row.gap-2', icon('spark', 18), h('span', { text: t('agente.llmTitle') })),
        h('span.badge', t('field.optional')),
      ),
      h('div.card-body.stack.sm',
        h('p.sm.dim', { text: t('agente.llmBody') }),
        h('div.field',
          h('label.label', { for: 'agente-llm-endpoint' },
            h('span', { text: t('agente.llmEndpoint') }),
            h('span.opt', { text: t('field.optional') }),
          ),
          llmEndpoint,
        ),
        h('div.field',
          h('label.label', { for: 'agente-llm-key' },
            h('span', { text: t('agente.llmKey') }),
            h('span.opt', { text: t('field.optional') }),
          ),
          llmKey,
        ),
        h('div.field',
          h('label.label', { for: 'agente-llm-model' },
            h('span', { text: t('field.name') }),
            h('span.opt', { text: t('field.optional') }),
          ),
          llmModel,
        ),
        h('div.row.gap-2.wrap', llmTestBtn),
        llmStatus,
      ),
    );

    view.append(h('div.grid.grid-2.mt-4', logCard, llmCard));

    /* -------------------------------------------------------- Pintado de UI -- */

    function paintStatus() {
      paint(statusBadge, icon(agent.active ? 'check' : 'pause', 12),
        h('span', { text: agent.active ? t('agente.active') : t('agente.inactive') }));
      statusBadge.className = 'badge ' + (agent.active ? 'ok' : 'warn');

      const availKey = AVAILABILITIES.includes(agent.availability) ? agent.availability : 'available';
      const availTone = availKey === 'available' ? 'info' : availKey === 'busy' ? 'warn' : 'danger';
      paint(availBadge, icon('clock', 12), h('span', { text: t(`agente.${availKey}`) }));
      availBadge.className = 'badge ' + availTone;

      paint(rulesBadge, icon('balance', 12),
        h('span', { text: `${t('agente.rulesTitle')}: ${RULES.length}` }));

      paint(evaluatedBadge, icon('search', 12),
        h('span', { text: t('agente.decided', { n: engineState.evaluated }) }));
    }

    function suggestionRow(cand) {
      const rec = cand.record;
      const isProblem = cand.kind === 'problem';
      const canPropose = agent.autonomy !== 'low';
      const meta = h('div.row.gap-2.wrap.tiny.dim.mt-2',
        h('span.badge.primary', icon('spark', 12),
          h('span', { text: `${t('synapse.matchScore')} ${cand.score}` })),
        h('span.badge', { text: isProblem ? t('synapse.tabProblems') : t('synapse.tabCapacities') }),
        rec.category
          ? h('span.chip.static',
              h('span.cat-dot', { style: `background:${ctx.catColor(rec.category)}` }),
              h('span', { text: ctx.catLabel(rec.category) }))
          : null,
        rec.urgency
          ? h('span.badge', { class: urgencyClass(rec.urgency), text: t(`urgency.${rec.urgency}`) })
          : null,
      );

      return h('div.suggestion',
        icon(isProblem ? 'flag' : 'handshake', 20),
        h('div.grow',
          h('div.bold.break', { text: rec.title || t('state.empty') }),
          meta,
        ),
        h('div.row.gap-2.wrap.end',
          h('button.btn.sm', {
            type: 'button',
            on: { click: () => openDetail(cand) },
          }, icon('search', 15), h('span', { text: t('action.view') })),
          canPropose
            ? h('button.btn.sm.primary', {
                type: 'button',
                on: { click: (e) => {
                  const btn = e.currentTarget;
                  btn.disabled = true;
                  proposeMatch(cand).finally(() => { btn.disabled = false; });
                } },
              }, icon('handshake', 15), h('span', { text: t('synapse.proposeCollab') }))
            : null,
        ),
      );
    }

    function paintSuggestions() {
      clear(suggestionsBox);
      const list = engineState.suggestions;
      paint(suggestionsCount, h('span', { text: String(list.length) }));
      if (!list.length) {
        suggestionsBox.append(h('div.empty',
          icon('search', 28),
          h('div.empty-title', { text: t('agente.suggestions') }),
          h('div.empty-body', { text: t('agente.noSuggestions') }),
        ));
        return;
      }
      for (const cand of list) suggestionsBox.append(suggestionRow(cand));
    }

    function paintLog() {
      clear(logBox);
      const entries = agent.log || [];
      paint(logCount, icon('clock', 12), h('span', { text: String(entries.length) }));
      if (!entries.length) {
        logBox.append(h('div.empty',
          icon('clock', 28),
          h('div.empty-body', { text: t('agente.noLog') }),
        ));
        return;
      }
      for (const entry of entries) {
        const when = fmt.rel(entry.at || Date.now(), ctx.I18n.lang);
        const kind = kindLabel(entry.kind, ctx);
        const text = entry.text || '';
        const row = h('div.agent-log-item',
          icon(KIND_ICON[entry.kind] || 'spark', 16),
          h('div.grow',
            h('div.break', { text }),
            h('div.tiny.dim', { text: when }),
          ),
          Number.isFinite(entry.score) ? h('span.badge.primary', { text: String(entry.score) }) : null,
        );
        row.setAttribute('aria-label', `${kind}. ${text}. ${when}`);
        row.setAttribute('title', `${kind} · ${when}`);
        logBox.append(row);
      }
    }

    function paintLLM(tone, reason) {
      if (tone === 'pending') {
        paint(llmStatus, h('div.row.gap-2', h('span.spinner.sm'), h('span.hint', { text: t('state.loading') })));
        return;
      }
      if (tone === 'ok') {
        paint(llmStatus, h('span.badge.ok', icon('check', 12), h('span', { text: t('agente.llmOk') })));
        return;
      }
      if (tone === 'fail') {
        paint(llmStatus,
          h('span.badge.warn', icon('sos', 12), h('span', { text: t('agente.llmFail') })),
          reason ? h('div.hint.error.mono.break', { text: String(reason) }) : null,
        );
        return;
      }
      paint(llmStatus);
    }

    /* ------------------------------------------------- Decisiones y registro */

    function logDecision(kind, text, score) {
      agent.log.unshift({
        at: Date.now(),
        kind,
        text: String(text || '').slice(0, 240),
        score: Number.isFinite(score) ? Math.round(score) : null,
      });
      if (agent.log.length > MAX_LOG) agent.log.length = MAX_LOG;
      save({ recompute: false });   // nunca re-dispara el motor desde su propio registro
      paintLog();
    }

    function clearLog() {
      agent.log = [];
      save({ recompute: false });
      paintLog();
      ctx.toast(t('toast.deleted'), 'ok');
    }

    /** Escribe una propuesta de colaboración que SYNAPSE verá en su tablero. */
    async function insertMatch(cand) {
      const payload = {
        id: uid('mat'),
        needId: cand.kind === 'problem' ? cand.record.id : null,
        offerId: cand.kind === 'capacity' ? cand.record.id : null,
        score: cand.score,
        explain: {
          source: 'agente',
          rules: cand.rules.map((r) => ({ label: ruleLabel(r.id, ctx), points: Math.round(r.points * 10) / 10 })),
          affinity: Math.round(cand.affinity * 1000) / 1000,
        },
        status: 'sugerido',
      };
      /* Se publica con ctx.publish igual que hace SYNAPSE: la propuesta queda
       * firmada por la identidad que la generó, de modo que el tablero puede
       * mostrar quién la sugirió y verificarlo. Escribirla con Store.put la
       * dejaría como un registro sin autor. */
      const saved = await ctx.publish(COLLECTIONS.matches, payload);
      engineState.matches.push(saved);
      return saved;
    }

    async function proposeMatch(cand) {
      if (matchesRecord(engineState.matches, cand.record.id)) {
        ctx.toast(t('state.suggested'), 'info');
        return;
      }
      try {
        await insertMatch(cand);
      } catch (e) {
        ctx.toast(t('toast.error'), 'err');
        return;
      }
      ctx.toast(t('toast.saved'), 'ok');
      logDecision('suggest', `${t('synapse.proposeCollab')} · ${fmt.trunc(cand.record.title || '', 60)}`, cand.score);
    }

    /* ------------------------------------------------------ Detalle del score */

    async function openDetail(cand) {
      const rec = cand.record;
      const isProblem = cand.kind === 'problem';
      let verdict = { valid: false, label: t('state.unverified'), fingerprint: null };
      try {
        verdict = await ctx.verifyRecord(rec);
      } catch (e) {
        /* La verificación jamás debe impedir ver el razonamiento del agente. */
        verdict = { valid: false, label: t('state.unverified'), fingerprint: null };
      }

      const why = h('div.why-list',
        ...cand.rules.map((r) => h('div.why-item',
          icon(r.applied ? 'check' : 'x', 13),
          h('span.grow', { text: ruleLabel(r.id, ctx) }),
          h('span.rule-weight', { text: signed(r.points) }),
        )),
        h('div.why-item',
          h('span.grow.bold', { text: t('synapse.matchScore') }),
          h('span.rule-weight', { text: String(cand.score) }),
        ),
      );

      const body = h('div.stack.sm',
        h('div.row.gap-2.wrap',
          h('span.badge.primary', icon('spark', 12),
            h('span', { text: `${t('synapse.matchScore')} ${cand.score}` })),
          h('span.badge', { text: isProblem ? t('synapse.tabProblems') : t('synapse.tabCapacities') }),
          rec.category
            ? h('span.chip.static',
                h('span.cat-dot', { style: `background:${ctx.catColor(rec.category)}` }),
                h('span', { text: ctx.catLabel(rec.category) }))
            : null,
          rec.urgency
            ? h('span.badge', { class: urgencyClass(rec.urgency), text: t(`urgency.${rec.urgency}`) })
            : null,
        ),
        h('p.sm.break', { text: rec.body || '' }),
        h('dl.kv', h('dt', { text: t('field.author') }), h('dd', { text: (rec.author && rec.author.name) || '—' })),
        h('dl.kv', h('dt', { text: t('field.language') }), h('dd', { text: rec.lang || '—' })),
        h('dl.kv', h('dt', { text: t('field.status') }), h('dd', { text: rec.status || t('state.open') })),
        h('div.row.gap-2.wrap',
          h('span.sig', { class: verdict.valid ? 'valid' : 'invalid' },
            icon(verdict.valid ? 'check' : 'x', 12),
            h('span', { text: `${verdict.label}${verdict.fingerprint ? ' · ' + verdict.fingerprint : ''}` }),
          ),
          h('span.badge', icon('spark', 12),
            h('span', { text: `${t('synapse.matchScore')} ${Math.round(cand.affinity * 100)} %` })),
        ),
        h('h4.mt-2', { text: t('synapse.matchWhy') }),
        why,
      );

      const actions = [{ label: t('action.close'), iconName: 'x' }];
      if (agent.autonomy !== 'low') {
        actions.unshift({
          label: t('synapse.proposeCollab'),
          variant: 'primary',
          iconName: 'handshake',
          onClick: () => proposeMatch(cand),
        });
      }

      ctx.openModal({
        title: fmt.trunc(rec.title || t('action.details'), 70),
        iconName: isProblem ? 'flag' : 'handshake',
        body,
        actions,
      });
    }

    /* ------------------------------------------------------- Motor de lenguaje */

    async function testLLM() {
      const endpoint = String(agent.llm.endpoint || '').trim();
      const model = String(agent.llm.model || '').trim() || DEFAULT_MODEL;
      const key = String(agent.llm.key || '').trim();

      if (!endpoint) {
        paintLLM('fail', t('agente.llmEndpoint'));
        return;
      }
      if (!ctx.state.online) {
        paintLLM('fail', t('state.offline'));
        return;
      }

      paintLLM('pending');
      llmTestBtn.disabled = true;
      try {
        const url = `${endpoint.replace(/\/$/, '')}/chat/completions`;
        await jsonFetch(url, {
          method: 'POST',
          headers: Object.assign(
            { 'content-type': 'application/json' },
            key ? { authorization: `Bearer ${key}` } : {},
          ),
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
          }),
        }, LLM_TIMEOUT);
        paintLLM('ok');
      } catch (e) {
        /* Un fallo del motor opcional NUNCA afecta al motor de reglas. */
        const reason = (e && e.name === 'AbortError') ? `timeout ${LLM_TIMEOUT} ms` : String((e && e.message) || e);
        paintLLM('fail', reason);
      } finally {
        llmTestBtn.disabled = false;
      }
    }

    /* --------------------------------------------------- Evaluación completa -- */

    let generation = 0;
    let lastSignature = '';

    async function runAutoMatch(scored) {
      if (!agent.autoMatch || agent.autonomy !== 'high' || autoMatchDone) return;
      autoMatchDone = true;

      const budget = Math.max(0, AUTO_MATCH_MAX - autoMatchCount);
      const pool = scored.filter((c) => c.score >= AUTO_MATCH_THRESHOLD);
      let created = 0;

      for (const cand of pool) {
        if (created >= budget) break;
        if (matchesRecord(engineState.matches, cand.record.id)) {
          logDecision('skip', `${t('state.suggested')} · ${fmt.trunc(cand.record.title || '', 60)}`, cand.score);
          continue;
        }
        try {
          await insertMatch(cand);
        } catch (e) {
          continue;
        }
        autoMatchCount++;
        created++;
        logDecision('match', `${t('synapse.proposeCollab')} · ${fmt.trunc(cand.record.title || '', 60)}`, cand.score);
      }

      /* Deja constancia de lo que se vio y no se tocó (auditoría del criterio). */
      const below = scored.filter((c) => c.score >= SUGGESTION_THRESHOLD && c.score < AUTO_MATCH_THRESHOLD).slice(0, 3);
      for (const cand of below) {
        logDecision('skip', fmt.trunc(cand.record.title || '', 60), cand.score);
      }

      if (created && agent.notify) ctx.toast(t('synapse.foundMatches', { n: created }), 'ok');
    }

    async function recompute() {
      const gen = ++generation;
      suggestionsBox.setAttribute('aria-busy', 'true');
      busySpinner.hidden = false;

      try {
        const [problems, capacities, matches] = await Promise.all([
          Store.all(COLLECTIONS.problems),
          Store.all(COLLECTIONS.capacities),
          Store.all(COLLECTIONS.matches),
        ]);
        if (gen !== generation) return;

        engineState.matches = matches;

        /* Solo problemas abiertos (o sin estado declarado) y todas las capacidades. */
        const candidates = [
          ...problems
            .filter((p) => !!p && (p.status === undefined || p.status === null || p.status === 'abierto'))
            .map((r) => ({ kind: 'problem', record: r })),
          ...capacities.filter((c) => !!c).map((r) => ({ kind: 'capacity', record: r })),
        ];

        me = await Crypto.current().catch(() => null);
        const scored = [];
        for (const cand of candidates) {
          const result = await evaluateRecord(cand.record, agent, me, ctx);
          if (gen !== generation) return;
          scored.push({ ...cand, ...result });
        }

        scored.sort((a, b) => b.score - a.score);
        engineState.evaluated = scored.length;
        engineState.suggestions = scored.filter((c) => qualifies(agent, c.score)).slice(0, MAX_SUGGESTIONS);

        await runAutoMatch(scored);
        if (gen !== generation) return;

        paintSuggestions();
        paintStatus();
        paintLog();

        /* Aviso de novedades: solo cuando cambia el conjunto, nunca en el primer pase. */
        const signature = engineState.suggestions.map((c) => c.record.id).join('|');
        if (agent.notify && lastSignature && signature && signature !== lastSignature) {
          ctx.toast(t('synapse.foundMatches', { n: engineState.suggestions.length }), 'info');
          logDecision('notify', t('agente.decided', { n: engineState.suggestions.length }), null);
        }
        lastSignature = signature;
      } catch (e) {
        if (gen !== generation) return;
        clear(suggestionsBox);
        suggestionsBox.append(h('div.banner.danger',
          icon('sos', 20),
          h('div',
            h('strong', { text: t('state.error') }),
            h('div.sm', { text: String((e && e.message) || e) }),
          ),
        ));
      } finally {
        if (gen === generation) {
          busySpinner.hidden = true;
          suggestionsBox.setAttribute('aria-busy', 'false');
        }
      }
    }

    const scheduleRecompute = debounce(() => { recompute(); }, RECOMPUTE_MS);

    /* ------------------------------------------------ Suscripciones y pintado */

    const offs = [
      ctx.onStore(COLLECTIONS.problems, () => scheduleRecompute()),
      ctx.onStore(COLLECTIONS.capacities, () => scheduleRecompute()),
      ctx.onStore(COLLECTIONS.matches, () => scheduleRecompute()),
    ];

    const offEngine = (ctx.Engine && typeof ctx.Engine.onChange === 'function')
      ? ctx.Engine.onChange(() => { paintRuleDetails(); })
      : null;

    const offIdentity = ctx.onStore(COLLECTIONS.identity, () => {
      Crypto.current().then((id) => { me = id; paintRuleDetails(); scheduleRecompute(); }).catch(() => {});
    });

    /* ---------------------------------------------------------- Primer pintado */
    paintAreas();
    paintLangs();
    paintOrb();
    paintActivate();
    paintRuleDetails();
    paintStatus();
    paintLog();
    paintLLM('idle');
    paintSuggestions();
    recompute();

    /* ------------------------------------------------------------------ Limpieza */
    return () => {
      generation++;                       // invalida cualquier evaluación en vuelo
      scheduleRecompute.cancel();
      flushAll();
      for (const off of offs) { try { off(); } catch (e) { /* noop */ } }
      try { offIdentity(); } catch (e) { /* noop */ }
      if (offEngine) { try { offEngine(); } catch (e) { /* noop */ } }
      s.destroy();
    };
  },
};
