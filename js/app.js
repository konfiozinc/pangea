/* ============================================================================
 * PANGEA · js/app.js
 * Núcleo de la aplicación: contexto compartido, router por hash, armazón de
 * navegación, onboarding, notificaciones, panel de mando y ajustes.
 *
 * Cada módulo exporta por defecto:
 *   { id, icon, accent, titleKey, subKey, async mount(container, ctx) → cleanup }
 * ==========================================================================*/

import { Store, COLLECTIONS } from './store.js';
import { Crypto } from './crypto.js';
import { I18n, t, LANGUAGES } from './i18n.js';
import { Engine } from './engine.js';
import * as U from './utils.js';
import { h, icon, clear, scope, fmt, deviceTier, storageEstimate, download, readText, zipSync, getPosition, prefersReducedMotion, debounce } from './utils.js';

/* Registro de módulos. El orden define la navegación.
 *
 * Aquí sólo se importa la FICHA de cada módulo —nombre, icono, color—, que es lo
 * que hace falta para dibujar el menú. El CÓDIGO se carga al entrar en cada
 * pantalla, con `cargarModulo()`. Antes se importaban los ocho de golpe, y como
 * un módulo no puede ejecutarse hasta que su lista de dependencias está
 * completa, el navegador tenía que bajar 298 KB más antes de pintar nada: en una
 * conexión mala, varios segundos de pantalla de arranque.
 *
 * Los archivos siguen precargados por el Service Worker, así que funcionar sin
 * conexión no cambia: se guardan al instalar la aplicación, no al visitar cada
 * pantalla. */
import { MODULES, cargarModulo } from './modules/manifest.js';

const VERSION = '1.0.0';
const ROUTES = ['home', ...MODULES.map((m) => m.id), 'profile', 'settings'];

/* Alias de ruta: nombres alternativos que la gente escribe de forma natural.
 * `#/dashboard` y `#/inicio` llevan al mismo sitio que `#/`, y `perfil` a
 * `profile`. Cuestan dos líneas y evitan que alguien acabe en el panel por
 * haber escrito la dirección «equivocada». */
const ROUTE_ALIASES = {
  dashboard: 'home', inicio: 'home', panel: 'home', home: 'home',
  perfil: 'profile', profile: 'profile',
};

/**
 * Interpreta el hash de la barra de direcciones.
 * Devuelve la ruta canónica y el parámetro de la ruta
 * (`#/profile/PAN-XXXX` → `{ route: 'profile', param: 'PAN-XXXX' }`), además
 * de la cadena de consulta si la hay.
 */
function parseHash() {
  const raw = String(location.hash || '').replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const segments = path.split('/').filter(Boolean);
  const head = segments.shift() || 'home';
  const canonical = ROUTE_ALIASES[head] || head;
  return {
    route: ROUTES.includes(canonical) ? canonical : 'home',
    param: segments.length ? decodeURIComponent(segments.join('/')) : null,
    query: query ? Object.fromEntries(new URLSearchParams(query)) : {},
  };
}

/* -------------------------------------------------------------- Estado ---- */

const state = {
  route: 'home',
  param: null,
  query: {},
  identity: null,
  taxonomy: [],
  lite: false,
  online: U.isOnline(),
  tier: deviceTier(),
  syncing: false,
  installEvent: null,
  engineWarm: false,
  engineAnnounced: false,
};

let activeCleanup = null;
const viewEl = () => document.getElementById('view');

/** Intenciones de un solo uso entre vistas (ver `ctx.setIntent`). */
const intents = new Map();

/* ----------------------------------------------------------- Notificar ---- */

const TOAST_ICON = { ok: 'check', err: 'sos', warn: 'sos', info: 'spark' };

export function toast(message, type = 'info', { timeout = 4200 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h('div.toast', { class: type, role: 'status', 'aria-live': 'polite' },
    icon(TOAST_ICON[type] || 'spark', 18),
    h('div.grow', { text: String(message) }),
  );
  const kill = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 220); };
  el.addEventListener('click', kill);
  host.append(el);
  if (timeout) setTimeout(kill, timeout);
  return kill;
}

/* --------------------------------------------------------------- Modales -- */

export function openModal({ title = '', iconName = null, body = null, actions = [], size = '' } = {}) {
  const s = scope(document);
  const bodyEl = h('div.modal-body');
  if (body) bodyEl.append(body);

  const close = () => {
    dialog.classList.add('leaving');
    s.destroy();
    setTimeout(() => backdrop.remove(), 180);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  const foot = actions.length
    ? h('div.modal-foot', ...actions.map((a) => h('button.btn', {
        class: [a.variant || '', a.variant === 'primary' ? 'primary' : ''].join(' ').trim(),
        onclick: async () => { const r = await a.onClick?.(); if (r !== false) close(); },
      }, a.iconName ? icon(a.iconName, 18) : null, a.label)))
    : null;

  const dialog = h('div.modal', { class: size, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-head',
      h('h2.row.gap-2', iconName ? icon(iconName, 22) : null, h('span', { text: title })),
      h('button.btn.icon.ghost.sm', { onclick: close, 'aria-label': t('a11y.closeModal') }, icon('x', 18)),
    ),
    bodyEl,
    foot,
  );
  const backdrop = h('div.modal-backdrop', { onclick: (e) => { if (e.target === backdrop) close(); } }, dialog);
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey);
  const focusable = dialog.querySelector('input, textarea, select, button:not([aria-label])');
  setTimeout(() => focusable?.focus(), 60);
  return { close, el: dialog, body: bodyEl, scope: s };
}

export function confirmDialog({ title, body, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    const m = openModal({
      title: title || t('action.confirm'),
      iconName: danger ? 'sos' : 'shield',
      size: 'narrow',
      body: h('p', { class: 'sm', text: body || '' }),
      actions: [
        { label: t('action.cancel'), onClick: () => resolve(false) },
        { label: confirmLabel || t('action.confirm'), variant: danger ? 'danger' : 'primary', onClick: () => resolve(true) },
      ],
    });
    m.el.addEventListener('click', (e) => { if (e.target.closest('.modal-head button')) resolve(false); });
    m.el.parentElement.addEventListener('click', (e) => { if (e.target === m.el.parentElement) resolve(false); });
  });
}

export function askDialog({ title, label, value = '', placeholder = '', type = 'text', multiline = false, required = true }) {
  return new Promise((resolve) => {
    const input = multiline
      ? h('textarea.textarea', { placeholder, value })
      : h('input.input', { type, placeholder, value });
    openModal({
      title, iconName: 'edit', size: 'narrow',
      body: h('div.field', h('label.label', label), input),
      actions: [
        { label: t('action.cancel'), onClick: () => resolve(null) },
        {
          label: t('action.save'), variant: 'primary',
          onClick: () => {
            const v = (input.value || '').trim();
            if (required && !v) { toast(t('toast.fieldsRequired'), 'warn'); return false; }
            resolve(v); 
          },
        },
      ],
    });
    setTimeout(() => input.focus(), 80);
  });
}

/* --------------------------------------------------------------- Router --- */

