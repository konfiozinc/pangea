/* ============================================================================
 * PANGEA · js/modules/simple.js
 * MODO SIMPLE — dos botones, sin leer.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * La interfaz completa está pensada para quien coordina: categorías, urgencias,
 * porcentajes de afinidad, sellos de consenso, puntos de reputación. Todo eso es
 * útil para una persona que administra una red, y es incomprensible para quien
 * tiene un problema de agua y un teléfono de veinte dólares.
 *
 * Este modo parte de la pregunta contraria: ¿cuál es la menor interfaz posible
 * que sigue siendo útil? La respuesta cabe en una pantalla:
 *
 *      ┌───────────────────────────┐
 *      │      NECESITO AYUDAR      │   ← se mantiene pulsado y se habla
 *      ├───────────────────────────┤
 *      │      PUEDO AYUDAR         │   ← se toca y se ve quién necesita qué
 *      └───────────────────────────┘
 *
 * Y nada más. Sin categorías (las deduce el motor semántico que ya existe), sin
 * urgencia (la deduce de lo que se dice), sin identidad (se crea en silencio),
 * sin formularios, sin puntuaciones, sin explicaciones.
 *
 * Todo lo que hace falta para que esto funcione ya estaba construido: el motor
 * semántico local sabe de qué se habla, la criptografía firma sin que nadie lo
 * note, y la caché offline hace que funcione donde no hay red. Lo que faltaba
 * era esconderlo.
 * ==========================================================================*/

import { h, icon, scope, clear, fmt, clamp, isOnline } from '../utils.js';
import { Store, COLLECTIONS } from '../store.js';
import { Crypto } from '../crypto.js';

/* Palabras que suben la urgencia sin preguntar nada. Se comparan sin acentos ni
 * mayúsculas. Están en los idiomas de trabajo porque quien habla no va a elegir
 * un idioma antes de pedir ayuda. */
const URGENT_WORDS = [
  // español
  'urgente', 'emergencia', 'herido', 'herida', 'sangre', 'muerto', 'muerte', 'peligro', 'peligroso',
  'ninos', 'nino', 'bebe', 'embarazada', 'incendio', 'fuego', 'derrumbe', 'inundacion', 'terremoto',
  'veneno', 'envenenado', 'no respira', 'desaparecido', 'desaparecida', 'rescate', 'auxilio', 'socorro',
  // inglés
  'urgent', 'emergency', 'injured', 'bleeding', 'dead', 'danger', 'children', 'baby', 'pregnant',
  'fire', 'flood', 'earthquake', 'poison', 'missing', 'rescue', 'help now',
  // portugués / italiano / francés
  'ferido', 'sangue', 'perigo', 'crianca', 'incendio', 'enchente', 'ferito', 'pericolo', 'bambino',
  'blesse', 'danger', 'enfant', 'inondation',
];

