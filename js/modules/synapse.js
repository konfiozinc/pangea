/* ============================================================================
 * PANGEA · js/modules/synapse.js
 * SYNAPSE — Motor de emparejamiento problema ↔ capacidad.
 *
 * Todo el cálculo ocurre en el navegador. No hay servidor que decida quién
 * colabora con quién, y por eso el algoritmo es explicable: cada puntuación
 * viene acompañada de las razones concretas que la produjeron.
 *
 * Motor semántico con degradación elegante (ctx.Engine):
 *   · neuronal (transformers.js MiniLM) cuando está disponible,
 *   · local por n-gramas cuando no hay red o el usuario activó el nodo ligero.
 * ==========================================================================*/

import {
  h, icon, scope, clear, fmt, uid, debounce, clamp, keywords, copyText, download,
} from '../utils.js';
import { Store, COLLECTIONS } from '../store.js';
import { Crypto } from '../crypto.js';

const URGENCY = ['low', 'medium', 'high', 'critical'];
const URGENCY_WEIGHT = { low: 2, medium: 5, high: 8, critical: 10 };
const STATUS_COLUMNS = ['sugerido', 'en_colaboracion', 'resuelto'];
const SUGGEST_THRESHOLD = 45;

export default {
  id: 'synapse',
  icon: 'network',
  accent: 'indigo',
  titleKey: 'synapse.title',
  subKey: 'synapse.sub',

  async mount(root, ctx) {
    const s = scope(root);
    const view = h('div.view');
    root.append(view);

    const state = { tab: 'board', busy: false, engineNote: null, drag: null };
    const unsubs = [
      ctx.onStore(COLLECTIONS.problems, () => paint()),
      ctx.onStore(COLLECTIONS.capacities, () => paint()),
      ctx.onStore(COLLECTIONS.matches, () => paint()),
    ];

    /* ------------------------------------------------------------ Datos -- */
    const load = async () => {
      const [problems, capacities, matches] = await Promise.all([
        Store.sorted(COLLECTIONS.problems, 'desc'),
        Store.sorted(COLLECTIONS.capacities, 'desc'),
        Store.sorted(COLLECTIONS.matches, 'desc'),
      ]);
      return { problems, capacities, matches };
    };

    /* ------------------------------------------------------- Motor match -- */
    const textOf = (r) => `${r.title || ''}. ${r.body || ''}`.trim();

    /** ¿La ubicación tiene coordenadas reales (no solo una etiqueta)? */
    const hasCoords = (loc) => loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng);

    /**
     * Clasifica la disponibilidad declarada de una capacidad.
     * Tolerante con datos ya guardados: acepta términos en español o inglés y
     * devuelve un valor neutro cuando el campo falta o no se reconoce, para que
     * una disponibilidad desconocida no penalice el emparejamiento en silencio.
     * Devuelve { points, labelKey, busy }.
     */
    const AVAILABILITY = {
      'disponible': { points: 8, labelKey: 'agente.available', busy: false },
      'available': { points: 8, labelKey: 'agente.available', busy: false },
      'parcial': { points: 6, labelKey: null, busy: false },
      'partial': { points: 6, labelKey: null, busy: false },
      'busy': { points: 4, labelKey: 'agente.busy', busy: true },
      'ocupado': { points: 4, labelKey: 'agente.busy', busy: true },
      'no_disponible': { points: 0, labelKey: 'agente.unavailable', busy: false },
      'unavailable': { points: 0, labelKey: 'agente.unavailable', busy: false },
    };
    const availabilityOf = (value) => AVAILABILITY[String(value || '').trim().toLowerCase()]
      || { points: 4, labelKey: null, busy: false };

    /**
     * Puntuación explicable problema ↔ capacidad (0..100).
     * Devuelve { score, parts, semantic, shared, distanceKm }.
     *
     * Pesos (suman exactamente 100):
     *   · afinidad semántica ……………… 42
     *   · misma categoría ………………… 18
     *   · conceptos compartidos ……… 10 (máximo)
     *   · urgencia del problema ……… 10 (máximo)
     *   · cercanía geográfica ………… 7 (máximo)
     *   · idioma compartido …………… 5
     *   · disponibilidad de la capacidad … 8 (máximo)
     */
    async function scorePair(problem, capacity) {
      const parts = [];
      let distanceKm = null;

      /* 1. Afinidad semántica (peso 42). El motor siempre responde. */
      let sem = 0;
      try { sem = await ctx.Engine.similarity(textOf(problem), textOf(capacity)); } catch { sem = 0; }
      if (!Number.isFinite(sem)) sem = 0;
      sem = clamp(sem, 0, 1);
      const semPts = Math.round(sem * 42);
      parts.push({ key: 'synapse.semanticClose', detail: `${Math.round(sem * 100)}%`, points: semPts });

      /* 2. Misma categoría (peso 18). */
      const sameCat = !!(problem.category && problem.category === capacity.category);
      if (sameCat) parts.push({ key: 'synapse.sameCategory', detail: ctx.catLabel(problem.category), points: 18 });

      /* 3. Conceptos compartidos, ponderados por rareza (peso hasta 10). */
      const kwP = new Set(keywords(textOf(problem), 10));
      const kwC = new Set(keywords(textOf(capacity), 10));
      const shared = [...kwP].filter((w) => kwC.has(w));
      const sharedPts = Math.round(clamp(shared.length / 6, 0, 1) * 10);
      if (sharedPts > 0) parts.push({ key: 'synapse.sharedTerms', detail: shared.slice(0, 4).join(', '), points: sharedPts });

      /* 4. Urgencia del problema (peso hasta 10). La escala es continua:
       * baja 2, media 5, alta 8, crítica 10. */
      const urgPts = URGENCY_WEIGHT[problem.urgency] ?? 0;
      if (urgPts > 0) parts.push({ key: 'synapse.urgencyBoost', detail: ctx.t(`urgency.${problem.urgency}`), points: urgPts });

      /* 5. Cercanía geográfica (peso hasta 7). La distancia también se expone
       * en `explain.distanceKm` para que tarjeta y modal la muestren sin
       * recalcularla. */
      let geoPts = 0;
      if (hasCoords(problem.location) && hasCoords(capacity.location)) {
        const km = ctx.U.distanceKm(problem.location, capacity.location);
        distanceKm = km;
        geoPts = km <= 25 ? 7 : km <= 100 ? 4 : km <= 500 ? 2 : 0;
        if (geoPts) parts.push({ key: 'synapse.locationClose', detail: ctx.t('sos.distance', { km }), points: geoPts });
      }

      /* 6. Idioma compartido (peso 5): colaborar es más fácil sin traducción.
       * La capacidad puede declarar varios idiomas de trabajo (`langs`); basta
       * con que el idioma del problema coincida con el principal o con uno de ellos. */
      const capLangs = new Set([capacity.lang, ...(capacity.langs || [])].filter(Boolean));
      const langPts = problem.lang && capLangs.has(problem.lang) ? 5 : 0;
      if (langPts) parts.push({ key: 'field.language', detail: problem.lang.toUpperCase(), points: langPts });

      /* 7. Disponibilidad de la capacidad (peso hasta 8). Una persona ocupada
       * solo puntúa cuando el problema es urgente; un valor ausente o no
       * reconocido queda en el punto neutro (4). */
      const avail = availabilityOf(capacity.availability);
      const availPts = avail.busy
        ? (problem.urgency === 'high' || problem.urgency === 'critical' ? 4 : 0)
        : avail.points;
      parts.push({ key: 'agente.availability', detail: avail.labelKey ? ctx.t(avail.labelKey) : undefined, points: availPts });

      const score = clamp(parts.reduce((n, p) => n + p.points, 0), 0, 100);
      return { score, parts, semantic: sem, shared, distanceKm };
    }

    /** Ejecuta el emparejamiento sobre toda la red local. */
    async function runMatching() {
      if (state.busy) return 0;
      state.busy = true;
      const status = view.querySelector('#match-status');
      if (status) { clear(status); status.append(h('span.spinner.sm'), document.createTextNode(' ' + ctx.t('synapse.searching'))); }

      try {
        const { problems, capacities, matches } = await load();
        const open = problems.filter((p) => (p.status || 'abierto') === 'abierto');
        const existing = new Set(matches.map((m) => `${m.needId}::${m.offerId}`));
        let created = 0;

        for (const p of open) {
          for (const c of capacities) {
            if (existing.has(`${p.id}::${c.id}`)) continue;
            const { score, parts, semantic, shared, distanceKm } = await scorePair(p, c);
            if (score < SUGGEST_THRESHOLD) continue;
            await ctx.publish(COLLECTIONS.matches, {
              id: uid('mat'),
              needId: p.id, offerId: c.id,
              score,
              explain: {
                parts,
                semantic: Math.round(semantic * 100),
                shared: shared.slice(0, 6),
                needTitle: p.title, offerTitle: c.title,
                needCat: p.category, offerCat: c.category,
                distanceKm,
              },
              status: 'sugerido',
              collaborators: [],
            });
            created++;
          }
        }
        state.engineNote = ctx.Engine.state.mode === 'neural' ? 'synapse.engineModel' : 'synapse.engineLocal';
        ctx.toast(ctx.t('synapse.foundMatches', { n: created }), created ? 'ok' : 'info');
        if (created) await Store.log('synapse', ctx.t('synapse.foundMatches', { n: created }), { created });
        return created;
      } finally {
        state.busy = false;
        paint();
      }
    }

    /* --------------------------------------------------------- Kanban ----- */
    async function board(data) {
      const { problems, matches } = data;
      const byId = new Map(problems.map((p) => [p.id, p]));
      const cols = [
        { id: 'abierto', titleKey: 'synapse.colOpen', items: problems.filter((p) => (p.status || 'abierto') === 'abierto').map((p) => ({ kind: 'problem', rec: p })) },
        ...STATUS_COLUMNS.map((st) => ({
          id: st,
          titleKey: { sugerido: 'synapse.colSuggested', en_colaboracion: 'synapse.colWorking', resuelto: 'synapse.colResolved' }[st],
          items: matches.filter((m) => (m.status || 'sugerido') === st).map((m) => ({ kind: 'match', rec: m, problem: byId.get(m.needId) })),
        })),
      ];

      const kanban = h('div.kanban');
      for (const col of cols) {
        const body = h('div.kanban-body');
        if (!col.items.length) body.append(h('div.empty', { style: 'padding:var(--sp-5)' }, icon('layers', 22), h('div.tiny.dim', { text: ctx.t('state.empty') })));
        for (const item of col.items) body.append(item.kind === 'problem' ? problemCard(item.rec) : await matchCard(item.rec, item.problem));

        const column = h('section.kanban-col', { 'data-status': col.id, 'aria-label': ctx.t(col.titleKey) },
          h('div.kanban-head',
            h('span.title', icon(col.id === 'abierto' ? 'flag' : 'network', 16), ctx.t(col.titleKey)),
            h('span.count', { text: String(col.items.length) }),
          ),
          body,
        );

        /* Soltar una tarjeta aquí cambia su estado. */
        if (col.id !== 'abierto') {
          s.on(column, 'dragover', (e) => { e.preventDefault(); column.style.borderColor = 'var(--primary)'; });
          s.on(column, 'dragleave', () => { column.style.borderColor = ''; });
          s.on(column, 'drop', async (e) => {
            e.preventDefault(); column.style.borderColor = '';
            const id = e.dataTransfer?.getData('text/pangea-match');
            if (!id) return;
            await moveMatch(id, col.id);
          });
        }
        kanban.append(column);
      }
      return kanban;
    }

    function problemCard(p) {
      return h('article.kcard', { onclick: () => showProblem(p), tabindex: '0', role: 'button',
        onkeydown: (e) => { if (e.key === 'Enter') showProblem(p); } },
        h('div.kcard-title', { text: p.title }),
        h('div.kcard-meta',
          h('span.chip.static', h('span.cat-dot', { style: `background:${ctx.catColor(p.category)}` }), ctx.catLabel(p.category)),
          h('span.badge', { class: p.urgency === 'critical' ? 'danger' : p.urgency === 'high' ? 'warn' : '', text: ctx.t(`urgency.${p.urgency || 'medium'}`) }),
          p.seed ? h('span.badge.info', ctx.t('state.demo')) : null,
        ),
        h('div.kcard-meta', icon('clock', 12), h('span', { text: fmt.rel(p.createdAt, ctx.I18n.lang) })),
      );
    }

    async function matchCard(m, problem) {
      const offer = (await Store.get(COLLECTIONS.capacities, m.offerId));
      const tier = m.score >= 75 ? 'ok' : m.score >= 55 ? 'primary' : '';
      const circumference = 2 * Math.PI * 22;
      const dash = (clamp(m.score, 0, 100) / 100) * circumference;
      const avail = availabilityOf(offer?.availability);
      const dist = m.explain?.distanceKm;
      const availBadge = avail.labelKey ? h('span.badge', { class: avail.busy ? 'warn' : '', text: ctx.t(avail.labelKey) }) : null;
      const distBadge = (dist != null && Number.isFinite(dist)) ? h('span.badge', { text: ctx.t('sos.distance', { km: dist }) }) : null;

      const card = h('article.kcard', {
        draggable: 'true',
        onDragstart: (e) => { e.dataTransfer.setData('text/pangea-match', m.id); card.classList.add('dragging'); },
        onDragend: () => card.classList.remove('dragging'),
        onclick: (e) => { if (!e.target.closest('button')) showMatch(m, problem, offer); },
      },
        h('div.row.between.gap-2',
          h('span.badge', { class: tier, text: `${ctx.t('synapse.matchScore')} ${m.score}%` }),
          h('span.score-ring', { 'aria-label': `${m.score}%` },
            h('svg', { width: 58, height: 58, viewBox: '0 0 58 58' },
              h('circle', { cx: 29, cy: 29, r: 22, fill: 'none', stroke: 'var(--border)', 'stroke-width': 5 }),
              h('circle', { cx: 29, cy: 29, r: 22, fill: 'none', stroke: m.score >= 75 ? 'var(--accent)' : m.score >= 55 ? 'var(--primary)' : 'var(--warn)', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-dasharray': `${dash} ${circumference}` }),
            ),
            h('span.score-val', { text: String(m.score) }),
          ),
        ),
        h('div.match-pair',
          h('div.match-side.need',
            h('div.side-label', ctx.t('synapse.need')),
            h('div.side-text.clamp-2', { text: problem ? problem.title : m.explain?.needTitle || '—' }),
          ),
          icon('link', 18, 'link-ico'),
          h('div.match-side.offer',
            h('div.side-label', ctx.t('synapse.offer')),
            h('div.side-text.clamp-2', { text: offer ? offer.title : m.explain?.offerTitle || '—' }),
          ),
        ),
        (availBadge || distBadge) ? h('div.kcard-meta', availBadge, distBadge) : null,
        h('div.why-list', ...(m.explain?.parts || []).slice(0, 3).map((p) => h('div.why-item',
          icon('check', 13), h('span', { text: `${ctx.t(p.key)}${p.detail ? ' · ' + p.detail : ''}` }), h('span.grow'), h('span.mono', { text: `+${p.points}` }),
        ))),
        h('div.row.gap-2.wrap',
          m.status !== 'resuelto'
            ? h('button.btn.sm', {
                onclick: async (e) => { e.stopPropagation(); await moveMatch(m.id, m.status === 'sugerido' ? 'en_colaboracion' : 'resuelto'); },
              }, icon('send', 14), m.status === 'sugerido' ? ctx.t('synapse.proposeCollab') : ctx.t('synapse.markResolved'))
            : h('button.btn.sm', { onclick: async (e) => { e.stopPropagation(); await moveMatch(m.id, 'sugerido'); } }, icon('refresh', 14), ctx.t('synapse.reopen')),
          h('button.btn.icon.ghost.sm', { title: ctx.t('synapse.explain'), onclick: (e) => { e.stopPropagation(); showMatch(m, problem, offer); } }, icon('microscope', 15)),
        ),
      );
      return card;
    }

    async function moveMatch(id, status) {
      const m = await Store.get(COLLECTIONS.matches, id);
      if (!m || m.status === status) return;
      const me = await ctx.author();
      const collaborators = status === 'en_colaboracion' && !(m.collaborators || []).some((c) => c.fingerprint === me.fingerprint)
        ? [...(m.collaborators || []), me] : (m.collaborators || []);

      await Store.patch(COLLECTIONS.matches, id, { status, collaborators });
      await Store.log('synapse', `${ctx.t('state.' + (status === 'en_colaboracion' ? 'working' : status === 'resuelto' ? 'resolved' : 'suggested'))} · ${m.explain?.needTitle || id}`, { status });

      if (status === 'en_colaboracion') ctx.toast(ctx.t('synapse.proposeCollab'), 'ok');
      if (status === 'resuelto') { ctx.toast(ctx.t('synapse.markResolved'), 'ok'); await ctx.awardPoints(10, ctx.t('synapse.markResolved')); }
    }

    /** Botón «Ver perfil»: solo cuando el registro tiene autoría real. */
    function profileButton(rec) {
      const a = rec && rec.author;
      if (!a || !a.fingerprint || a.anon) return null;
      return h('button.btn.sm.mt-2', {
        onclick: (e) => { e.stopPropagation(); ctx.navigate('profile/' + a.fingerprint); },
      }, icon('users', 14), ctx.t('profile.title'));
    }

    function showMatch(m, problem, offer) {
      const parts = m.explain?.parts || [];
      ctx.openModal({
        title: ctx.t('synapse.detailTitle'), iconName: 'network', size: 'wide',
        body: h('div.stack',
          h('div.match-pair',
            h('div.match-side.need',
              h('div.side-label', ctx.t('synapse.need')),
              h('div.side-text', { text: problem?.title || m.explain?.needTitle || '—' }),
              problem ? h('p.tiny.dim.mt-2', { text: fmt.trunc(problem.body, 240) }) : null,
              problem?.needResources?.length ? h('div.tiny.dim.mt-2', h('span', { text: ctx.t('field.needResources') + ': ' }), h('span', { text: problem.needResources.join(', ') })) : null,
              profileButton(problem),
            ),
            h('span.score-ring', h('svg', { width: 58, height: 58, viewBox: '0 0 58 58' },
              h('circle', { cx: 29, cy: 29, r: 22, fill: 'none', stroke: 'var(--border)', 'stroke-width': 5 }),
              h('circle', { cx: 29, cy: 29, r: 22, fill: 'none', stroke: 'var(--primary)', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-dasharray': `${(m.score / 100) * 138.2} 138.2` }),
            ), h('span.score-val', { text: String(m.score) })),
            h('div.match-side.offer',
              h('div.side-label', ctx.t('synapse.offer')),
              h('div.side-text', { text: offer?.title || m.explain?.offerTitle || '—' }),
              offer ? h('p.tiny.dim.mt-2', { text: fmt.trunc(offer.body, 240) }) : null,
              offer?.experience ? h('div.tiny.dim.mt-2', h('span', { text: ctx.t('field.experience') + ': ' }), h('span', { text: offer.experience })) : null,
              offer?.resources?.length ? h('div.tiny.dim.mt-2', h('span', { text: ctx.t('field.resources') + ': ' }), h('span', { text: offer.resources.join(', ') })) : null,
              profileButton(offer),
            ),
          ),
          h('h4.section-title', { text: ctx.t('synapse.explain') }),
          h('div.stack.sm', ...parts.map((p) => h('div.rule-row',
            h('span', h('span.sm', { text: ctx.t(p.key) }), p.detail ? h('span.tiny.dim', { text: ' · ' + p.detail }) : null),
            h('span.rule-weight', { text: `+${p.points}` }),
          ))),
          h('div.banner', icon('microscope', 20), h('div',
            h('strong', { text: ctx.t('state.' + (m.status === 'en_colaboracion' ? 'working' : m.status === 'resuelto' ? 'resolved' : 'suggested')) }),
            h('div.sm', { text: `${ctx.t('synapse.matchScore')}: ${m.score}/100 · ${ctx.t('memoria.quality')}: ${m.explain?.semantic ?? '—'}%` }),
          )),
          (m.collaborators || []).length ? h('div',
            h('h4.section-title', { text: ctx.t('synapse.collaborators') }),
            h('div.chips', ...m.collaborators.map((c) => h('span.chip.static', icon('users', 12), `${c.name} · ${String(c.fingerprint).slice(4, 13)}`))),
          ) : null,
        ),
        actions: [
          { label: ctx.t('action.close') },
          { label: ctx.t('action.share'), onClick: async () => { await copyText(JSON.stringify({ problem: problem?.title, capacity: offer?.title, score: m.score, why: parts }, null, 2)); ctx.toast(ctx.t('toast.copied'), 'ok'); } },
          { label: ctx.t('synapse.awardPoints'), variant: 'primary', onClick: async () => { await ctx.awardPoints(15, ctx.t('synapse.awardPoints')); ctx.toast(ctx.t('synapse.pointsAwarded', { n: 15 }), 'ok'); } },
        ],
      });
    }

    function showProblem(p) {
      const modal = ctx.openModal({
        title: p.title, iconName: p.kind === 'capacity' ? 'handshake' : 'flag',
        body: h('div.stack',
          h('div.row.gap-2.wrap',
            h('span.chip.static', h('span.cat-dot', { style: `background:${ctx.catColor(p.category)}` }), ctx.catLabel(p.category)),
            p.urgency ? h('span.badge', { class: p.urgency === 'critical' ? 'danger' : p.urgency === 'high' ? 'warn' : '', text: ctx.t(`urgency.${p.urgency}`) }) : null,
            p.lang ? h('span.badge', ctx.t('field.language') + ': ' + String(p.lang).toUpperCase()) : null,
            p.seed ? h('span.badge.info', ctx.t('state.demo')) : null,
          ),
          h('p', { text: p.body || '' }),
          p.location ? h('div.row.gap-2.sm.dim', icon('pin', 15), h('span', { text: p.location.label || `${p.location.lat}, ${p.location.lng}` })) : null,
          h('div.kv', h('dt', { text: ctx.t('field.author') }), h('dd', { text: `${p.author?.name || '—'} · ${String(p.author?.fingerprint || '').slice(4, 16)}` })),
          profileButton(p),
          h('div.kv', h('dt', { text: ctx.t('nexus.signature') }), h('dd', h('span.sig', { id: 'sig-badge', text: '…' }))),
        ),
        actions: [{ label: ctx.t('action.close') }],
      });
      /* La verificación de firma es asíncrona: se resuelve en el propio modal. */
      ctx.verifyRecord(p).then((v) => {
        const badge = modal.body.querySelector('#sig-badge');
        if (badge) { badge.classList.add(v.valid ? 'valid' : 'invalid'); badge.textContent = `${v.label} · ${String(v.fingerprint || '—').slice(4, 16)}`; }
      });
    }

    /* ---------------------------------------------------- Listas simples -- */
    function entityList(rows, kind) {
      if (!rows.length) {
        return h('div.empty', icon(kind === 'problem' ? 'flag' : 'handshake', 30),
          h('div.empty-title', { text: ctx.t('state.empty') }),
          h('div.empty-body', { text: ctx.t(kind === 'problem' ? 'synapse.emptyProblems' : 'synapse.emptyCapacities') }),
        );
      }
      return h('div.grid.grid-auto.wide', ...rows.map((r) => h('article.card.interactive', {
        onclick: () => (kind === 'problem' ? showProblem(r) : showProblem({ ...r, title: r.title })),
      },
        h('div.card-body.stack.sm',
          h('div.row.between.gap-2',
            h('span.chip.static', h('span.cat-dot', { style: `background:${ctx.catColor(r.category)}` }), ctx.catLabel(r.category)),
            r.urgency ? h('span.badge', { class: r.urgency === 'critical' ? 'danger' : r.urgency === 'high' ? 'warn' : '', text: ctx.t(`urgency.${r.urgency}`) }) : null,
          ),
          h('h3', { style: 'font-size:var(--fs-md)', text: r.title }),
          h('p.sm.dim.clamp-3', { text: r.body || '' }),
          h('div.row.gap-2.wrap.tiny.dim',
            icon('clock', 12), h('span', { text: fmt.rel(r.createdAt, ctx.I18n.lang) }),
            r.author?.name ? h('span', { text: '· ' + r.author.name }) : null,
            r.seed ? h('span.badge.info', ctx.t('state.demo')) : null,
          ),
          profileButton(r),
        ),
      )));
    }

    /* ------------------------------------------------------- Formularios -- */
    /** Normaliza una lista separada por comas: recorta, descarta vacíos,
     * limita cada elemento a 60 caracteres y el total a 8. */
    const csvList = (raw) => String(raw || '').split(',')
      .map((x) => x.trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 8);

    function composer(kind) {
      const isProblem = kind === 'problem';
      const title = h('input.input', { placeholder: ctx.t('field.title'), maxlength: '120' });
      const body = h('textarea.textarea.tall', { placeholder: ctx.t(isProblem ? 'synapse.problemPh' : 'synapse.capacityPh'), maxlength: '2000' });
      const cat = h('select.select', {}, ...ctx.categories().map((c) => h('option', { value: c.id }, ctx.catLabel(c.id))));
      const urg = isProblem
        ? h('select.select', {}, ...URGENCY.map((u) => h('option', { value: u, selected: u === 'medium' }, ctx.t(`urgency.${u}`))))
        : null;
      /* Idioma del contenido: común a problemas y capacidades. */
      const lang = h('select.select', { id: uid('fld') },
        ...ctx.I18n.LANGUAGES.map((l) => h('option', { value: l.code, selected: l.code === ctx.I18n.lang }, `${l.flag} ${l.native}`)));
      /* Recursos necesarios (solo problemas). */
      const needResources = isProblem
        ? h('input.input', { id: uid('fld'), placeholder: ctx.t('field.needResources') + ' · ' + ctx.t('field.optional') })
        : null;
      /* Experiencia (solo capacidades). */
      const experience = !isProblem
        ? h('textarea.textarea', { id: uid('fld'), rows: '2', style: 'min-height:64px', maxlength: '600', placeholder: ctx.t('field.experience') + ' · ' + ctx.t('field.optional') })
        : null;
      /* Recursos disponibles (solo capacidades). */
      const resources = !isProblem
        ? h('input.input', { id: uid('fld'), placeholder: ctx.t('field.resources') + ' · ' + ctx.t('field.optional') })
        : null;
      /* Disponibilidad (solo capacidades). */
      const availability = !isProblem
        ? h('select.select', { id: uid('fld') },
            h('option', { value: 'disponible', selected: true }, ctx.t('agente.available')),
            h('option', { value: 'busy' }, ctx.t('agente.busy')),
            h('option', { value: 'no_disponible' }, ctx.t('agente.unavailable')))
        : null;
      /* Idiomas de trabajo (solo capacidades): chips multi-selección con el
       * idioma de la interfaz preseleccionado. */
      const langsSel = new Set(isProblem ? [] : [ctx.I18n.lang]);
      const langsHost = !isProblem
        ? h('div.chips', { role: 'group', 'aria-label': ctx.t('agente.languages') },
            ...ctx.I18n.LANGUAGES.map((l) => {
              const chip = h('button.chip', {
                type: 'button',
                'aria-pressed': String(langsSel.has(l.code)),
                onclick: () => {
                  if (langsSel.has(l.code)) langsSel.delete(l.code);
                  else langsSel.add(l.code);
                  chip.setAttribute('aria-pressed', String(langsSel.has(l.code)));
                },
              }, `${l.flag} ${l.native}`);
              return chip;
            }))
        : null;

      const locLabel = h('input.input', { placeholder: ctx.t('sos.useMyLocation') });
      let coords = null;
      const locStatus = h('div.tiny.dim');
      const locBtn = h('button.btn.sm', {
        onclick: async () => {
          try {
            coords = await ctx.U.getPosition();
            clear(locStatus); locStatus.append(h('span.badge.ok', icon('pin', 12), `${coords.lat}, ${coords.lng}`));
          } catch { ctx.toast(ctx.t('sos.locationDenied'), 'warn'); }
        },
      }, icon('pin', 15), ctx.t('sos.useMyLocation'));

      const tags = h('input.input', { placeholder: ctx.t('field.tags') + ' · ' + ctx.t('field.optional') });

      return {
        body: h('div.form-grid',
          h('div.field', { style: 'grid-column:1/-1' }, h('label.label', ctx.t(isProblem ? 'synapse.postProblem' : 'synapse.postCapacity'), h('span.req', '*')), title),
          h('div.field', { style: 'grid-column:1/-1' }, h('label.label', ctx.t('field.description'), h('span.req', '*')), body),
          h('div.field', h('label.label', ctx.t('field.category')), cat),
          urg ? h('div.field', h('label.label', ctx.t('field.urgency')), urg) : null,
          h('div.field', h('label.label', { for: lang.id }, ctx.t('field.language')), lang),
          isProblem ? h('div.field', h('label.label', { for: needResources.id }, ctx.t('field.needResources'), h('span.opt', ctx.t('field.optional'))), needResources) : null,
          !isProblem ? h('div.field', h('label.label', { for: availability.id }, ctx.t('agente.availability')), availability) : null,
          !isProblem ? h('div.field', { style: 'grid-column:1/-1' }, h('label.label', { for: experience.id }, ctx.t('field.experience'), h('span.opt', ctx.t('field.optional'))), experience) : null,
          !isProblem ? h('div.field', h('label.label', { for: resources.id }, ctx.t('field.resources'), h('span.opt', ctx.t('field.optional'))), resources) : null,
          !isProblem ? h('div.field', { style: 'grid-column:1/-1' }, h('label.label', ctx.t('agente.languages')), langsHost) : null,
          h('div.field', h('label.label', ctx.t('field.location'), h('span.opt', ctx.t('field.optional'))), locLabel),
          h('div.field', h('label.label', ctx.t('field.tags'), h('span.opt', ctx.t('field.optional'))), tags),
        ),
        footer: h('div.row.gap-2.wrap.mt-4', locBtn, locStatus),
        read: () => {
          const rec = {
            title: title.value.trim(),
            body: body.value.trim(),
            category: cat.value,
            lang: lang.value,
            location: coords ? { ...coords, label: locLabel.value.trim() || null } : (locLabel.value.trim() ? { label: locLabel.value.trim(), lat: null, lng: null } : null),
            tags: tags.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8),
          };
          if (isProblem) {
            rec.urgency = urg.value;
            rec.needResources = csvList(needResources.value);
          } else {
            rec.experience = experience.value.trim().slice(0, 600);
            rec.resources = csvList(resources.value);
            rec.langs = [...langsSel];
            rec.availability = availability.value;
          }
          return rec;
        },
        get locStatus() { return locStatus; },
      };
    }

    function openComposer(kind) {
      const isProblem = kind === 'problem';
      const form = composer(kind);
      const wrap = h('div', form.body, form.footer);
      ctx.openModal({
        title: ctx.t(isProblem ? 'synapse.newProblem' : 'synapse.newCapacity'),
        iconName: isProblem ? 'flag' : 'handshake', size: 'wide',
        body: wrap,
        actions: [
          { label: ctx.t('action.cancel') },
          {
            label: ctx.t('action.publish'), variant: 'primary', iconName: 'send',
            onClick: async () => {
              const data = form.read();
              if (data.title.length < 5 || data.body.length < 20) { ctx.toast(ctx.t('toast.fieldsRequired'), 'warn'); return false; }
              const rec = await ctx.publish(isProblem ? COLLECTIONS.problems : COLLECTIONS.capacities, {
                kind: isProblem ? 'problem' : 'capacity',
                status: isProblem ? 'abierto' : undefined,
                ...data,
              });
              ctx.toast(ctx.t('toast.published'), 'ok');
              await Store.log('synapse', data.title, { kind });
              /* Encadenar el motor: publicar debe producir colaboración, no silencio. */
              setTimeout(() => runMatching(), 350);
              return rec;
            },
          },
        ],
      });
    }

    /* ---------------------------------------------------------- Pintado --- */
    async function paint() {
      clear(view);
      const data = await load();
      const openCount = data.problems.filter((p) => (p.status || 'abierto') === 'abierto').length;
      const activeMatches = data.matches.filter((m) => m.status === 'en_colaboracion').length;

      view.append(h('div.view-header',
        h('div.view-heading',
          h('h1.view-title', icon('network', 26), ctx.t('synapse.title')),
          h('p.view-sub', { text: ctx.t('synapse.sub') }),
        ),
        h('div.view-actions',
          h('span.badge', { class: ctx.Engine.state.mode === 'neural' ? 'ok' : 'info' },
            icon('microscope', 12),
            ctx.t(state.engineNote || (ctx.Engine.state.mode === 'neural' ? 'synapse.engineModel' : 'synapse.engineLocal'))),
          h('button.btn', { onclick: () => openComposer('capacity') }, icon('handshake', 17), ctx.t('synapse.newCapacity')),
          h('button.btn.primary', { onclick: () => openComposer('problem') }, icon('flag', 17), ctx.t('synapse.newProblem')),
          h('button.btn.aurora', { onclick: () => runMatching() }, icon('spark', 17), ctx.t('synapse.suggestMatches')),
        ),
      ));

      view.append(h('div.grid.grid-4.mb-6',
        h('div.card', h('div.stat', h('span.stat-label', { text: ctx.t('synapse.colOpen') }), h('span.stat-value', { text: String(openCount) }))),
        h('div.card', h('div.stat', h('span.stat-label', { text: ctx.t('synapse.colSuggested') }), h('span.stat-value', { text: String(data.matches.filter((m) => (m.status || 'sugerido') === 'sugerido').length) }))),
        h('div.card', h('div.stat', h('span.stat-label', { text: ctx.t('synapse.colWorking') }), h('span.stat-value', { text: String(activeMatches) }))),
        h('div.card', h('div.stat', h('span.stat-label', { text: ctx.t('synapse.colResolved') }), h('span.stat-value', { text: String(data.matches.filter((m) => m.status === 'resuelto').length) }))),
      ));

      const tabs = h('div.tabs', ...[
        ['board', 'synapse.tabBoard', 'chart'],
        ['problems', 'synapse.tabProblems', 'flag'],
        ['capacities', 'synapse.tabCapacities', 'handshake'],
      ].map(([id, key, ico]) => h('button.tab', {
        class: state.tab === id ? 'active' : '', role: 'tab', 'aria-selected': String(state.tab === id),
        onclick: () => { state.tab = id; paint(); },
      }, icon(ico, 15), ctx.t(key),
        h('span.count', { text: String(id === 'board' ? openCount + data.matches.length : id === 'problems' ? data.problems.length : data.capacities.length) }),
      )));
      view.append(tabs);

      const host = h('div');
      view.append(host);
      if (state.tab === 'board') host.append(await board(data));
      else if (state.tab === 'problems') host.append(entityList(data.problems, 'problem'));
      else host.append(entityList(data.capacities, 'capacity'));

      view.append(h('div.row.gap-3.wrap.mt-4',
        h('div#match-status.row.gap-2.sm.dim', { 'aria-live': 'polite' },
          data.matches.length ? h('span', { text: ctx.t('synapse.foundMatches', { n: data.matches.length }) }) : h('span', { text: ctx.t('synapse.noMatches') })),
        h('span.grow'),
        h('button.btn.sm', { onclick: () => exportMatches(data) }, icon('download', 15), ctx.t('action.export')),
        h('button.btn.sm', { onclick: () => ctx.navigate('agente') }, icon('bot', 15), ctx.t('nav.agente')),
      ));
    }

    function exportMatches(data) {
      const payload = {
        format: 'pangea-synapse', spec: '1.0', exportedAt: new Date().toISOString(),
        problems: data.problems, capacities: data.capacities, matches: data.matches,
      };
      download(`pangea-synapse-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
      ctx.toast(ctx.t('toast.exported'), 'ok');
    }

    await paint();
    /* Primer arranque sin emparejamientos: se ofrecen, nunca se imponen. */
    if (!(await Store.count(COLLECTIONS.matches))) setTimeout(() => runMatching(), 900);

    /* El panel de mando deja una INTENCIÓN antes de traer aquí («Tengo un
     * problema» o «Puedo ayudar»). Sin esto, la persona tendría que volver a
     * buscar el botón que acaba de pulsar, que es justo lo que la acción
     * principal del panel existe para evitar. `takeIntent` la consume una sola
     * vez, así que no reaparece al volver a este módulo más tarde. */
    if (ctx.takeIntent('compose:problem')) openComposer('problem');
    else if (ctx.takeIntent('compose:capacity')) openComposer('capacity');

    return () => { unsubs.forEach((u) => { try { u(); } catch {} }); s.destroy(); };
  },
};