export function navigate(route, { replace = false } = {}) {
  const clean = String(route).replace(/^#\/?/, '') || 'home';
  const target = ROUTES.includes(clean) ? clean : 'home';
  const hash = `#/${target}`;
  if (location.hash === hash) { render(); return; }
  if (replace) history.replaceState(null, '', hash); else location.hash = hash;
  if (replace) render();
}

export const currentRoute = () => state.route;

async function render() {
  const parsed = parseHash();
  state.route = parsed.route;
  state.param = parsed.param;
  state.query = parsed.query;

  if (typeof activeCleanup === 'function') { try { activeCleanup(); } catch (e) { console.error(e); } }
  activeCleanup = null;

  const host = viewEl();
  if (!host) return;
  clear(host);
  /* Al entrar en un perfil, la navegación resalta el panel: si no, ningún
   * elemento quedaría activo y el usuario perdería la referencia de dónde está. */
  markNav(state.route === 'profile' ? 'home' : state.route);

  const mod = MODULES.find((m) => m.id === state.route);
  const titleOf = state.route === 'settings' ? t('settings.title')
    : state.route === 'profile' ? t('profile.title')
      : mod ? t(mod.titleKey) : t('home.title');
  document.title = `${titleOf} · PANGEA`;
  setTopbarTitle(titleOf);

  try {
    if (state.route === 'home') activeCleanup = await renderHome(host);
    else if (state.route === 'settings') activeCleanup = await renderSettings(host);
    else if (state.route === 'profile') activeCleanup = await renderProfile(host, state.param);
    else {
      /* El código del módulo se descarga aquí, al entrar. La ficha ya se tiene,
       * así que el título y el menú ya están pintados: lo único que se espera es
       * el módulo en sí, y a partir de la segunda visita está en la caché. */
      const impl = await cargarModulo(state.route);
      activeCleanup = await impl.mount(host, ctx);
    }
  } catch (e) {
    console.error('[pangea] error al montar', state.route, e);
    host.append(h('div.view', h('div.banner.danger',
      icon('sos', 20),
      h('div', h('strong', { text: t('state.error') }), h('div.small', { text: String(e && e.message || e) })),
    )));
  }

  /* El motor neuronal (MiniLM, ~20 MB) NUNCA se descarga sin permiso. En un
   * proyecto que promete funcionar en un teléfono de 20 dólares y respetar los
   * datos del usuario, gastar 20 MB de su plan sin avisar sería una traición a
   * esos principios. Se pregunta una sola vez, se recuerda la respuesta y el
   * motor local por n-gramas sigue cubriendo el trabajo mientras tanto. */
  if ((state.route === 'synapse' || state.route === 'agente') && !state.lite && U.isOnline()) {
    const pref = await Store.kv('pref.engine', null);
    if (pref === 'neural' && !state.engineWarm) {
      state.engineWarm = true;
      Engine.warmup().catch(() => { /* degradación silenciosa al motor local */ });
    } else if (pref === null) {
      askNeuralEngine();
    }
  }
  document.getElementById('main')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function setTopbarTitle(txt) {
  const el = document.getElementById('topbar-title');
  if (el) el.textContent = txt;
}

/**
 * Marca el elemento de navegación activo.
 * Se le pasa la ruta a resaltar, que no siempre coincide con `state.route`
 * (por ejemplo, un perfil resalta el panel).
 */
function markNav(route = state.route) {
  document.querySelectorAll('[data-route]').forEach((el) => {
    const isCurrent = el.dataset.route === route;
    if (isCurrent) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
}

/* ------------------------------------------------- Contexto compartido ---- */

export const ctx = {
  t, h, icon, U, I18n, Store, Crypto, Engine, COLLECTIONS, LANGUAGES,
  state, VERSION,
  toast, openModal, confirm: confirmDialog, ask: askDialog, navigate, currentRoute,
  render, get viewEl() { return viewEl(); },

  /** Suscripción al almacén con limpieza automática por vista. */
  onStore(collection, fn) { return Store.on(collection, fn); },

  /** Re-renderiza la vista actual (tras cambios externos). */
  refresh: debounce(() => render(), 40),

  /** Abre el perfil público de una identidad. */
  navigateProfile: (fingerprint) => navigate(`profile/${encodeURIComponent(fingerprint)}`),

  /**
   * Intención de un solo uso entre vistas.
   *
   * La acción principal del panel («Tengo un problema», «Puedo ayudar»…) debe
   * poder abrir directamente el formulario correspondiente en su módulo. En
   * lugar de que el panel conozca la estructura interna de cada módulo, deja
   * una intención y el módulo la recoge al montarse. Caduca sola para que una
   * intención vieja no sorprenda a nadie media hora después.
   */
  setIntent(name, payload = true) { intents.set(name, { payload, at: Date.now() }); },

  /** Recoge una intención si sigue vigente. Devuelve `null` si no hay ninguna. */
  takeIntent(name, maxAgeMs = 15000) {
    const entry = intents.get(name);
    if (!entry) return null;
    intents.delete(name);
    if (Date.now() - entry.at > maxAgeMs) return null;
    return entry.payload;
  },

  /** Categorías de la taxonomía compartida. */
  categories: () => state.taxonomy,
  catLabel: (id) => (state.taxonomy.find((c) => c.id === id) ? t(`cat.${id}`) : id),
  catColor: (id) => (state.taxonomy.find((c) => c.id === id) || {}).color || 'var(--primary)',
  catIcon: (id) => (state.taxonomy.find((c) => c.id === id) || {}).icon || 'flag',

  /** Exige identidad NEXUS; si no existe, avisa y lleva a NEXUS ID. */
  async requireIdentity(silent = false) {
    const id = await Crypto.current();
    if (!id) { if (!silent) toast(t('toast.noIdentity'), 'warn'); return null; }
    return id;
  },

  /**
   * Autoría normalizada para cualquier registro firmado.
   * Forma estable que todos los módulos comparten.
   */
  async author() {
    const id = await Crypto.current();
    if (!id) return { fingerprint: 'local-anon', name: '—', anon: true };
    return { fingerprint: id.fingerprint, name: id.name || id.fingerprint.slice(4, 13), anon: false };
  },

  /**
   * Firma y persiste un registro en una colección.
   *
   * El identificador y la fecha se generan aquí para que el registro quede
   * completo antes de guardarse. No forman parte de lo que se firma (ver la
   * lista NOT_SIGNED en crypto.js): la firma acredita la autoría del contenido,
   * no los metadatos de almacenamiento.
   */
  async publish(collection, payload) {
    const author = await ctx.author();
    const base = {
      id: payload.id || U.uid(String(collection).slice(0, 4)),
      createdAt: payload.createdAt || Date.now(),
      ...payload,
      author,
      lang: payload.lang || I18n.lang,
    };
    const signed = author.anon ? base : await Crypto.signed(base);
    const rec = await Store.put(collection, signed);
    return rec;
  },

  /** Verifica un registro firmado y devuelve un veredicto legible. */
  async verifyRecord(rec) {
    if (!rec || !rec.sig) return { valid: false, label: t('state.unverified'), fingerprint: null };
    const ok = await Crypto.verify(rec);
    const fp = rec.sig.fp || (rec.sig.pub ? await Crypto.fingerprintOf(rec.sig.pub) : null);
    return { valid: ok, label: ok ? t('state.verified') : t('state.unverified'), fingerprint: fp };
  },

  /** Suma reputación portable, firmada criptográficamente. */
  async awardPoints(points, reason, to = null) {
    const me = await Crypto.current();
    const att = me ? await Crypto.attest({ to: to || me.fingerprint, points, reason }) : null;
    await Store.put(COLLECTIONS.events, { type: 'points', message: reason, meta: { points, attestation: att } });
    await Store.log('reputacion', `${points} Pangea Points · ${reason}`, { points });
    return att;
  },

  async points() {
    const events = await Store.query(COLLECTIONS.events, (e) => e.type === 'points');
    return events.reduce((n, e) => n + (e.meta?.points || 0), 0);
  },

  /** Empaqueta el estado para exportar (Pasaporte PANGEA). */
  async exportPassport() {
    const data = await Store.exportAll();
    const me = await Crypto.current();
    const manifest = {
      format: 'pangea-passport',
      spec: '1.0',
      app: 'PANGEA', version: VERSION,
      exportedAt: new Date().toISOString(),
      identity: me ? { fingerprint: me.fingerprint, name: me.name, pub: me.pub } : null,
      counts: data.counts,
    };
    const signed = me ? await Crypto.signed(manifest) : manifest;
    return { manifest: signed, data };
  },

  /** Descarga un pasaporte completo firmado en ZIP. */
  async downloadPassport() {
    const { manifest, data } = await ctx.exportPassport();
    const total = Object.values(data.counts || {}).reduce((a, b) => a + b, 0);
    const blob = zipSync([
      { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
      { name: 'data.json', data: JSON.stringify(data, null, 2) },
      { name: 'README.txt', data: passportReadme(manifest) },
    ]);
    download(`pangea-passport-${new Date().toISOString().slice(0, 10)}.pangea.zip`, blob, 'application/zip');
    return total;
  },
};

function passportReadme(manifest) {
  return [
    'PANGEA · PASAPORTE DE INTELIGENCIA COLECTIVA',
    '=============================================',
    '',
    'Este archivo contiene tus contribuciones, tu reputación firmada y tus',
    'ajustes. Es tuyo: nadie más lo controla.',
    '',
    `Huella: ${manifest.identity ? manifest.identity.fingerprint : 'sin identidad'}`,
    `Exportado: ${manifest.exportedAt}`,
    `Firma: ${manifest.sig ? manifest.sig.sig.slice(0, 48) + '…' : 'no firmado'}`,
    '',
    'QUÉ NO CONTIENE, Y POR QUÉ',
    '--------------------------',
    'Tu CLAVE PRIVADA no viaja en este archivo. Un pasaporte está pensado para',
    'llevarse en un USB o compartirse, así que incluir la clave privada aquí la',
    'expondría en claro. La identidad se exporta aparte, cifrada con contraseña,',
    'desde NEXUS ID → Exportar identidad cifrada (formato PANGEA-ID-1).',
    'Tampoco se incluyen las claves de API que hayas configurado.',
    '',
    'Cómo usarlo:',
    '  1. Abre PANGEA en cualquier dispositivo.',
    '  2. Ve a NEXUS ID → Importar datos y selecciona este archivo .zip',
    '     (o el data.json que contiene dentro).',
    '  3. Para recuperar tu IDENTIDAD, usa el archivo PANGEA-ID-1 y su',
    '     contraseña, en NEXUS ID → Importar identidad.',
    '',
    'Formato abierto y documentado en docs/PROTOCOLO-PANGEA.md.',
    'Código bajo licencia MIT · Contenido bajo Creative Commons BY-SA.',
  ].join('\n');
}

/* --------------------------------------------------------------- Tema ----- */

const THEMES = ['auto', 'light', 'dark'];

export async function applyTheme(pref) {
  const root = document.documentElement;
  if (pref === 'auto' || !pref) {
    root.removeAttribute('data-theme');
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', pref);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', root.getAttribute('data-theme') === 'dark' ? '#0A0E1A' : '#FAFBFF');
  return pref;
}

/* ------------------------------------------------------------ Panel home -- */

async function renderHome(host) {
  const view = h('div.view');
  host.append(view);
  const s = scope(view);
  /* Las cuatro lecturas van EN PARALELO. Encadenadas eran cuatro viajes de ida
   * y vuelta a IndexedDB antes de poder pintar nada; juntas son uno. En un
   * teléfono lento esa diferencia se ve en el primer pintado. */
  const [stats, points, allEvents, me] = await Promise.all([
    Store.stats(),
    ctx.points(),
    Store.sorted(COLLECTIONS.events, 'desc'),
    Crypto.current(),
  ]);
  const events = allEvents.slice(0, 6);
  const name = me?.name || (me ? me.fingerprint.slice(4, 12) : '');

  /* ACCIÓN PRINCIPAL: «¿Qué necesitas?».
   * Es lo primero que debe entender quien abre esto por primera vez. Cada
   * opción deja una intención y lleva al módulo que la resuelve, de modo que
   * el panel no necesita conocer la estructura interna de ningún módulo. */
  const needBtn = (labelKey, ico, tone, onClick) => h('button.need-btn', {
    'data-tone': tone, onclick: onClick,
  }, icon(ico, 20), h('span', { text: t(labelKey) }));

  view.append(
    h('section.hero',
      h('div.hero-inner',
        h('div.hero-badges',
          h('span.badge.primary', icon('spark', 13), 'PANGEA v' + VERSION),
          h('span.badge', { class: state.online ? 'ok' : 'warn' }, icon(state.online ? 'globe' : 'bolt', 13), t(state.online ? 'state.online' : 'state.offline')),
          h('span.badge', icon('lock', 13), t('app.localFirst')),
        ),
        h('h1', { class: 'aurora-text', text: name ? t('home.welcome', { name }) : t('app.tagline') }),
        h('p.hero-sub', { text: t('app.mission') }),

        /* Puerta al modo simple, arriba y con peso visual: es la interfaz que
         * sirve a quien no lee, y no debería estar escondida entre las demás. */
        h('button.btn.aurora.lg', {
          onclick: () => navigate('simple'),
        }, icon('handshake', 20), t('nav.simple')),

        h('div.need-block',
          h('h2.need-title', { text: t('home.needTitle') }),
          h('div.need-grid',
            needBtn('home.needProblem', 'flag', 'primary', () => { ctx.setIntent('compose:problem'); navigate('synapse'); }),
            needBtn('home.needHelp', 'handshake', 'accent', () => { ctx.setIntent('compose:capacity'); navigate('synapse'); }),
            needBtn('home.needKnowledge', 'book', 'amber', () => { ctx.setIntent('compose:knowledge'); navigate('memoria'); }),
            needBtn('home.needVerify', 'shield', 'cyan', () => { ctx.setIntent('compose:claim'); navigate('veritas'); }),
            needBtn('home.needUrgent', 'sos', 'danger', () => { ctx.setIntent('compose:alert'); navigate('sos'); }),
          ),
        ),
      ),
    ),
  );

  /* Métricas */
  const metricCard = (labelKey, value, ico, to) => h('button.card.interactive', {
    style: 'text-align:start', onclick: () => to && navigate(to),
  }, h('div.stat',
    h('div.row.between', h('span.stat-label', { text: t(labelKey) }), icon(ico, 20, 'stat-icon')),
    h('div.stat-value', { text: fmt.num(value) }),
  ));

  view.append(h('div.grid.grid-4.mt-6',
    metricCard('home.statProblems', stats.problems, 'flag', 'synapse'),
    metricCard('home.statMatches', stats.matches, 'network', 'synapse'),
    metricCard('home.statResolved', stats.resolved, 'check', 'synapse'),
    metricCard('home.statClaims', stats.claims, 'shield', 'veritas'),
    metricCard('home.statKnowledge', stats.knowledge, 'book', 'memoria'),
    metricCard('home.statAlerts', stats.alerts, 'sos', 'sos'),
    metricCard('home.statVocab', stats.vocab, 'translate', 'lingua'),
    metricCard('synapse.tabCapacities', stats.capacities, 'handshake', 'synapse'),
  ));

  /* Gráficos + reputación */
  const chartCard = h('div.card', h('div.card-head', h('h3', { text: t('home.impactTitle') })),
    h('div.card-body', h('div.chart-box', h('canvas', { id: 'chart-impact' }))));
  const pointsBody = h('div.card-body',
    h('div.points-big.aurora-text', { text: fmt.num(points) }),
    h('div.small.dim.mb-4', { text: t('synapse.points') }),
    h('p.sm.dim', { text: t('home.pointsBody') }),
    h('button.btn.sm.mt-4', { onclick: () => navigate('nexus') }, icon('id', 16), t('nexus.title')),
  );
  view.append(h('div.grid.grid-2.mt-6',
    chartCard,
    h('div.card', h('div.card-head', h('h3', { text: t('home.pointsTitle') }), h('span.badge.primary', icon('bolt', 12), fmt.num(points))), pointsBody),
  ));

  /* Acciones rápidas */
  view.append(h('h2.section-title.mt-6', { text: t('home.quickTitle') }));
  view.append(h('div.module-map', ...MODULES.map((m) => h('button.module-tile', {
    'data-accent': m.accent || 'indigo', onclick: () => navigate(m.id),
  },
    h('span.tile-ico', icon(m.icon, 20)),
    h('span.grow',
      h('span.tile-name', { text: t(m.titleKey) }),
      h('span.tile-desc', { text: t(m.subKey) }),
    ),
  ))));

  /* Actividad */
  view.append(h('h2.section-title.mt-6', { text: t('home.activityTitle') }));
  view.append(events.length
    ? h('div.card', h('div.card-body', h('div.timeline', ...events.map((e) => h('div.timeline-item', { class: e.type === 'reputacion' ? 'ok' : '' },
        h('div.row.between.gap-3',
          h('div.sm', { text: e.message || e.type }),
          h('time.timeline-time', { text: fmt.rel(e.createdAt, I18n.lang) }),
        ),
      )))))
    : h('div.empty', icon('clock', 30), h('div.empty-title', { text: t('state.empty') }), h('div.empty-body', { text: t('home.noActivity') })));

  /* Gráfico de impacto: contribuciones por módulo y por día */
  if (window.Chart && !state.lite) {
    s.timeout(() => {
      const canvas = view.querySelector('#chart-impact');
      if (!canvas) return;
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      const grid = dark ? 'rgba(147,160,188,.14)' : 'rgba(11,18,32,.07)';
      const ink = dark ? '#93A0BC' : '#5A6478';
      const data = [stats.problems, stats.capacities, stats.claims, stats.knowledge, stats.alerts, stats.vocab];
      const labels = [t('synapse.tabProblems'), t('synapse.tabCapacities'), t('veritas.title'), t('memoria.title'), t('sos.title'), t('lingua.tabDictionary')];
      let chart;
      try {
        chart = new window.Chart(canvas, {
          type: 'doughnut',
          data: { labels, datasets: [{ data, backgroundColor: ['#6366F1', '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#EC4899'], borderWidth: 0, spacing: 2, hoverOffset: 6 }] },
          options: {
            responsive: true, maintainAspectRatio: false, cutout: '62%',
            plugins: {
              legend: { position: 'right', labels: { color: ink, boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 } } },
              tooltip: { padding: 10, cornerRadius: 8 },
            },
          },
        });
      } catch (e) { console.warn('[pangea] chart', e); }
      if (chart) s.on(window, 'beforeunload', () => chart.destroy());
    }, 60);
  } else {
    view.querySelector('#chart-impact')?.replaceWith(h('div.empty', icon('chart', 28), h('div.empty-body', { text: t('settings.liteModeHint') })));
  }

  return () => s.destroy();
}

/* --------------------------------------------------------------- Perfil --- */

/** De dónde se recogen las contribuciones de una identidad, y cómo se titulan. */
const PROFILE_SOURCES = [
  { collection: 'problems', navKey: 'nav.synapse', ico: 'flag', text: (r) => r.title },
  { collection: 'capacities', navKey: 'nav.synapse', ico: 'handshake', text: (r) => r.title },
  { collection: 'claims', navKey: 'nav.veritas', ico: 'shield', text: (r) => r.text },
  { collection: 'knowledge', navKey: 'nav.memoria', ico: 'book', text: (r) => r.title },
  { collection: 'alerts', navKey: 'nav.sos', ico: 'sos', text: (r) => r.title },
  { collection: 'vocab', navKey: 'nav.lingua', ico: 'translate', text: (r) => r.word },
];

/**
 * Perfil público de una identidad.
 *
 * Existe para cerrar el flujo más importante de todo el programa: publicar un
 * problema, recibir un emparejamiento y **ver quién está al otro lado** antes
 * de decidir si se colabora. Sin esto, el emparejamiento era un número sin
 * persona detrás.
 *
 * La autoría no se afirma: se demuestra. La huella se comprueba recalculándola
 * desde la clave pública que realmente firmó, y eso se le enseña al usuario.
 */
async function renderProfile(host, fingerprint) {
  const view = h('div.view');
  host.append(view);
  const s = scope(view);

  if (!fingerprint) {
    view.append(h('div.empty', icon('users', 30), h('div.empty-title', { text: t('profile.noProfile') })));
    return () => s.destroy();
  }

  const me = await Crypto.current();
  const isSelf = !!(me && me.fingerprint === fingerprint);

  /* Contribuciones de esa identidad en todo lo almacenado en este dispositivo. */
  const items = [];
  const areaCount = new Map();
  let earliest = null;
  for (const src of PROFILE_SOURCES) {
    for (const rec of await Store.all(COLLECTIONS[src.collection])) {
      if (!rec || rec.author?.fingerprint !== fingerprint) continue;
      items.push({ src, rec });
      if (rec.category) areaCount.set(rec.category, (areaCount.get(rec.category) || 0) + 1);
      const at = rec.createdAt || 0;
      if (at && (!earliest || at < earliest)) earliest = at;
    }
  }
  items.sort((a, b) => (b.rec.createdAt || 0) - (a.rec.createdAt || 0));

  /* Verificación real: se comprueban las firmas de las contribuciones más
   * recientes. En modo ligero se comprueban menos, porque cada ECDSA cuesta. */
  const limit = state.lite ? 3 : 10;
  let signedOk = 0;
  let signatureChecked = 0;
  let pubKey = null;
  for (const item of items.slice(0, limit)) {
    if (!item.rec.sig) continue;
    signatureChecked++;
    if (!pubKey && item.rec.sig.pub) pubKey = item.rec.sig.pub;
    const verdict = await ctx.verifyRecord(item.rec);
    if (verdict.valid) signedOk++;
  }
  const identityProven = signatureChecked > 0 && signedOk === signatureChecked;
  const anySignature = signatureChecked > 0;

  const name = items.find((i) => i.rec.author?.name)?.rec.author.name || (isSelf ? me?.name : null) || null;
  const hue = fmt.hueOf(fingerprint);

  /* Reputación: solo se muestra lo que este dispositivo puede comprobar. */
  const events = await Store.query(COLLECTIONS.events, (e) => e.type === 'points');
  const received = events
    .map((e) => e.meta?.attestation)
    .filter((a) => a && a.to === fingerprint);
  const points = isSelf
    ? events.reduce((n, e) => n + (e.meta?.points || 0), 0)
    : received.reduce((n, a) => n + (a.points || 0), 0);

  /* ----------------------------------------------------------- Cabecera --- */
  view.append(h('div.view-header',
    h('div.view-heading',
      h('h1.view-title', icon('users', 26), name || t('profile.title')),
      h('p.view-sub.mono', { text: fingerprint }),
    ),
    h('div.view-actions',
      h('button.btn', { onclick: () => navigate('home') }, icon('back', 16), t('action.back')),
      anySignature
        ? h('span.badge', { class: identityProven ? 'ok' : 'warn' },
            icon(identityProven ? 'check' : 'sos', 12),
            t(identityProven ? 'profile.identityValid' : 'profile.identityInvalid'))
        : h('span.badge', icon('clock', 12), t('state.unverified')),
    ),
  ));

  /* -------------------------------------------------- Tarjeta de identidad - */
  view.append(h('div.card.aurora.mb-4',
    h('div.card-body.stack',
      h('div.id-hero',
        h('span.avatar.lg', {
          style: `background:linear-gradient(135deg, hsl(${hue} 68% 56%), hsl(${(hue + 60) % 360} 68% 48%))`,
          text: fmt.initials(name || fingerprint.slice(4, 6)),
        }),
        h('div.grow',
          h('div.id-fingerprint.aurora-text', { text: fingerprint }),
          h('div.tiny.dim.mt-2', {
            text: [
              earliest ? `${t('profile.since')} ${fmt.date(earliest, I18n.lang)}` : null,
              isSelf ? t('nexus.title') : null,
            ].filter(Boolean).join(' · ') || '—',
          }),
        ),
      ),
      h('div.grid.grid-3',
        h('div.stat',
          h('span.stat-label', { text: t('profile.signedContributions') }),
          h('span.stat-value', { text: fmt.num(signedOk, I18n.lang) })),
        h('div.stat',
          h('span.stat-label', { text: t('synapse.reputation') }),
          h('span.stat-value', { text: fmt.num(points, I18n.lang) })),
        h('div.stat',
          h('span.stat-label', { text: t('profile.areas') }),
          h('span.stat-value', { text: fmt.num(areaCount.size, I18n.lang) })),
      ),
      anySignature
        ? h('div.banner', { class: identityProven ? 'ok' : 'warn' },
            icon(identityProven ? 'shield' : 'sos', 20),
            h('div',
              h('strong', { text: t(identityProven ? 'profile.identityValid' : 'profile.identityInvalid') }),
              h('div.sm', { text: t('nexus.trustBody') }),
            ))
        : h('div.banner', icon('clock', 20), h('div', h('strong', { text: t('state.unverified') }), h('div.sm', { text: t('app.needIdentity') }))),
    ),
  ));

  /* --------------------------------------------------------------- Áreas -- */
  if (areaCount.size) {
    view.append(h('h2.section-title', { text: t('profile.areas') }));
    view.append(h('div.chips.mb-6', ...[...areaCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cat, n]) => h('span.chip.static',
        h('span.cat-dot', { style: `background:${ctx.catColor(cat)}` }),
        h('span', { text: ctx.catLabel(cat) }),
        h('span.badge.mono', { text: String(n) }),
      ))));
  }

  /* --------------------------------------------------------- Contribuciones */
  view.append(h('h2.section-title', { text: t('profile.signedContributions') }));
  if (!items.length) {
    view.append(h('div.empty', icon('file', 28),
      h('div.empty-title', { text: t('state.empty') }),
      h('div.empty-body', { text: t('home.noActivity') })));
  } else {
    const list = h('div.list');
    for (const { src, rec } of items.slice(0, 30)) {
      const verdict = rec.sig ? await ctx.verifyRecord(rec) : { valid: false, fingerprint: null };
      list.append(h('div.list-item',
        h('span.avatar.sm', { style: 'background:var(--primary-bg);color:var(--primary)' }, icon(src.ico, 15)),
        h('div.grow',
          h('div.sm.truncate', { text: String(src.text(rec) || rec.id) }),
          h('div.tiny.dim', { text: `${t(src.navKey)} · ${fmt.rel(rec.createdAt, I18n.lang)}` }),
        ),
        rec.sig
          ? h('span.sig', { class: verdict.valid ? 'valid' : 'invalid', title: verdict.valid ? t('nexus.signatureValid') : t('nexus.signatureInvalid') },
              icon(verdict.valid ? 'check' : 'x', 11), String(verdict.fingerprint || '').slice(4, 13))
          : h('span.badge', { text: t('state.unverified') }),
      ));
    }
    view.append(h('div.card.mb-4', h('div.card-body.flush', list)));
  }

  /* ------------------------------------------------------------ Contacto -- */
  const contactCard = async () => {
    const card = {
      format: 'pangea-contact',
      spec: '1.0',
      fingerprint,
      name: name || null,
      verified: identityProven,
      publicKey: pubKey,
      contributions: items.length,
      areas: [...areaCount.keys()],
      exportedAt: new Date().toISOString(),
    };
    return isSelf ? await Crypto.signed(card) : card;
  };

  view.append(h('div.card.mb-4',
    h('div.card-head', h('h3', { text: t('profile.contact') })),
    h('div.card-body.stack',
      /* Honestidad deliberada: PANGEA no tiene mensajería porque no tiene
       * servidores. Decirlo aquí evita que alguien espere un chat que nunca
       * va a aparecer y explica qué hacer en su lugar. */
      h('p.sm.dim', { text: t('profile.noMessaging') }),
      h('div.row.gap-2.wrap',
        h('button.btn.primary', {
          onclick: async () => {
            const card = await contactCard();
            await U.copyText(JSON.stringify(card, null, 2));
            toast(t('toast.copied'), 'ok');
          },
        }, icon('copy', 17), t('profile.contactCard')),
        h('button.btn', {
          onclick: async () => {
            const card = await contactCard();
            U.download(`pangea-contacto-${fingerprint.replace(/[^A-Z0-9]/gi, '')}.json`, JSON.stringify(card, null, 2), 'application/json');
            toast(t('toast.exported'), 'ok');
          },
        }, icon('download', 17), t('action.download')),
        isSelf ? null : h('button.btn', {
          onclick: () => { ctx.setIntent('compose:capacity'); navigate('synapse'); },
        }, icon('handshake', 17), t('home.needHelp')),
      ),
      h('p.hint', { text: t('nexus.passportBody') }),
    ),
  ));

  return () => s.destroy();
}

/* ------------------------------------------------------------ Ajustes ----- */

async function renderSettings(host) {
  const view = h('div.view');
  host.append(view);
  const s = scope(view);

  const theme = await Store.kv('pref.theme', 'auto');
  const lite = await Store.kv('pref.lite', state.tier === 'lite');
  const node = await Store.kv('pref.node', '');
  const est = await storageEstimate();
  const me = await Crypto.current();

  view.append(h('div.view-header',
    h('div.view-heading',
      h('h1.view-title', icon('settings', 26), t('settings.title')),
      h('p.view-sub', { text: t('settings.privacyBody') }),
    ),
  ));

  /* Apariencia */
  const themeSeg = h('div.segmented', ...THEMES.map((th) => h('button', {
    'aria-pressed': String(theme === th),
    onclick: async (e) => {
      await Store.setKv('pref.theme', th);
      await applyTheme(th);
      themeSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      e.currentTarget.setAttribute('aria-pressed', 'true');
    },
  }, th === 'auto' ? t('theme.auto') : th === 'dark' ? t('theme.dark') : t('theme.light'))));

  /* Idioma */
  const langSel = h('select.select', {
    onchange: async (e) => { await I18n.setLang(e.target.value); ctx.refresh(); },
  }, ...I18n.available().map((l) => h('option', { value: l.code, selected: I18n.lang === l.code }, `${l.flag} ${l.native}`)));

  view.append(h('div.card.mb-4',
    h('div.card-head', h('h3', { text: t('settings.appearance') })),
    h('div.card-body.stack',
      h('div.field', h('label.label', { text: t('theme.label') }), themeSeg),
      h('div.field', h('label.label', { text: t('lang.label') }), langSel),
    ),
  ));

  /* Rendimiento */
  const enginePref = await Store.kv('pref.engine', null);
  const engineSeg = h('div.segmented',
    ...[['local', 'home.engineLocal'], ['neural', 'home.engineModel']].map(([val, key]) => h('button', {
      'aria-pressed': String((enginePref || 'local') === val),
      onclick: async (e) => {
        await Store.setKv('pref.engine', val);
        engineSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        e.currentTarget.setAttribute('aria-pressed', 'true');
        if (val === 'neural') {
          toast(t('synapse.engineLoading'), 'info');
          state.engineWarm = true;
          Engine.warmup().catch(() => toast(t('synapse.engineFallback'), 'warn'));
        } else {
          Engine.stop();
          state.engineWarm = false;
          toast(t('synapse.engineLocal'), 'ok');
        }
      },
    }, t(key))),
  );

  view.append(h('div.card.mb-4',
    h('div.card-head', h('h3', { text: t('settings.performance') }), h('span.badge', { text: t('settings.deviceTier') + ': ' + state.tier })),
    h('div.card-body',
      h('label.switch',
        h('input', {
          type: 'checkbox', checked: lite,
          onchange: async (e) => {
            const on = e.target.checked;
            await Store.setKv('pref.lite', on);
            state.lite = on;
            document.documentElement.setAttribute('data-lite', String(on));
            if (on) Engine.stop();
            toast(t('state.saved'), 'ok');
          },
        }),
        h('span.switch-track'),
        h('span.switch-label', t('settings.liteMode')),
      ),
      h('p.hint.mt-2', { text: t('settings.liteModeHint') }),
      h('div.field.mt-4',
        h('label.label', t('home.engineTitle'), h('span.opt', t('field.optional'))),
        engineSeg,
        h('p.hint', { text: `${t('home.engineModel')} ~20 MB · ${t('home.engineLocal')}` }),
      ),
    ),
  ));

  /* Nodo opcional */
  const nodeInput = h('input.input', { type: 'url', value: node, placeholder: t('settings.syncPlaceholder') });
  view.append(h('div.card.mb-4',
    h('div.card-head', h('h3', { text: t('settings.syncTitle') }), h('span.badge.info', t('field.optional'))),
    h('div.card-body',
      h('p.sm.dim.mb-4', { text: t('settings.syncBody') }),
      h('div.field', h('label.label', { text: t('settings.syncUrl') }), h('div.input-group', nodeInput,
        h('button.btn', {
          onclick: async () => {
            await Store.setKv('pref.node', nodeInput.value.trim());
            toast(nodeInput.value.trim() ? t('state.saved') : t('settings.syncNotConfigured'), 'ok');
          },
        }, icon('check', 16), t('action.save')),
      )),
      h('div.row.gap-2.wrap',
        h('button.btn', { onclick: () => syncNow() }, icon('refresh', 16), t('settings.syncNow')),
        h('span.hint', { text: node ? '' : t('settings.syncNotConfigured') }),
      ),
    ),
  ));

  /* Datos */
  const fileInput = h('input', {
    type: 'file', accept: '.json,.zip,.pangea', style: 'display:none',
    onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        let payload;
        if (/\.(zip|pangea)$/i.test(f.name)) {
          const { unzipSync, readBuffer } = U;
          const entries = unzipSync(await readBuffer(f));
          const dataEntry = entries.find((x) => x.name === 'data.json');
          if (!dataEntry) throw new Error('El archivo no contiene data.json');
          payload = JSON.parse(dataEntry.text);
        } else {
          payload = JSON.parse(await readText(f));
        }
        const report = await Store.importAll(payload);
        toast(t('nexus.dataImported', { n: report.imported }), 'ok');
        ctx.refresh();
      } catch (err) { toast(String(err.message || err), 'err'); }
      e.target.value = '';
    },
  });

  view.append(h('div.card.mb-4',
    h('div.card-head', h('h3', { text: t('settings.data') })),
    h('div.card-body.stack',
      h('div.row.gap-2.wrap',
        h('button.btn.primary', {
          onclick: async () => { const n = await ctx.downloadPassport(); toast(t('nexus.dataExported', { n }), 'ok'); },
        }, icon('download', 16), t('nexus.exportAllData')),
        h('button.btn', { onclick: () => fileInput.click() }, icon('upload', 16), t('nexus.importAllData')),
        fileInput,
      ),
      est ? h('div',
        h('div.row.between.sm.mb-2',
          h('span.dim', { text: t('nexus.storage') }),
          h('span.mono', { text: `${fmt.bytes(est.usage)} / ${fmt.bytes(est.quota)}` }),
        ),
        h('div.progress.storage-bar', h('div.progress-bar', { style: `width:${U.clamp(est.pct, 2, 100)}%` })),
      ) : null,
      h('div.row.gap-2.wrap.mt-2',
        h('button.btn.sm', { onclick: () => showTelemetry() }, icon('chart', 15), t('nexus.telemetryTitle')),
        h('button.btn.sm', { onclick: () => { localStorage.removeItem('pangea.onboard.v1'); location.reload(); } }, icon('spark', 15), t('settings.resetOnboarding')),
        me ? h('button.btn.sm.danger', {
          onclick: async () => {
            if (!await confirmDialog({ title: t('nexus.wipeData'), body: t('nexus.wipeConfirm'), confirmLabel: t('action.delete'), danger: true })) return;
            await Store.wipeAll(); toast(t('toast.deleted'), 'ok'); ctx.refresh();
          },
        }, icon('x', 15), t('nexus.wipeData')) : null,
      ),
      h('p.hint.mt-2', { text: t('nexus.telemetryBody') }),
    ),
  ));

  /* Acerca de */
  view.append(h('div.card',
    h('div.card-head', h('h3', { text: t('settings.about') })),
    h('div.card-body',
      h('div.row.gap-4.wrap',
        h('div.brand-mark', { style: 'width:52px;height:52px' }, icon('globe', 26)),
        h('div.grow',
          h('div.bold', { text: 'PANGEA · ' + t('app.tagline') }),
          h('div.small.dim', { text: `${t('settings.version')} ${VERSION} · MIT · CC BY-SA` }),
          h('div.row.gap-2.wrap.mt-2',
            h('span.badge', icon('lock', 12), 'AES-GCM · ECDSA P-256'),
            h('span.badge', icon('bolt', 12), 'IndexedDB'),
            h('span.badge', icon('globe', 12), 'Service Worker'),
          ),
        ),
      ),
      h('p.sm.dim.mt-4', { text: t('nexus.trustBody') }),
      h('button.btn.mt-4', {
        onclick: async () => {
          if (state.installEvent) { state.installEvent.prompt(); state.installEvent = null; }
          else toast(t('settings.installHint'), 'info');
        },
      }, icon('download', 16), t('settings.installApp')),
    ),
  ));

  return () => s.destroy();
}