export default {
  id: 'simple',
  icon: 'handshake',
  accent: 'emerald',
  titleKey: 'nav.simple',
  subKey: 'home.needTitle',

  async mount(root, ctx) {
    const s = scope(root);
    const view = h('div.view.simple-view');
    root.append(view);

    const state = {
      mode: 'home',       // 'home' | 'recording' | 'done' | 'list'
      transcript: '',
      listening: false,
      recognition: null,
      published: null,
      needs: [],
      busy: false,
    };

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

    /* ------------------------------------------------------------ Utilidad -- */

    /** Normaliza para comparar sin acentos ni mayúsculas. */
    const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    /** ¿Lo que se dijo suena a emergencia? Decide la urgencia sin preguntar. */
    const detectUrgency = (text) => {
      const t = norm(text);
      const hits = URGENT_WORDS.filter((w) => t.includes(w));
      if (hits.length >= 2) return 'critical';
      if (hits.length === 1) return 'high';
      const words = t.split(/\s+/).filter(Boolean).length;
      return words > 25 ? 'medium' : 'medium';
    };

    /**
     * Elige la categoría SIN preguntar, comparando el significado de lo dicho
     * con el nombre de cada categoría usando el mismo motor semántico que usa
     * SYNAPSE. Si el motor no está disponible todavía, cae a contar palabras en
     * común. En ningún caso se le pide al usuario que elija de una lista.
     */
    const detectCategory = async (text) => {
      const cats = ctx.categories();
      if (!cats.length) return 'conocimiento';
      try {
        const vectors = await ctx.Engine.embed([text, ...cats.map((c) => ctx.catLabel(c.id))]);
        const [target, ...catVecs] = vectors;
        let best = cats[0].id, bestScore = -1;
        catVecs.forEach((v, i) => {
          const score = ctx.U.cosine(target, v);
          if (score > bestScore) { bestScore = score; best = cats[i].id; }
        });
        if (bestScore > 0.05) return best;
      } catch { /* sin motor: se usa la reserva */ }

      const words = norm(text).split(/\s+/).filter((w) => w.length > 3);
      let best = cats[0].id, bestHits = 0;
      for (const c of cats) {
        const label = norm(ctx.catLabel(c.id));
        const hits = words.filter((w) => label.includes(w) || w.includes(label.split(' ')[0])).length;
        if (hits > bestHits) { bestHits = hits; best = c.id; }
      }
      return best;
    };

    /** La identidad se crea sola la primera vez. Nunca se le menciona al usuario. */
    const ensureIdentity = async () => {
      if (await Crypto.current()) return true;
      try { await Crypto.generate({ name: '' }); return true; }
      catch { return false; }
    };

    /* -------------------------------------------------------- Publicar ----- */

    /** Toma lo dicho (o escrito) y lo publica sin pedir un solo dato más. */
    const publish = async (text) => {
      const clean = String(text || '').trim();
      if (clean.length < 4) return null;
      state.busy = true;
      await ensureIdentity();

      const [category, urgency] = await Promise.all([detectCategory(clean), Promise.resolve(detectUrgency(clean))]);

      /* Un problema para que lo encuentre el motor de emparejamiento… */
      const problem = await ctx.publish(COLLECTIONS.problems, {
        kind: 'problem',
        status: 'abierto',
        title: clean.slice(0, 90),
        body: clean,
        category,
        urgency,
        tags: [],
        location: null,
        origin: 'simple',
      });

      /* …y, si lo que se dijo suena a emergencia, además una alerta, para que
       * aparezca en el mapa de SOS sin que nadie tenga que clasificarla. */
      if (urgency === 'critical' || urgency === 'high') {
        await ctx.publish(COLLECTIONS.alerts, {
          type: 'humanitarian',
          severity: urgency,
          title: clean.slice(0, 90),
          body: clean,
          location: null,
          status: 'activa',
          confirmations: [],
          origin: 'simple',
          locationPrecision: 'approximate',
        });
      }

      state.busy = false;
      state.published = { problem, category, urgency };
      state.mode = 'done';
      ctx.U.haptic([30, 40, 30]);
      paint();
      return problem;
    };

    /* --------------------------------------------------------- Voz --------- */

    const startRecording = () => {
      state.mode = 'recording';
      state.transcript = '';
      paint();

      if (!SpeechRec) { state.listening = false; return; }
      try {
        const rec = new SpeechRec();
        rec.lang = ctx.I18n.locale || 'es-ES';
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (e) => {
          let text = '';
          for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
          state.transcript = text;
          const box = view.querySelector('#simple-live');
          if (box) box.textContent = text;
        };
        rec.onend = () => { state.listening = false; };
        rec.onerror = () => { state.listening = false; };
        rec.start();
        state.recognition = rec;
        state.listening = true;
      } catch { state.listening = false; }
    };

    const stopRecording = async () => {
      try { state.recognition?.stop(); } catch { /* ya parado */ }
      state.recognition = null;
      state.listening = false;
      const text = state.transcript.trim();
      if (text.length < 4) { state.mode = 'home'; paint(); return; }
      await publish(text);
    };

    /* -------------------------------------------------------- Necesidades -- */

    const loadNeeds = async () => {
      const [problems, alerts] = await Promise.all([
        Store.sorted(COLLECTIONS.problems, 'desc'),
        Store.sorted(COLLECTIONS.alerts, 'desc'),
      ]);
      const openProblems = problems.filter((p) => (p.status || 'abierto') === 'abierto');
      const activeAlerts = alerts.filter((a) => (a.status || 'activa') === 'activa');
      /* Las alertas van primero: si alguien está en peligro, es lo urgente. */
      state.needs = [...activeAlerts.map((a) => ({ kind: 'alert', rec: a })), ...openProblems.map((p) => ({ kind: 'problem', rec: p }))].slice(0, 40);
    };

    /* ----------------------------------------------------------- Pintado --- */

    /** Botón gigante: la unidad de interacción de esta pantalla. Mide 100 % de
     *  ancho y un tercio de alto porque se pulsa con el dedo, con prisa y a
     *  veces al sol. */
    const bigButton = (labelKey, ico, tone, handlers = {}) => h('button.simple-btn', {
      'data-tone': tone, ...handlers,
    }, icon(ico, 46), h('span.simple-btn-label', { text: ctx.t(labelKey) }));

    function paint() {
      clear(view);

      /* --- Cabecera mínima: sólo la marca y el estado de la red, con iconos. */
      view.append(h('div.simple-top',
        h('span.simple-brand', icon('globe', 26)),
        h('span.grow'),
        h('span.simple-net', { class: isOnline() ? 'ok' : 'warn', title: ctx.t(isOnline() ? 'state.online' : 'state.offline') },
          icon(isOnline() ? 'globe' : 'bolt', 20)),
      ));

      if (state.mode === 'home') {
        view.append(h('div.simple-stack',
          bigButton('home.needUrgent', 'sos', 'danger', {
            onpointerdown: (e) => { e.preventDefault(); startRecording(); },
            onpointerup: () => { if (state.mode === 'recording') stopRecording(); },
            onpointercancel: () => { if (state.mode === 'recording') stopRecording(); },
            onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); startRecording(); } },
            onkeyup: (e) => { if (e.key === ' ' || e.key === 'Enter') stopRecording(); },
          }),
          bigButton('home.needHelp', 'handshake', 'ok', {
            onclick: async () => { await loadNeeds(); state.mode = 'list'; paint(); },
          }),
        ));
        return;
      }

      /* --- Grabando: pantalla completa, sin nada que leer salvo la frase. --- */
      if (state.mode === 'recording') {
        const live = h('div.simple-live', { id: 'simple-live', text: state.transcript || '' });
        view.append(h('div.simple-full',
          h('div.simple-mic', { class: state.listening ? 'live' : '' }, icon('mic', 76)),
          h('div.simple-hint', { text: ctx.t('lingua.listening') }),
          live,
          h('button.simple-stop', {
            onclick: () => stopRecording(),
            'aria-label': ctx.t('action.stop'),
          }, icon('pause', 40)),
          !SpeechRec ? h('div.simple-warn', { text: ctx.t('lingua.notSupported') }) : null,
        ));
        return;
      }

      /* --- Publicado: un visto bueno grande y qué pasará ahora, en iconos. --- */
      if (state.mode === 'done') {
        const rec = state.published;
        view.append(h('div.simple-full',
          h('div.simple-check', icon('check', 96)),
          h('div.simple-hint', { text: ctx.t('toast.published') }),
          /* La categoría y la urgencia se muestran como información, no como
           * una pregunta: el sistema ya decidió, y se puede corregir después
           * desde la interfaz completa si alguien quiere. */
          h('div.simple-tags',
            h('span.simple-tag', icon(ctx.catIcon(rec.category), 22), h('span', { text: ctx.catLabel(rec.category) })),
            h('span.simple-tag', { class: rec.urgency === 'critical' ? 'danger' : rec.urgency === 'high' ? 'warn' : '' },
              icon('clock', 22), h('span', { text: ctx.t(`urgency.${rec.urgency}`) })),
          ),
          h('div.simple-actions',
            h('button.simple-stop.ok', {
              onclick: () => { state.mode = 'home'; state.published = null; paint(); },
              'aria-label': ctx.t('action.done'),
            }, icon('check', 40)),
          ),
        ));
        return;
      }

      /* --- Puedo ayudar: qué necesita la gente, en tarjetas enormes. --- */
      if (state.mode === 'list') {
        const list = h('div.simple-list');
        if (!state.needs.length) {
          list.append(h('div.simple-empty', icon('check', 64), h('div.simple-hint', { text: ctx.t('state.empty') })));
        }
        for (const { kind, rec } of state.needs) {
          list.append(h('button.simple-need', {
            class: kind === 'alert' ? 'alert' : '',
            onclick: () => respondTo(kind, rec),
          },
            h('span.simple-need-ico', icon(kind === 'alert' ? 'sos' : ctx.catIcon(rec.category), 34)),
            h('span.grow',
              h('span.simple-need-title', { text: String(rec.title || rec.body || '').slice(0, 120) }),
              h('span.simple-need-meta',
                h('span', { text: ctx.t(`urgency.${rec.urgency || rec.severity || 'medium'}`) }),
                rec.seed ? h('span', { text: '· ' + ctx.t('state.demo') }) : null,
              ),
            ),
            h('span.simple-need-go', icon('handshake', 30)),
          ));
        }
        view.append(h('div.simple-full.scroll',
          h('div.simple-list-head', h('span.simple-hint', { text: ctx.t('synapse.colOpen') })),
          list,
          h('button.simple-stop', {
            onclick: () => { state.mode = 'home'; paint(); },
            'aria-label': ctx.t('action.back'),
          }, icon('back', 40)),
        ));
      }
    }

    /** Responder: un solo toque, sin formulario. Se ofrece lo más común y se
     *  puede escribir si hace falta, pero no es obligatorio para ayudar. */
    async function respondTo(kind, rec) {
      await ensureIdentity();
      const author = await ctx.author();
      if (kind === 'alert') {
        await ctx.publish(COLLECTIONS.responses, {
          alertId: rec.id,
          responder: author,
          resources: ['skills'],
          message: '',
          origin: 'simple',
        });
      } else {
        await ctx.publish(COLLECTIONS.capacities, {
          kind: 'capacity',
          title: ctx.t('home.needHelp') + ' · ' + String(rec.title || '').slice(0, 70),
          body: String(rec.body || ''),
          category: rec.category,
          availability: 'disponible',
          resources: [],
          langs: [ctx.I18n.lang],
          tags: [],
          location: null,
          origin: 'simple',
        });
      }
      toast(ctx.t('toast.saved'));
      state.mode = 'home';
      paint();
    }

    const toast = (m) => ctx.toast(m, 'ok');

    /* ---------------------------------------------------------- Arranque --- */
    await loadNeeds();
    paint();

    return () => {
      try { state.recognition?.abort?.(); } catch { /* ya parado */ }
      s.destroy();
    };
  },
};