async function showTelemetry() {
  const rows = await Store.telemetrySummary();
  openModal({
    title: t('nexus.telemetryTitle'), iconName: 'chart',
    body: rows.length
      ? h('div.stack.sm', ...rows.map((r) => h('div.kv',
          h('dt', { text: fmt.date(r.id, I18n.lang) }),
          h('dd.mono', { text: Object.entries(r.counters || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') }),
        )))
      : h('p.sm.dim', { text: t('state.empty') }),
    actions: [
      { label: t('action.close') },
      { label: t('nexus.telemetryClear'), variant: 'danger', onClick: async () => { await Store.wipeTelemetry(); toast(t('toast.deleted'), 'ok'); } },
    ],
  });
}

/**
 * Habla con el nodo comunitario a través del worker dedicado
 * (js/workers/sync.worker.js). Se usa el worker y no un fetch directo para que
 * toda la lógica de protocolo del nodo viva en un solo sitio: si mañana cambia
 * el contrato, cambia en el worker y no en dos lugares que se contradicen.
 * Sin nodo configurado no se abre el worker ni se toca la red.
 */
function nodeRequest(message, timeoutMs = 22000) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./workers/sync.worker.js', import.meta.url), { type: 'module' });
    } catch (e) { reject(new Error(String(e && e.message || e))); return; }

    const id = `sync_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const timer = setTimeout(() => {
      try { worker.terminate(); } catch {}
      reject(new Error('tiempo agotado'));
    }, timeoutMs);

    const finish = (fn, arg) => { clearTimeout(timer); try { worker.terminate(); } catch {} fn(arg); };
    worker.onmessage = (ev) => {
      const d = ev.data || {};
      if (d.id && d.id !== id) return;
      if (d.ok) finish(resolve, d.data);
      else finish(reject, new Error(d.message || d.error || 'fallo de sincronización'));
    };
    worker.onerror = (e) => finish(reject, new Error(String(e && e.message || 'error del worker')));
    worker.postMessage({ id, ...message });
  });
}

async function syncNow() {
  const url = await Store.kv('pref.node', '');
  if (!url) { toast(t('settings.syncNotConfigured'), 'info'); return; }
  state.syncing = true;
  try {
    const token = await Store.kv('pref.node.token', '');
    const payload = await Store.exportAll();
    const res = await nodeRequest({ type: 'push', endpoint: url, token, payload });
    const remote = res && res.collections ? await Store.importAll(res) : null;
    toast(remote ? t('nexus.dataImported', { n: remote.imported }) : t('settings.syncSuccess'), 'ok');
  } catch (e) {
    toast(`${t('toast.error')}: ${e.message}`, 'err');
  } finally { state.syncing = false; }
}

/* ---------------------------------------------------------- Onboarding ---- */

const ONBOARD_STEPS = [
  { icon: 'globe', title: 'onb.step1.title', body: 'onb.step1.body' },
  { icon: 'translate', title: 'onb.step2.title', body: 'onb.step2.body' },
  { icon: 'network', title: 'onb.step3.title', body: 'onb.step3.body' },
  { icon: 'shield', title: 'onb.step4.title', body: 'onb.step4.body' },
  { icon: 'book', title: 'onb.step5.title', body: 'onb.step5.body' },
  { icon: 'sos', title: 'onb.step6.title', body: 'onb.step6.body' },
  { icon: 'id', title: 'onb.step7.title', body: 'onb.step7.body' },
];

function showOnboarding() {
  let i = 0;
  const s = scope(document);
  const dots = h('div.onboard-dots');
  const art = h('div.onboard-art');
  const title = h('h1', { id: 'onboard-title' });
  const body = h('p.dim');
  const btnNext = h('button.btn.aurora.lg', {}, t('onb.next'));
  const skip = h('button.btn.ghost', { onclick: finish }, t('onb.skip'));

  const card = h('div.onboard-card', art, h('div.stack.sm', title, body), dots,
    h('div.onboard-nav', skip, btnNext));
  /* El diálogo se anuncia con el texto de su propio título: un `role="dialog"`
   * sin nombre accesible deja a un lector de pantalla sin saber qué se acaba
   * de abrir. Lighthouse lo señalaba como fallo de accesibilidad. */
  const overlay = h('div.onboard', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'onboard-title' }, card);
  document.body.append(overlay);

  function paint() {
    const step = ONBOARD_STEPS[i];
    clear(art); art.append(icon(step.icon, 44));
    title.textContent = t(step.title);
    body.textContent = t(step.body);
    clear(dots);
    ONBOARD_STEPS.forEach((_, k) => dots.append(h('button', {
      'aria-current': String(k === i), 'aria-label': `${k + 1}/${ONBOARD_STEPS.length}`,
      onclick: () => { i = k; paint(); },
    })));
    btnNext.replaceChildren(i === ONBOARD_STEPS.length - 1 ? document.createTextNode(t('onb.start')) : document.createTextNode(t('onb.next')));
    if (i === ONBOARD_STEPS.length - 1) btnNext.classList.add('primary');
  }

  async function finish() {
    localStorage.setItem('pangea.onboard.v1', '1');
    overlay.remove();
    s.destroy();
    if (!(await Crypto.current())) {
      const create = await confirmDialog({ title: t('nexus.noIdentity'), body: t('nexus.noIdentityBody'), confirmLabel: t('nexus.createIdentity') });
      if (create) navigate('nexus');
    }
  }

  btnNext.addEventListener('click', () => {
    if (i < ONBOARD_STEPS.length - 1) { i++; paint(); } else finish();
  });
  s.on(document, 'keydown', (e) => {
    if (e.key === 'ArrowRight') { if (i < ONBOARD_STEPS.length - 1) { i++; paint(); } }
    if (e.key === 'ArrowLeft' && i > 0) { i--; paint(); }
  });
  paint();
  setTimeout(() => btnNext.focus(), 100);
}

/* -------------------------------------------------------- Datos semilla --- */

async function loadSeedData({ silent = true } = {}) {
  try {
    const res = await fetch('./data/conocimiento-semilla.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('sin datos semilla');
    const seed = await res.json();

    /* Primero se decide QUÉ colecciones necesitan ejemplos: una sola lectura
     * por colección, y ninguna escritura en las que ya tienen datos reales. */
    const plan = [];
    for (const [collection, rows] of Object.entries(seed.collections || {})) {
      if (!COLLECTIONS[collection] || !Array.isArray(rows) || !rows.length) continue;
      if (await Store.count(collection)) continue;   // nunca sobrescribe datos reales
      plan.push([collection, rows]);
    }

    /* Después se escribe TODO en paralelo, una transacción por colección. */
    const written = await Promise.all(plan.map(([collection, rows]) =>
      Store.putMany(collection, rows.map((r) => ({ ...r, seed: true })), { silent: true })));

    const n = written.reduce((a, b) => a + b, 0);
    for (const [collection, rows] of plan) Store.emit(collection, { action: 'seed', count: rows.length });

    await Store.setKv('seeds.version', seed.version || 1);
    if (!silent) toast(t('synapse.seedLoaded'), 'ok');
    return n;
  } catch (e) {
    console.warn('[pangea] datos semilla no disponibles', e);
    return 0;
  }
}

async function loadTaxonomy() {
  try {
    const res = await fetch('./data/categorias.json', { cache: 'no-cache' });
    const data = await res.json();
    state.taxonomy = data.categories || [];
  } catch {
    state.taxonomy = [
      { id: 'salud', icon: 'heart', color: '#EF4444' }, { id: 'agua', icon: 'layers', color: '#06B6D4' },
      { id: 'energia', icon: 'bolt', color: '#F59E0B' }, { id: 'tecnologia', icon: 'bot', color: '#6366F1' },
    ];
  }
  return state.taxonomy;
}

/* ------------------------------------------------------------ Armazón ----- */

const NAV_PRIMARY = ['home', 'lingua', 'synapse', 'veritas', 'memoria', 'sos'];

function navItem(mod, { compact = false } = {}) {
  const isHome = mod === 'home';
  const m = isHome ? { id: 'home', icon: 'home', titleKey: 'nav.home', badge: null } : MODULES.find((x) => x.id === mod);
  if (!m) return null;
  const label = t(m.titleKey);
  return h('button.nav-item', { 'data-route': m.id, onclick: () => closeDrawer() || navigate(m.id), title: label },
    icon(m.icon, 20),
    h('span.label', { text: label }),
    m.badgeKey ? h('span.badge', { text: t(m.badgeKey) }) : null,
  );
}

function buildSidebar() {
  const nav = document.getElementById('side-nav');
  if (!nav) return;
  clear(nav);
  nav.append(
    /* NEXUS ID vive en «Identidad y red», no entre los módulos: es la capa de
     * identidad, no un módulo de coordinación. Duplicarlo en ambos grupos
     * confundía más de lo que ayudaba. */
    h('div.side-group', h('div.side-group-title', { text: t('nav.modules') }),
      navItem('home'), ...MODULES.filter((m) => m.id !== 'nexus').map((m) => navItem(m.id))),
    h('div.side-group', h('div.side-group-title', { text: t('nav.network') }),
      navItem('nexus'),
      navItem('settings'),
    ),
  );
}

/**
 * Etiqueta corta para la navegación inferior, donde solo caben unas pocas
 * letras por columna. Cortar a un número fijo de caracteres partía palabras por
 * la mitad («Panel de ma…»); quedarse con la primera palabra da «Panel», que se
 * lee, y deja intactos los nombres de módulo que ya son cortos.
 */
function shortLabel(text) {
  const s = String(text).trim();
  if (s.length <= 10) return s;
  const first = s.split(/[\s·—-]+/)[0];
  return first.length <= 10 ? first : first.slice(0, 10);
}

function buildBottomNav() {
  const inner = document.getElementById('bottomnav-inner');
  if (!inner) return;
  clear(inner);
  const items = [...NAV_PRIMARY, 'agente'];
  for (const id of items) {
    const m = id === 'home' ? { id: 'home', icon: 'home', titleKey: 'nav.home' } : MODULES.find((x) => x.id === id);
    if (!m) continue;
    inner.append(h('button.bottomnav-item', {
      'data-route': m.id, onclick: () => { closeDrawer(); navigate(m.id); },
      title: t(m.titleKey), 'aria-label': t(m.titleKey),
    }, icon(m.icon, 21), h('span', { text: shortLabel(t(m.titleKey)) })));
  }
  inner.append(h('button.bottomnav-item', { 'data-route': 'settings', onclick: () => { closeDrawer(); navigate('settings'); } },
    icon('menu', 21), h('span', { text: shortLabel(t('nav.more')) })));
}

function openDrawer() { document.querySelector('.app')?.classList.add('drawer-open'); document.getElementById('drawer-scrim')?.focus?.(); }
function closeDrawer() { document.querySelector('.app')?.classList.remove('drawer-open'); }

/* --------------------------------------------------------------- Boot ----- */

async function boot() {
  try {
    await applyTheme(await Store.kv('pref.theme', 'auto'));
    await loadTaxonomy();
    await I18n.init();

    state.lite = await Store.kv('pref.lite', state.tier === 'lite');
    document.documentElement.setAttribute('data-lite', String(state.lite));
    if (state.lite) { document.documentElement.style.setProperty('--dur-3', '0ms'); }

    await Store.ready();
    state.identity = await Crypto.current();

    /* Datos semilla en el primer arranque: la red nunca está vacía.
     *
     * Se cargan ANTES del primer pintado, no después. Se probó a pintar primero
     * y sembrar en segundo plano, y la medición de rendimiento lo desaconsejó:
     * el repintado posterior convertía un elemento nuevo en el más grande de la
     * página y RETRASABA el LCP de 1,7 s a 5,5 s. Lo que había que arreglar no
     * era el orden, sino el coste: 42 escrituras en serie son ahora una sola
     * transacción por colección (ver `Store.putMany`). */
    if (!(await Store.kv('seeds.version', 0))) await loadSeedData();

    document.documentElement.removeAttribute('data-booting');
    buildShell();
    I18n.apply(document);
    await render();

    /* La cortina de arranque se retira de verdad, no solo del atributo: el
     * CSS ya la oculta, pero dejarla en el árbol mantendría una capa opaca
     * sobre la aplicación para siempre. */
    document.getElementById('boot')?.remove();

    /* Calentado de módulos: en cuanto la aplicación está en pantalla y el
     * navegador queda libre, se descarga el código de los ocho módulos para que
     * al entrar en cualquiera ya esté listo.
     *
     * El orden importa: primero se pinta (eso es lo que espera la persona) y sólo
     * después se aprovecha el tiempo muerto. Hacerlo al revés devolvería el
     * problema que este cambio resuelve. Se hace de uno en uno, y si el
     * navegador no está libre se espera: es mejor tardar en calentar que dar
     * tirones mientras alguien lee la primera pantalla. */
    const programar = (fn) => (typeof requestIdleCallback === 'function'
      ? requestIdleCallback(fn, { timeout: 4000 })
      : setTimeout(fn, 1200));
    const calentar = () => {
      const siguiente = (i) => {
        if (i >= MODULES.length) return;
        cargarModulo(MODULES[i].id).catch(() => {}).finally(() => programar(() => siguiente(i + 1)));
      };
      siguiente(0);
    };
    /* Dos segundos de margen: el calentado no debe competir con el primer
     * pintado ni con la instalación del Service Worker. */
    setTimeout(() => programar(calentar), 2000);

    Store.on('identity', async () => { state.identity = await Crypto.current(); refreshIdentityChip(); });
    Store.on('*', () => refreshIdentityChip());

    /* El motor semántico avisa cuando sube de nivel: el usuario merece saber
     * que el emparejamiento pasó de n-gramas locales al modelo neuronal. */
    Engine.onChange((s) => {
      if (s.mode === 'neural' && !state.engineAnnounced) {
        state.engineAnnounced = true;
        toast(t('synapse.engineModel'), 'ok', { timeout: 3200 });
        ctx.refresh();
      }
    });

    /* Al cambiar de idioma hay que retraducir TODO el armazón, no solo el
     * contenido: la barra lateral, la navegación inferior y el nombre del
     * documento se construyen una vez al arrancar, así que sin esto la
     * navegación se quedaba en el idioma anterior aunque la vista cambiara. */
    I18n.onChange(() => {
      buildSidebar();
      buildBottomNav();
      I18n.apply(document);
      refreshIdentityChip();
      ctx.refresh();
    });

    if (!localStorage.getItem('pangea.onboard.v1')) setTimeout(showOnboarding, 420);

    window.addEventListener('online', () => { state.online = true; document.body.classList.remove('is-offline'); toast(t('state.online'), 'ok', { timeout: 2000 }); });
    window.addEventListener('offline', () => { state.online = false; document.body.classList.add('is-offline'); toast(t('toast.offline'), 'warn'); });
    window.addEventListener('hashchange', render);

    /* Actualizaciones del Service Worker: avisar, nunca forzar. */
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'SW_UPDATED') toast('PANGEA ' + e.data.version, 'info');
      });
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.installEvent = e;
      showInstallPrompt();
    });
    window.addEventListener('appinstalled', () => { state.installEvent = null; toast('PANGEA · ' + t('action.install'), 'ok'); });

    /* Atajos de teclado: navegación rápida 1-7 y "/" para ir al buscador.
     * `e.target` puede ser el propio documento (no un Element) cuando el evento
     * no lo origina un nodo del árbol, así que se comprueba antes de usar
     * métodos de Element: un `matches` sobre el documento lanzaría una
     * excepción y rompería el manejador global. */
    document.addEventListener('keydown', (e) => {
      const target = e.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === '/') {
        e.preventDefault();
        /* Se enfoca el primer campo de la vista actual (LINGUA, MEMORIA,
         * VERITAS y SYNAPSE tienen uno). Si la vista no tiene buscador, no
         * ocurre nada: nunca se apunta a un elemento que no existe. */
        document.querySelector('#view input.input, #view input[type="search"], #view textarea.textarea')?.focus();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= MODULES.length) navigate(MODULES[n - 1].id);
    });

    Store.track('session');
  } catch (e) {
    console.error('[pangea] fallo de arranque', e);
    document.documentElement.removeAttribute('data-booting');
    document.body.append(h('div.banner.danger', { style: 'margin:1rem' },
      icon('sos', 20), h('div', h('strong', { text: t('state.error') }), h('div.sm', { text: String(e && e.message || e) }))));
  }
}

function buildShell() {
  const sidebar = document.getElementById('sidebar');
  clear(sidebar);
  sidebar.append(
    h('div.brand',
      h('div.brand-mark', { 'aria-hidden': 'true' }, icon('globe', 22)),
      h('div.brand-text',
        h('span.brand-name', { text: 'PANGEA' }),
        h('span.brand-tag', { text: t('app.tagline') }),
      ),
    ),
    h('nav.side-nav', { id: 'side-nav', 'aria-label': t('a11y.modulesNav') }),
    h('div.side-foot', h('button.identity-chip', { id: 'identity-chip', onclick: () => navigate('nexus') })),
  );

  const langSel = h('select.select.sm', {
    'aria-label': t('lang.label'), style: 'max-width:130px;min-height:34px;padding-block:.25rem',
    onchange: async (e) => { await I18n.setLang(e.target.value); ctx.refresh(); },
  }, ...I18n.available().map((l) => h('option', { value: l.code, selected: I18n.lang === l.code }, `${l.flag} ${l.code.toUpperCase()}`)));

  const topbar = document.getElementById('topbar');
  clear(topbar);
  topbar.append(
    h('button.btn.icon.ghost', { class: 'drawer-btn', onclick: openDrawer, 'aria-label': t('nav.modules'), style: 'display:none' }, icon('menu', 20)),
    h('span#topbar-title.topbar-title'),
    h('div.topbar-spacer'),
    h('div.topbar-actions',
      h('button.btn.icon.ghost.sm', { id: 'theme-toggle', onclick: cycleTheme, 'aria-label': t('theme.label') }, icon('moon', 18)),
      h('span.hide-sm', langSel),
      h('button.btn.icon.ghost.sm', { onclick: () => navigate('settings'), 'aria-label': t('nav.settings') }, icon('settings', 18)),
    ),
  );

  const bottom = document.getElementById('bottomnav');
  clear(bottom);
  bottom.append(h('div.bottomnav-inner', { id: 'bottomnav-inner' }));

  buildSidebar();
  buildBottomNav();
  refreshIdentityChip();
  updateThemeToggleIcon();
}

async function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const cur = await Store.kv('pref.theme', 'auto');
  const next = order[(order.indexOf(cur) + 1) % order.length];
  await Store.setKv('pref.theme', next);
  await applyTheme(next);
  updateThemeToggleIcon();
  toast(t('theme.label') + ': ' + t(next === 'auto' ? 'theme.auto' : next === 'dark' ? 'theme.dark' : 'theme.light'), 'info', { timeout: 1600 });
}

async function updateThemeToggleIcon() {
  const pref = await Store.kv('pref.theme', 'auto');
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  clear(btn);
  btn.append(icon(pref === 'auto' ? 'spark' : dark ? 'sun' : 'moon', 18));
}

async function refreshIdentityChip() {
  const chip = document.getElementById('identity-chip');
  if (!chip) return;
  const me = await Crypto.current();
  clear(chip);
  if (me) {
    const hue = fmt.hueOf(me.fingerprint);
    chip.append(
      h('span.avatar', { style: `background:linear-gradient(135deg, hsl(${hue} 68% 56%), hsl(${(hue + 60) % 360} 68% 48%))`, text: fmt.initials(me.name || me.fingerprint.slice(4, 6)) }),
      h('span.identity-meta',
        h('span.identity-name', { text: me.name || t('nexus.title') }),
        h('span.identity-fp', { text: me.fingerprint }),
      ),
      icon('check', 16, 'ico-accent'),
    );
  } else {
    chip.append(
      h('span.avatar', { style: 'background:var(--bg-sunken);color:var(--text-faint)' }, icon('id', 18)),
      h('span.identity-meta',
        h('span.identity-name', { text: t('nexus.noIdentity') }),
        h('span.identity-fp', { text: t('nexus.createIdentity') }),
      ),
    );
  }
}

/* Pregunta una única vez si descargar el modelo neuronal. La respuesta se
 * guarda y se respeta para siempre; se puede cambiar en Ajustes. */
let enginePromptOpen = false;
function askNeuralEngine() {
  if (enginePromptOpen) return;
  enginePromptOpen = true;
  const close = () => { el.remove(); enginePromptOpen = false; };
  const el = h('div.install-prompt', { role: 'dialog', 'aria-label': t('home.engineTitle') },
    icon('spark', 22),
    h('div.grow',
      h('div.sm.bold', { text: t('home.engineTitle') }),
      h('div.tiny.dim', { text: `${t('home.engineModel')} · ~20 MB · ${t('home.engineLocal')}` }),
    ),
    h('button.btn.primary.sm', {
      onclick: async () => {
        close();
        await Store.setKv('pref.engine', 'neural');
        state.engineWarm = true;
        Engine.warmup().catch(() => toast(t('synapse.engineFallback'), 'warn'));
      },
    }, t('action.start')),
    h('button.btn.sm', {
      onclick: async () => { close(); await Store.setKv('pref.engine', 'local'); toast(t('synapse.engineLocal'), 'info', { timeout: 2200 }); },
    }, t('action.skip')),
  );
  document.body.append(el);
}

function showInstallPrompt() {  if (localStorage.getItem('pangea.install.dismissed')) return;
  const el = h('div.install-prompt', { role: 'dialog' },
    icon('download', 22),
    h('div.grow',
      h('div.sm.bold', { text: t('settings.installApp') }),
      h('div.tiny.dim', { text: t('settings.installHint') }),
    ),
    h('button.btn.primary.sm', {
      onclick: async () => { el.remove(); const ev = state.installEvent; state.installEvent = null; ev?.prompt(); },
    }, t('action.install')),
    h('button.btn.icon.ghost.sm', {
      onclick: () => { localStorage.setItem('pangea.install.dismissed', '1'); el.remove(); }, 'aria-label': t('action.close'),
    }, icon('x', 16)),
  );
  document.body.append(el);
}

/* Mostrar el botón de cajón solo en pantallas pequeñas (evita duplicar CSS). */
function syncDrawerButton() {
  const btn = document.querySelector('.drawer-btn');
  if (btn) btn.style.display = window.matchMedia('(max-width: 1024px)').matches ? '' : 'none';
}

/* -------------------------------------------------------------- Arranque -- */

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { boot(); }, { once: true });
else boot();

window.addEventListener('resize', debounce(syncDrawerButton, 150));
window.addEventListener('load', syncDrawerButton);
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-goto]');
  if (link) { e.preventDefault(); navigate(link.dataset.goto); }
});

export { MODULES, loadSeedData, showOnboarding, syncDrawerButton };
