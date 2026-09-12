/* ============================================================================
 * PANGEA · js/modules/sos.js
 * SOS — Red de respuesta a emergencias que funciona también sin internet.
 *
 * Principio: una alerta útil es una alerta que LLEGA. Por eso todo se guarda
 * en IndexedDB, se firma con ECDSA P-256 en el dispositivo, y se puede sacar
 * de aquí como archivo firmado para viajar por USB, Bluetooth, radio o SMS
 * (modo malla / sneakernet). El mapa es un lujo: si Leaflet no está, si el
 * teléfono es lite o si no hay red, el módulo sigue siendo plenamente usable
 * con distancias calculadas localmente.
 *
 * Colecciones propias:
 *   alerts    { id, type, severity, title, body, location, status,
 *               confirmations:[fingerprint], origin, importedFrom, ...sig }
 *   responses { id, alertId, responder:{fingerprint,name}, resources:[...],
 *               message, distanceKm, ...sig }
 * ==========================================================================*/

import {
  h, icon, scope, clear, fmt, uid, download, readText, getPosition, distanceKm, debounce, clamp,
} from '../utils.js';
import { Store, COLLECTIONS } from '../store.js';
import { Crypto } from '../crypto.js';

/* ------------------------------------------------------------ Constantes --- */

const TYPES = [
  'natural', 'medical', 'humanitarian', 'infra',
  'missing', 'food', 'water', 'shelter', 'transport', 'other',
];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const RESOURCES = [
  'transport', 'shelter', 'water', 'medicine', 'food', 'skills', 'comms', 'power',
  'firstaid', 'tools', 'other',
];

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const SEV_COLOR = { critical: '#EF4444', high: '#F59E0B', medium: '#06B6D4', low: '#10B981' };
const SEV_BADGE = { critical: 'danger', high: 'warn', medium: 'info', low: 'ok' };
/* Íconos de los tipos de alerta (A1). `users`/`seedling`/`layers`/`home`/`map`
 * están definidos en js/utils.js · ICON_PATHS. */
const TYPE_ICON = {
  natural: 'sos', medical: 'heart', humanitarian: 'handshake', infra: 'bolt',
  missing: 'users', food: 'seedling', water: 'layers', shelter: 'home', transport: 'map',
  other: 'flag',
};
const RES_ICON = {
  transport: 'send', shelter: 'home', water: 'layers', medicine: 'heart', food: 'seedling',
  skills: 'microscope', comms: 'network', power: 'bolt',
  firstaid: 'heart', tools: 'settings', other: 'spark',
};
/* Clases ya definidas en css/modules.css para .alert-type */
const TYPE_CLASS = { medical: 'medical', humanitarian: 'humanitarian', infra: 'infra' };

const RADII = [5, 25, 100, 500];              // km; 0 = sin límite
const PKG_FORMAT = 'pangea-sos';
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '© OpenStreetMap contributors';

const isActive = (a) => a && a.status !== 'atendida';
const rankOf = (a) => (SEV_RANK[a && a.severity] === undefined ? 9 : SEV_RANK[a.severity]);
const today = () => new Date().toISOString().slice(0, 10);

/** Leaflet llega como global desde index.html y PUEDE NO ESTAR (offline/lite). */
function leaflet() {
  if (typeof window === 'undefined') return null;
  const L = window.L;
  return L && typeof L.map === 'function' && typeof L.circleMarker === 'function' ? L : null;
}

function shortFp(fp) {
  if (typeof fp !== 'string' || !fp) return '—';
  return fp.length > 13 ? fp.slice(0, 13) : fp;
}

function safeLocation(loc) {
  if (!loc || typeof loc !== 'object') return null;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, label: typeof loc.label === 'string' ? loc.label.slice(0, 120) : '' };
}

/** Redondeo a 2 decimales (~1.1 km). Se aplica ANTES de firmar (ver submitAlert). */
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * ¿La posición de una alerta es aproximada? Las alertas antiguas, sin el campo
 * `locationPrecision`, se tratan como aproximadas. NUNCA se mutan: su firma
 * describe exactamente lo que se almacenó y tocar el registro la rompería.
 */
const isApprox = (a) => !!(a && a.location) && a.locationPrecision !== 'exact';

export default {
  id: 'sos',
  icon: 'sos',
  accent: 'red',
  titleKey: 'sos.title',
  subKey: 'sos.sub',

  async mount(root, ctx) {
    const s = scope(root);
    const view = h('div.view');
    root.append(view);

    /* ------------------------------------------------------ Estado local --- */
    /* Nada de esto se persiste: es la vista, no la verdad. */
    const local = {
      pos: null,          // { lat, lng, acc } del usuario, o null
      radius: 0,          // 0 = sin límite
      filter: 'active',   // active | resolved | all
      alerts: [],
      responses: [],
      verdicts: new Map(),// id → { stamp, valid, label, fingerprint }
      me: { fingerprint: '', anon: true },
      centered: false,    // ¿el mapa ya se centró?
    };

    let Lapi = null;              // API de Leaflet capturada al inicializar
    let map = null;
    let markerLayer = null;

    /* --------------------------------------------------------- Esqueleto --- */
    const activeBadge = h('span.badge.danger');
    const newBtn = h('button.btn.danger.lg', {
      type: 'button', onclick: () => openAlertModal(),
    }, icon('plus', 20), h('span', { text: ctx.t('sos.newAlert') }));

    view.append(h('div.view-header',
      h('div.view-heading',
        h('h1.view-title', icon('sos', 26), ctx.t('sos.title')),
        h('p.view-sub', { text: ctx.t('sos.sub') }),
      ),
      h('div.view-actions', activeBadge, newBtn),
    ));

    const tabsEl = h('div.tabs', { role: 'tablist', 'aria-label': ctx.t('action.filter') });
    const listHost = h('div', {
      role: 'region', 'aria-label': ctx.t('sos.activeAlerts'),
      'aria-live': 'polite', 'aria-relevant': 'additions text', 'aria-busy': 'false',
    });

    /* Mapa: contenedor estable; su contenido se decide en renderMap(). */
    const mapShell = h('div.map-shell', { role: 'region', 'aria-label': ctx.t('sos.nearby') });
    const mapNode = h('div#pangea-map.pangea-map');
    let fallbackHost = null;

    const mapBadge = h('span.badge');
    const mapCard = h('div.card',
      h('div.card-head',
        h('h3', { text: ctx.t('sos.title') }),
        mapBadge,
      ),
      h('div.card-body', mapShell),
    );

    const locStatus = h('div.hint', { role: 'status', 'aria-live': 'polite' });
    const radiusSel = h('select.select', {
      'aria-label': ctx.t('sos.radius'),
      onchange: (e) => { local.radius = Number(e.target.value) || 0; render(); },
    },
      ...RADII.map((r) => h('option', { value: String(r) }, `${fmt.num(r, ctx.I18n.lang)} km`)),
      h('option', { value: '0' }, '—'),
    );
    const nearbyList = h('div.list');
    const locBtn = h('button.btn', {
      type: 'button', onclick: () => locate(),
    }, icon('pin', 16), h('span', { text: ctx.t('sos.useMyLocation') }));

    const nearbyCard = h('div.card',
      h('div.card-head', h('h3', { text: ctx.t('sos.nearby') })),
      h('div.card-body.stack.sm',
        h('div.row.wrap.gap-2', locBtn, h('div.grow', locStatus)),
        h('div.field', h('label.label', ctx.t('sos.radius')), radiusSel),
        nearbyList,
      ),
    );

    const meshResult = h('div');
    const meshFile = h('input', {
      type: 'file', accept: '.json,application/json', style: 'display:none',
      onchange: (e) => handleImport(e),
    });
    const meshCard = h('div.card',
      h('div.card-body',
        h('div.mesh-box.stack.sm',
          h('div.row.between.wrap.gap-3',
            h('div.grow',
              h('div.bold', { text: ctx.t('sos.meshTitle') }),
              h('p.hint.mt-2', { text: ctx.t('sos.meshBody') }),
            ),
            h('span', { 'aria-hidden': 'true' }, icon('network', 26)),
          ),
          h('div.row.wrap.gap-2',
            h('button.btn.primary.sm', { type: 'button', onclick: () => exportAll() },
              icon('download', 15), h('span', { text: ctx.t('sos.exportAlert') })),
            h('button.btn.sm', { type: 'button', onclick: () => meshFile.click() },
              icon('upload', 15), h('span', { text: ctx.t('sos.importAlert') })),
            meshFile,
          ),
          /* A3: las posiciones aproximadas viajan tal cual (ya redondeadas y
           * firmadas) dentro del paquete; nunca se «exactifican» al exportar. */
          h('p.hint.mt-2', { text: `≈ ${ctx.t('field.location')} · ${ctx.t('sos.exportAlert')}` }),
          meshResult,
        ),
      ),
    );

    view.append(h('div.grid.grid-2',
      h('div', tabsEl, listHost),
      h('div.stack', mapCard, nearbyCard, meshCard),
    ));

    /* ------------------------------------------------------------ Datos ----- */
    async function loadData() {
      const [alerts, responses, me] = await Promise.all([
        Store.all(COLLECTIONS.alerts),
        Store.all(COLLECTIONS.responses),
        ctx.author(),
      ]);
      local.alerts = Array.isArray(alerts) ? alerts : [];
      local.responses = Array.isArray(responses) ? responses : [];
      local.me = me || { fingerprint: '', anon: true };
      await refreshVerdicts();
    }

    /**
     * Verifica cada alerta una sola vez por versión (updatedAt). En un teléfono
     * de 20 dólares, verificar ECDSA en cada repintado no es aceptable.
     */
    async function refreshVerdicts() {
      const alive = new Set();
      for (const a of local.alerts) {
        alive.add(a.id);
        const stamp = a.updatedAt || a.createdAt || 0;
        const cached = local.verdicts.get(a.id);
        if (cached && cached.stamp === stamp) continue;
        let v;
        try { v = await ctx.verifyRecord(a); }
        catch { v = { valid: false, label: ctx.t('state.unverified'), fingerprint: null }; }
        local.verdicts.set(a.id, {
          stamp, valid: !!(v && v.valid), label: (v && v.label) || ctx.t('state.unverified'),
          fingerprint: (v && v.fingerprint) || null,
        });
      }
      for (const id of [...local.verdicts.keys()]) if (!alive.has(id)) local.verdicts.delete(id);
    }

    const distOf = (a) => (a && a.location && local.pos ? distanceKm(local.pos, a.location) : null);
    const distLabel = (d) => (d === null || !Number.isFinite(d)
      ? ctx.t('sos.unknownLocation')
      : ctx.t('sos.distance', { km: d }));

    function visibleAlerts() {
      let rows = local.alerts.slice();
      if (local.filter === 'active') rows = rows.filter(isActive);
      else if (local.filter === 'resolved') rows = rows.filter((a) => !isActive(a));
      if (local.radius > 0 && local.pos) {
        /* Sin coordenadas no podemos descartar: en una emergencia es mejor
         * mostrar de más que esconder una alerta. */
        rows = rows.filter((a) => {
          const d = distOf(a);
          return d === null || !Number.isFinite(d) || d <= local.radius;
        });
      }
      rows.sort((x, y) => rankOf(x) - rankOf(y) || (y.createdAt || 0) - (x.createdAt || 0));
      return rows;
    }

    /* ---------------------------------------------------------- Pintado ----- */
    function render() {
      renderHeader();
      renderTabs();
      renderList();
      renderNearby();
      renderMap();
    }

    function renderHeader() {
      const n = local.alerts.filter(isActive).length;
      clear(activeBadge);
      activeBadge.className = n ? 'badge danger' : 'badge ok';
      activeBadge.append(icon('sos', 13),
        h('span', { text: `${ctx.t('sos.activeAlerts')}: ${fmt.num(n, ctx.I18n.lang)}` }));
    }

    function renderTabs() {
      clear(tabsEl);
      const active = local.alerts.filter(isActive).length;
      const defs = [
        { id: 'active', label: ctx.t('sos.activeAlerts'), count: active },
        { id: 'resolved', label: ctx.t('sos.resolvedAlerts'), count: local.alerts.length - active },
        { id: 'all', label: ctx.t('sos.title'), count: local.alerts.length },
      ];
      for (const d of defs) {
        const on = local.filter === d.id;
        tabsEl.append(h('button.tab', {
          type: 'button', role: 'tab', 'aria-selected': String(on),
          class: on ? 'active' : '',
          onclick: () => { local.filter = d.id; render(); },
        }, h('span', { text: d.label }), h('span.count', { text: fmt.num(d.count, ctx.I18n.lang) })));
      }
    }

    function renderList() {
      const rows = visibleAlerts();
      clear(listHost);
      listHost.setAttribute('aria-busy', 'false');
      if (!rows.length) {
        if (!local.alerts.length) {
          listHost.append(h('div.empty',
            icon('sos', 30),
            h('div.empty-title', { text: ctx.t('sos.noAlerts') }),
            h('button.btn.danger.mt-2', { type: 'button', onclick: () => openAlertModal() },
              icon('plus', 16), h('span', { text: ctx.t('sos.newAlert') })),
          ));
        } else {
          listHost.append(h('div.empty',
            icon('sos', 30),
            h('div.empty-title', { text: ctx.t('state.empty') }),
            h('div.empty-body', { text: ctx.t('sos.noAlerts') }),
          ));
        }
        return;
      }
      listHost.append(...rows.map((a) => alertCard(a)));
    }

    function sigChip(a) {
      const v = local.verdicts.get(a.id);
      if (!a.sig) {
        return h('span.sig', { title: ctx.t('state.unverified') },
          icon('x', 11), h('span', { text: ctx.t('state.unverified') }));
      }
      const ok = !!(v && v.valid);
      return h('span.sig', {
        class: ok ? 'valid' : 'invalid',
        title: (v && v.fingerprint) ? ctx.t('nexus.signedBy', { fp: v.fingerprint }) : ((v && v.label) || ''),
      }, icon(ok ? 'check' : 'x', 11),
        h('span', { text: ok ? ctx.t('nexus.signatureValid') : ctx.t('nexus.signatureInvalid') }));
    }

    function originBadge(a) {
      if (a.origin === 'imported') {
        return h('span.badge.warn', { title: ctx.t('sos.importAlert') },
          icon('upload', 12), h('span', { text: `${ctx.t('field.source')}: ${shortFp(a.importedFrom)}` }));
      }
      return h('span.badge.ok', { title: ctx.t('app.localFirst') },
        icon('check', 12), h('span', { text: `${ctx.t('field.source')}: ${ctx.t('app.name')}` }));
    }

    /** Indicador de posición aproximada. El glifo «≈» es el símbolo universal de
     *  «aproximadamente»; no existe una clave i18n que diga «aproximado», así que
     *  se acompaña de `sos.radius` (la opción elegida para «aproximado» en el
     *  selector) como texto accesible de apoyo. */
    function approxBadge() {
      return h('span.badge.info', { title: ctx.t('sos.radius') },
        icon('pin', 12), h('span', { text: '≈' }));
    }

    function alertCard(a) {
      const resolved = !isActive(a);
      const d = distOf(a);
      const conf = Array.isArray(a.confirmations) ? a.confirmations : [];
      const mine = conf.indexOf(local.me.fingerprint) >= 0 && !local.me.anon;

      const replies = local.responses.filter((r) => r && r.alertId === a.id);
      const people = new Set(replies.map((r) => r.responder && r.responder.fingerprint).filter(Boolean));
      const offered = [...new Set(replies.flatMap((r) => (Array.isArray(r.resources) ? r.resources : [])))]
        .filter((r) => RESOURCES.indexOf(r) >= 0);

      const card = h('article.card.alert-card', { 'data-severity': a.severity, 'data-id': a.id });

      card.append(h('div.alert-head',
        h('span.alert-type', { class: TYPE_CLASS[a.type] || '', 'aria-hidden': 'true' },
          icon(TYPE_ICON[a.type] || 'sos', 20)),
        h('div.grow',
          h('h3', { text: a.title }),
          h('div.row.wrap.gap-2.mt-2',
            h('span.badge', { class: SEV_BADGE[a.severity] || '' },
              icon('bolt', 12), h('span', { text: ctx.t('urgency.' + a.severity) })),
            h('span.badge', icon(TYPE_ICON[a.type] || 'sos', 12),
              h('span', { text: ctx.t('sos.type.' + a.type) })),
            resolved ? h('span.badge.ok', icon('check', 12),
              h('span', { text: ctx.t('state.resolved') })) : null,
            !resolved && a.severity === 'critical'
              ? h('span.pulse-ring', { 'aria-hidden': 'true' }) : null,
          ),
        ),
        h('div.col', { style: 'align-items:flex-end;gap:var(--sp-2)' }, sigChip(a), originBadge(a)),
      ));

      if (a.body) card.append(h('p.sm.dim', { text: a.body }));

      card.append(h('div.row.wrap.gap-2',
        a.location
          ? h('span.badge', icon('pin', 12),
              h('span', { text: a.location.label || `${a.location.lat}, ${a.location.lng}` }))
          : h('span.badge.warn', icon('sos', 12), h('span', { text: ctx.t('sos.unknownLocation') })),
        isApprox(a) ? approxBadge() : null,
        h('span.badge', { class: d === null ? 'warn' : 'info' }, icon('map', 12),
          h('span', { text: distLabel(d) })),
        h('span.badge', icon('clock', 12),
          h('span', { text: fmt.rel(a.createdAt, ctx.I18n.lang) })),
        conf.length
          ? h('span.badge.ok', icon('users', 12),
              h('span', { text: ctx.t('sos.confirmed', { n: conf.length }) }))
          : h('span.badge.warn', icon('clock', 12), h('span', { text: ctx.t('sos.pending') })),
      ));

      if (offered.length) {
        card.append(h('div',
          h('div.section-title', { text: ctx.t('sos.respondedBy') }),
          h('div.row.wrap.gap-2',
            ...offered.map((r) => h('span.response-chip',
              icon(RES_ICON[r] || 'spark', 12), h('span', { text: ctx.t('sos.resource.' + r) }))),
            h('span.badge', icon('users', 12),
              h('span', { text: `${fmt.num(people.size, ctx.I18n.lang)} · ${ctx.t('sos.responders')}` })),
          ),
        ));
      }

      card.append(h('div.row.wrap.gap-2',
        resolved ? null : h('button.btn.danger.sm', {
          type: 'button', onclick: () => openResponse(a),
        }, icon('send', 15), h('span', { text: ctx.t('sos.respond') })),
        h('button.btn.sm', {
          type: 'button', disabled: mine,
          title: mine ? ctx.t('sos.confirmed', { n: conf.length }) : ctx.t('sos.confirmAlert'),
          onclick: () => confirmAlert(a),
        }, icon('check', 15), h('span', { text: ctx.t('sos.confirmAlert') })),
        resolved ? null : h('button.btn.sm', {
          type: 'button', onclick: () => resolveAlert(a),
        }, icon('flag', 15), h('span', { text: ctx.t('sos.markResolved') })),
        h('button.btn.ghost.sm', {
          type: 'button', title: ctx.t('sos.exportAlert'),
          onclick: () => exportPackage([a], a.id.slice(0, 8)),
        }, icon('download', 15), h('span', { text: ctx.t('sos.broadcast') })),
      ));

      return card;
    }

    function renderNearby() {
      clear(locStatus);
      if (local.pos) {
        locStatus.append(h('span.badge.ok', icon('pin', 12),
          h('span', { text: `${local.pos.lat}, ${local.pos.lng}${local.pos.acc ? ` ±${local.pos.acc} m` : ''}` })));
      } else {
        locStatus.append(h('span.badge.warn', icon('sos', 12),
          h('span', { text: ctx.t('sos.unknownLocation') })));
      }
      radiusSel.value = String(local.radius);

      clear(mapBadge);
      mapBadge.append(icon('pin', 12), h('span', {
        text: fmt.num(local.alerts.filter((a) => a.location).length, ctx.I18n.lang),
      }));

      clear(nearbyList);
      const rows = local.alerts
        .map((a) => ({ a, d: distOf(a) }))
        .filter((r) => r.a.location)
        .sort((x, y) => (x.d === null ? Infinity : x.d) - (y.d === null ? Infinity : y.d)
          || rankOf(x.a) - rankOf(y.a))
        .slice(0, 6);

      if (!rows.length) {
        nearbyList.append(h('p.hint', {
          text: local.alerts.length ? ctx.t('sos.unknownLocation') : ctx.t('sos.noAlerts'),
        }));
        return;
      }
      for (const { a, d } of rows) {
        nearbyList.append(h('button.list-item.clickable', {
          type: 'button', style: 'width:100%;text-align:start', onclick: () => focusAlert(a),
        }, icon('pin', 15),
          h('div.grow', h('div.sm.truncate', { text: a.title })),
          h('span.badge', { class: d === null ? 'warn' : 'info' },
            h('span', { text: distLabel(d) })),
        ));
      }
    }

    function focusAlert(a) {
      if (map && a.location) {
        try { map.setView([a.location.lat, a.location.lng], 13); local.centered = true; } catch { /* nada */ }
      }
      const card = [...listHost.querySelectorAll('[data-id]')].find((el) => el.dataset.id === a.id);
      if (card) {
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        card.setAttribute('tabindex', '-1');
        card.focus({ preventScroll: true });
      }
    }

    /* ------------------------------------------------------------- Mapa ---- */

    function ensureMap() {
      if (map) return true;
      if (ctx.state.lite) return false;
      const L = leaflet();
      if (!L) return false;
      try {
        clear(mapShell);
        mapShell.classList.remove('offline');
        delete mapShell.dataset.offlineLabel;
        fallbackHost = null;
        mapShell.append(mapNode);
        Lapi = L;
        map = L.map(mapNode, { center: [20, 0], zoom: 2, preferCanvas: true });
        L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
        markerLayer = L.layerGroup().addTo(map);
        /* El nodo acaba de entrar al DOM: recalcular tamaño en el próximo tick. */
        s.timeout(() => { try { if (map) map.invalidateSize(); } catch { /* nada */ } }, 180);
        return true;
      } catch (e) {
        console.warn('[pangea:sos] Leaflet no pudo inicializarse', e);
        map = null; markerLayer = null; Lapi = null;
        return false;
      }
    }

    function ensureFallback() {
      if (map) return null;
      if (!fallbackHost) {
        fallbackHost = h('div.pangea-map', {
          style: 'overflow:auto;padding:var(--sp-3);padding-bottom:3.25rem',
        });
        clear(mapShell);
        mapShell.classList.add('offline');
        mapShell.dataset.offlineLabel = ctx.t('sos.mapUnavailable');
        mapShell.append(fallbackHost);
      }
      return fallbackHost;
    }

    function popupNode(a) {
      const d = distOf(a);
      const btn = h('button.btn.sm.primary', {
        type: 'button', onclick: () => openResponse(a),
      }, icon('send', 14), h('span', { text: ctx.t('sos.respond') }));
      if (!isActive(a)) btn.disabled = true;
      return h('div.stack.sm', { style: 'min-width:190px' },
        h('div.bold', { text: a.title }),
        h('div.hint', { text: `${ctx.t('sos.type.' + a.type)} · ${ctx.t('urgency.' + a.severity)}` }),
        h('div.hint', { text: distLabel(d) }),
        isApprox(a) ? approxBadge() : null,
        isActive(a) ? btn : h('span.badge.ok', { text: ctx.t('state.resolved') }),
      );
    }

    function renderMap() {
      if (ensureMap() && map && markerLayer && Lapi) {
        const L = Lapi;
        markerLayer.clearLayers();
        const pts = [];
        for (const a of local.alerts) {
          if (!a.location || !Number.isFinite(a.location.lat) || !Number.isFinite(a.location.lng)) continue;
          const color = SEV_COLOR[a.severity] || SEV_COLOR.medium;
          const done = !isActive(a);
          try {
            const marker = L.circleMarker([a.location.lat, a.location.lng], {
              radius: done ? 6 : 9, color, weight: 2,
              fillColor: color, fillOpacity: done ? 0.18 : 0.42,
            });
            marker.bindPopup(popupNode(a), { minWidth: 190 });
            markerLayer.addLayer(marker);
            pts.push([a.location.lat, a.location.lng]);
          } catch { /* un punto inválido no debe tumbar el mapa */ }
        }
        if (local.pos) {
          try {
            markerLayer.addLayer(L.circleMarker([local.pos.lat, local.pos.lng], {
              radius: 7, color: '#6366F1', weight: 2, fillColor: '#6366F1', fillOpacity: 0.5,
            }).bindPopup(ctx.t('sos.useMyLocation')));
          } catch { /* nada */ }
        }
        if (!local.centered) {
          if (local.pos) {
            try { map.setView([local.pos.lat, local.pos.lng], 10); local.centered = true; } catch { /* nada */ }
          } else if (pts.length) {
            try {
              /* pad() no existe en versiones antiguas: se calcula a mano. */
              const b = L.latLngBounds(pts);
              map.fitBounds(b.pad(0.2));
              local.centered = true;
            } catch { /* nada */ }
          }
        }
        return;
      }
      renderFallback(ensureFallback());
    }

    function renderFallback(host) {
      if (!host) return;
      clear(host);
      const rows = local.alerts
        .map((a) => ({ a, d: distOf(a) }))
        .sort((x, y) => (x.d === null ? Infinity : x.d) - (y.d === null ? Infinity : y.d)
          || rankOf(x.a) - rankOf(y.a));

      if (!rows.length) {
        host.append(h('div.empty', icon('sos', 26),
          h('div.empty-title', { text: ctx.t('sos.noAlerts') })));
        return;
      }
      const list = h('div.list');
      for (const { a, d } of rows.slice(0, 40)) {
        list.append(h('div.list-item',
          h('span.dot', { class: isActive(a) ? (a.severity === 'critical' ? 'danger' : a.severity === 'high' ? 'warn' : 'primary') : '' }),
          h('div.grow',
            h('div.sm.bold.truncate', { text: a.title }),
            h('div.hint', { text: `${ctx.t('sos.type.' + a.type)} · ${distLabel(d)}` }),
          ),
          h('span.badge', { class: SEV_BADGE[a.severity] || '' },
            h('span', { text: ctx.t('urgency.' + a.severity) })),
        ));
      }
      host.append(list);
      if (ctx.state.lite) host.append(h('p.hint.mt-2', { text: ctx.t('settings.liteModeHint') }));
    }

    /* ------------------------------------------------------- Geolocalización */

    async function locate() {
      locBtn.disabled = true;
      clear(locStatus);
      locStatus.append(h('span.spinner.sm'), h('span', { text: ctx.t('state.loading') }));
      try {
        const p = await getPosition();
        local.pos = { lat: p.lat, lng: p.lng, acc: p.acc || 0 };
        local.centered = false;
        render();
      } catch (e) {
        local.pos = null;
        ctx.toast(ctx.t('sos.locationDenied'), 'warn');
        renderNearby();
      } finally {
        locBtn.disabled = false;
      }
    }

    /* ----------------------------------------------------- Crear alerta ---- */

    function openAlertModal() {
      const draft = { type: 'natural', severity: 'medium', loc: null, precision: 'approximate' };

      const typeChips = h('div.chips');
      const paintTypes = () => {
        clear(typeChips);
        for (const tk of TYPES) {
          typeChips.append(h('button.chip', {
            type: 'button', 'aria-pressed': String(draft.type === tk),
            onclick: () => { draft.type = tk; paintTypes(); },
          }, icon(TYPE_ICON[tk] || 'sos', 13), h('span', { text: ctx.t('sos.type.' + tk) })));
        }
      };
      paintTypes();

      const sevButtons = SEVERITIES.map((sv) => h('button', {
        type: 'button', 'aria-pressed': String(draft.severity === sv),
        onclick: () => {
          draft.severity = sv;
          sevButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(SEVERITIES[i] === sv)));
        },
      }, h('span', { text: ctx.t('urgency.' + sv) })));
      const sevSeg = h('div.segmented', { role: 'group', 'aria-label': ctx.t('sos.severity') }, ...sevButtons);

      const titleInput = h('input.input', {
        id: 'sos-f-title', type: 'text', maxlength: 140, autocomplete: 'off', required: true,
      });
      const bodyInput = h('textarea.textarea', {
        id: 'sos-f-body', maxlength: 2000, placeholder: ctx.t('sos.issuePh'),
      });
      const labelInput = h('input.input', {
        id: 'sos-f-place', type: 'text', maxlength: 120, autocomplete: 'off',
        placeholder: ctx.t('field.location'),
      });
      const latInput = h('input.input', {
        id: 'sos-f-lat', type: 'number', inputmode: 'decimal', step: '0.00001',
        min: '-90', max: '90', 'aria-label': 'lat',
      });
      const lngInput = h('input.input', {
        id: 'sos-f-lng', type: 'number', inputmode: 'decimal', step: '0.00001',
        min: '-180', max: '180', 'aria-label': 'lng',
      });
      const geoStatus = h('div.hint', { role: 'status', 'aria-live': 'polite' });

      const useLocBtn = h('button.btn', {
        type: 'button',
        onclick: async () => {
          useLocBtn.disabled = true;
          clear(geoStatus);
          geoStatus.append(h('span.spinner.sm'), h('span', { text: ctx.t('state.loading') }));
          try {
            const p = await getPosition();
            draft.loc = { lat: p.lat, lng: p.lng };
            latInput.value = String(p.lat);
            lngInput.value = String(p.lng);
            clear(geoStatus);
            geoStatus.append(h('span.badge.ok', icon('pin', 12),
              h('span', { text: `${p.lat}, ${p.lng}${p.acc ? ` ±${p.acc} m` : ''}` })));
          } catch (e) {
            draft.loc = null;
            clear(geoStatus);
            geoStatus.append(h('span.badge.warn', icon('sos', 12),
              h('span', { text: ctx.t('sos.unknownLocation') })));
            ctx.toast(ctx.t('sos.locationDenied'), 'warn');
          } finally {
            useLocBtn.disabled = false;
          }
        },
      }, icon('pin', 16), h('span', { text: ctx.t('sos.useMyLocation') }));

      /* Selector de precisión de la ubicación (A3). Solo claves existentes:
       * no hay «aproximado»/«exacto» en el locale, así que se reutiliza
       * `sos.radius` (un radio = zona difusa) para «aproximado» y
       * `field.location` (el punto preciso) para «exacto». */
      const precDefs = [
        { val: 'approximate', key: 'sos.radius' },
        { val: 'exact', key: 'field.location' },
      ];
      const precButtons = precDefs.map((p) => h('button', {
        type: 'button', 'aria-pressed': String(draft.precision === p.val),
        onclick: () => {
          draft.precision = p.val;
          precButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(precDefs[i].val === p.val)));
        },
      }, h('span', { text: ctx.t(p.key) })));
      const precSeg = h('div.segmented', { role: 'group', 'aria-label': ctx.t('field.location') }, ...precButtons);

      async function submitAlert() {
        const title = titleInput.value.trim();
        if (!title) { ctx.toast(ctx.t('toast.fieldsRequired'), 'warn'); titleInput.focus(); return false; }

        const latRaw = latInput.value.trim();
        const lngRaw = lngInput.value.trim();
        let loc = draft.loc ? { lat: draft.loc.lat, lng: draft.loc.lng } : null;

        if (latRaw || lngRaw) {
          const lat = Number(latRaw.replace(',', '.'));
          const lng = Number(lngRaw.replace(',', '.'));
          const bad = !latRaw || !lngRaw || !Number.isFinite(lat) || !Number.isFinite(lng)
            || Math.abs(lat) > 90 || Math.abs(lng) > 180;
          if (bad) { ctx.toast(ctx.t('toast.fieldsRequired'), 'warn'); return false; }
          loc = { lat: clamp(+lat.toFixed(5), -90, 90), lng: clamp(+lng.toFixed(5), -180, 180) };
        }
        if (loc) {
          /* PRIVACIDAD (A3): si la precisión es «aproximado», se redondea a 2
           * decimales (~1.1 km) ANTES de llamar a ctx.publish. ctx.publish firma
           * el objeto que recibe, así que la firma cubre las coordenadas YA
           * redondeadas y sigue siendo verificable tras exportar/importar.
           * Nunca se redondea después: mapa, popup, distancia y paquete usan el
           * valor almacenado tal cual. */
          if (draft.precision !== 'exact') {
            loc = { lat: round2(loc.lat), lng: round2(loc.lng) };
          }
          const label = labelInput.value.trim();
          loc = { lat: loc.lat, lng: loc.lng, label: label || `${loc.lat}, ${loc.lng}` };
        }

        /* id + createdAt viajan DENTRO de la carga firmada: así la firma del
         * autor sigue siendo verificable después de que Store añada updatedAt. */
        await ctx.publish(COLLECTIONS.alerts, {
          id: uid('alert'),
          createdAt: Date.now(),
          type: draft.type,
          severity: draft.severity,
          title,
          body: bodyInput.value.trim(),
          location: loc,
          locationPrecision: loc ? (draft.precision === 'exact' ? 'exact' : 'approximate') : null,
          status: 'activa',
          confirmations: [],
          origin: 'local',
          importedFrom: null,
        });

        if (draft.severity === 'critical') {
          try { if (navigator.vibrate) navigator.vibrate([40, 60, 40]); } catch { /* sin vibración */ }
          /* Aviso sonoro solo en alertas críticas: en una emergencia real, el
           * oído capta lo que la vista puede estar ignorando. Se respeta el
           * modo nodo ligero y la preferencia de movimiento reducido. */
          try {
            if (!ctx.state.lite) {
              const chime = new Audio('./assets/audio/notificacion.wav');
              chime.volume = 0.5;
              chime.play().catch(() => { /* el navegador exige interacción previa */ });
            }
          } catch { /* el sonido es un extra, nunca un requisito */ }
        }
        ctx.toast(ctx.t('toast.published'), 'ok');
        try { await ctx.awardPoints(10, ctx.t('sos.newAlert')); } catch { /* reputación opcional */ }
        return true;
      }

      ctx.openModal({
        title: ctx.t('sos.newAlert'),
        iconName: 'sos',
        body: h('div.stack',
          h('div.field',
            h('label.label', { text: ctx.t('sos.alertType') }),
            typeChips,
          ),
          h('div.field',
            h('label.label', { text: ctx.t('sos.severity') }),
            sevSeg,
          ),
          h('div.field',
            h('label.label', { for: 'sos-f-title' },
              h('span', { text: ctx.t('field.title') }), h('span.req', '*')),
            titleInput,
          ),
          h('div.field',
            h('label.label', { for: 'sos-f-body' }, h('span', { text: ctx.t('sos.issue') })),
            bodyInput,
          ),
          h('div.field',
            h('label.label', { for: 'sos-f-place' },
              h('span', { text: ctx.t('field.location') }),
              h('span.opt', { text: ctx.t('field.optional') })),
            h('div.row.wrap.gap-2', useLocBtn),
            labelInput,
            geoStatus,
            precSeg,
          ),
          h('div.form-grid',
            h('div.field',
              h('label.label', { for: 'sos-f-lat' }, h('span', { text: 'lat' })),
              latInput,
            ),
            h('div.field',
              h('label.label', { for: 'sos-f-lng' }, h('span', { text: 'lng' })),
              lngInput,
            ),
          ),
          h('p.hint', { text: ctx.t('sos.mapUnavailable') }),
        ),
        actions: [
          { label: ctx.t('action.cancel') },
          {
            label: ctx.t('action.publish'), variant: 'primary', iconName: 'send',
            onClick: () => submitAlert(),
          },
        ],
      });
    }

    /* -------------------------------------------------- Responder a una ---- */

    function openResponse(a) {
      if (!isActive(a)) return;
      const chosen = new Set();
      const chips = RESOURCES.map((r) => {
        const chip = h('button.chip', {
          type: 'button', 'aria-pressed': 'false',
          onclick: () => {
            if (chosen.has(r)) chosen.delete(r); else chosen.add(r);
            chip.setAttribute('aria-pressed', String(chosen.has(r)));
          },
        }, icon(RES_ICON[r] || 'spark', 13), h('span', { text: ctx.t('sos.resource.' + r) }));
        return chip;
      });
      const msg = h('textarea.textarea', { 'aria-label': ctx.t('field.notes'), maxlength: 600 });

      ctx.openModal({
        title: ctx.t('sos.respond'),
        iconName: 'send',
        body: h('div.stack',
          h('div',
            h('div.bold', { text: a.title }),
            h('div.hint', { text: `${ctx.t('sos.type.' + a.type)} · ${ctx.t('urgency.' + a.severity)} · ${distLabel(distOf(a))}` }),
          ),
          h('div.field',
            h('label.label', { text: ctx.t('sos.respondWith') }, h('span.req', '*')),
            h('div.chips', ...chips),
          ),
          h('div.field',
            h('label.label', { text: ctx.t('field.notes') }),
            msg,
          ),
        ),
        actions: [
          { label: ctx.t('action.cancel') },
          {
            label: ctx.t('action.send'), variant: 'primary', iconName: 'send',
            onClick: async () => {
              if (!chosen.size) { ctx.toast(ctx.t('toast.fieldsRequired'), 'warn'); return false; }
              const me = await ctx.requireIdentity();
              if (!me) return false;
              const author = await ctx.author();
              const d = distOf(a);
              await ctx.publish(COLLECTIONS.responses, {
                id: uid('resp'),
                createdAt: Date.now(),
                alertId: a.id,
                responder: { fingerprint: author.fingerprint, name: author.name, anon: !!author.anon },
                resources: [...chosen],
                message: msg.value.trim(),
                distanceKm: d === null || !Number.isFinite(d) ? null : d,
              });
              ctx.toast(ctx.t('toast.published'), 'ok');
              try { await ctx.awardPoints(6, ctx.t('sos.respond')); } catch { /* reputación opcional */ }
              return true;
            },
          },
        ],
      });
    }

    /* ------------------------------------------------ Confirmar / atender -- */

    /**
     * Aplica un cambio de ciclo de vida (confirmaciones, estado) con Store.patch.
     * Si quien muta es el autor del registro, se vuelve a firmar: así el sello
     * de firma sigue describiendo el contenido tal como está ahora.
     */
    async function patchAlert(a, patch) {
      const next = await Store.patch(COLLECTIONS.alerts, a.id, patch);
      const isAuthor = !local.me.anon && next.author && next.author.fingerprint === local.me.fingerprint;
      if (isAuthor && next.sig) {
        try {
          const resealed = await Crypto.signed(next);
          return await Store.put(COLLECTIONS.alerts, resealed);
        } catch { /* si no se puede re-firmar, el sello queda como estaba */ }
      }
      return next;
    }

    async function confirmAlert(a) {
      const me = await ctx.requireIdentity();
      if (!me) return;
      const conf = Array.isArray(a.confirmations) ? a.confirmations : [];
      const list = [...new Set([...conf, me.fingerprint])];
      if (list.length === conf.length) return;
      await patchAlert(a, { confirmations: list });
      ctx.toast(ctx.t('toast.saved'), 'ok');
      try { await ctx.awardPoints(2, ctx.t('sos.confirmAlert')); } catch { /* reputación opcional */ }
    }

    async function resolveAlert(a) {
      const me = await ctx.requireIdentity();
      if (!me) return;
      const ok = await ctx.confirm({
        title: ctx.t('sos.markResolved'),
        body: `${a.title} · ${ctx.t('sos.markResolved')}`,
        confirmLabel: ctx.t('action.confirm'),
      });
      if (!ok) return;
      await patchAlert(a, { status: 'atendida' });
      ctx.toast(ctx.t('toast.saved'), 'ok');
    }

    /* ------------------------------------------------------- Modo malla ---- */

    async function exportPackage(alerts, suffix = '') {
      const list = Array.isArray(alerts) ? alerts : [];
      if (!list.length) { ctx.toast(ctx.t('state.empty'), 'warn'); return; }
      const author = await ctx.author();
      /* El paquete viaja con las alertas Y con las respuestas de la red: los
       * recursos que la gente ya ofreció son información tan vital como la
       * alerta misma. Sin ellos, el nodo receptor volvería a pedir ayuda que ya
       * estaba en camino. */
      const ids = new Set(list.map((a) => a.id));
      const responses = (await Store.all(COLLECTIONS.responses)).filter((r) => r && ids.has(r.alertId));
      const pkg = {
        format: PKG_FORMAT,
        spec: '1.0',
        exportedAt: new Date().toISOString(),
        origin: { fingerprint: author.fingerprint, name: author.name },
        alerts: list.map((a) => ({ ...a })),
        responses: responses.map((r) => ({ ...r })),
      };
      const signed = author.anon ? pkg : await Crypto.signed(pkg);
      download(`pangea-sos-${suffix ? suffix + '-' : ''}${today()}.json`,
        JSON.stringify(signed, null, 2), 'application/json');
      ctx.toast(ctx.t('toast.exported'), 'ok');
    }

    async function exportAll() {
      const alerts = await Store.all(COLLECTIONS.alerts);
      await exportPackage(alerts, '');
    }

    async function handleImport(e) {
      const file = e.target && e.target.files ? e.target.files[0] : null;
      if (e.target) e.target.value = '';
      if (!file) return;
      clear(meshResult);
      try {
        const raw = JSON.parse(await readText(file));
        if (!raw || raw.format !== PKG_FORMAT || !Array.isArray(raw.alerts)) {
          ctx.toast(ctx.t('toast.error'), 'err');
          meshResult.append(h('div.banner.danger', icon('sos', 18),
            h('div', h('strong', { text: ctx.t('toast.error') }), h('div.hint', { text: ctx.t('sos.importAlert') }))));
          return;
        }

        let pkgValid = false;
        try { pkgValid = await Crypto.verify(raw); } catch { pkgValid = false; }

        let fp = null;
        if (raw.sig && raw.sig.fp) fp = raw.sig.fp;
        else if (raw.sig && raw.sig.pub) { try { fp = await Crypto.fingerprintOf(raw.sig.pub); } catch { fp = null; } }
        if (!fp && raw.origin) fp = raw.origin.fingerprint || null;

        const existing = new Set((await Store.all(COLLECTIONS.alerts)).map((r) => r.id));
        let n = 0;
        let signedOk = 0;

        for (const inc of raw.alerts) {          if (!inc || typeof inc !== 'object' || typeof inc.id !== 'string' || !inc.id) continue;
          if (existing.has(inc.id)) continue;
          /* La firma de origen se comprueba ANTES de añadir procedencia local. */
          if (inc.sig) { try { if (await Crypto.verify(inc)) signedOk++; } catch { /* firma no verificable */ } }
          const rec = {
            ...inc,
            type: TYPES.indexOf(inc.type) >= 0 ? inc.type : 'other',
            severity: SEVERITIES.indexOf(inc.severity) >= 0 ? inc.severity : 'medium',
            title: String(inc.title || '').slice(0, 160) || inc.id,
            body: String(inc.body || '').slice(0, 2000),
            location: safeLocation(inc.location),
            /* `locationPrecision` viaja vía `...inc` (se conserva al re-importar).
             * Si falta (paquetes antiguos), isApprox lo trata como aproximado. */
            status: inc.status === 'atendida' ? 'atendida' : 'activa',
            confirmations: Array.isArray(inc.confirmations)
              ? inc.confirmations.filter((x) => typeof x === 'string').slice(0, 500) : [],
            origin: 'imported',
            importedFrom: fp || (inc.sig && inc.sig.fp) || null,
            createdAt: inc.createdAt || Date.now(),
          };
          await Store.put(COLLECTIONS.alerts, rec);
          existing.add(inc.id);
          n++;
        }

        /* Respuestas de la red que acompañan a las alertas del paquete. Los
         * paquetes antiguos, sin este campo, siguen importándose sin problema. */
        const existingResp = new Set((await Store.all(COLLECTIONS.responses)).map((r) => r.id));
        let respN = 0;
        for (const inc of Array.isArray(raw.responses) ? raw.responses : []) {
          if (!inc || typeof inc !== 'object' || typeof inc.id !== 'string' || !inc.id || !inc.alertId) continue;
          if (existingResp.has(inc.id)) continue;
          await Store.put(COLLECTIONS.responses, {
            ...inc,
            resources: Array.isArray(inc.resources) ? inc.resources.filter((x) => typeof x === 'string').slice(0, 12) : [],
            message: String(inc.message || '').slice(0, 600),
            createdAt: inc.createdAt || Date.now(),
          });
          existingResp.add(inc.id);
          respN++;
        }

        meshResult.append(
          pkgValid
            ? h('div.row.wrap.gap-2',
                h('span.badge.ok', icon('check', 12), h('span', { text: ctx.t('nexus.signatureValid') })),
                h('span.badge.mono', h('span', { text: shortFp(fp) })))
            : h('div.banner.warn', icon('sos', 18),
                h('div',
                  h('strong', { text: ctx.t('nexus.signatureInvalid') }),
                  h('div.hint', { text: `${ctx.t('field.source')}: ${shortFp(fp)}` }))),
          h('div.row.wrap.gap-2',
            h('span.badge.info', icon('file', 12),
              h('span', { text: `${ctx.t('sos.importAlert')}: ${fmt.num(n, ctx.I18n.lang)}` })),
            h('span.badge', icon('handshake', 12),
              h('span', { text: `${ctx.t('sos.responders')}: ${fmt.num(respN, ctx.I18n.lang)}` })),
            h('span.badge', icon('shield', 12),
              h('span', { text: `${ctx.t('nexus.signatureValid')}: ${fmt.num(signedOk, ctx.I18n.lang)}` })),
          ),
        );

        ctx.toast(ctx.t('sos.imported', { n: n + respN }), 'ok');
        await loadData();
        render();
        ctx.refresh();
      } catch (err) {
        ctx.toast(String((err && err.message) || err), 'err');
      }
    }

    /* ------------------------------------------------- Ciclo de vida ------- */

    const repaint = debounce(() => {
      loadData().then(render).catch((err) => console.warn('[pangea:sos]', err));
    }, 60);

    const unsubs = [
      ctx.onStore(COLLECTIONS.alerts, repaint),
      ctx.onStore(COLLECTIONS.responses, repaint),
    ];

    await loadData();
    render();

    /* El panel de mando deja una intención («Necesito ayuda urgente») para que
     * el formulario de alerta se abra de inmediato. En una emergencia, cada
     * toque de más cuenta. Se consume una sola vez. */
    if (ctx.takeIntent('compose:alert')) openAlertModal();

    return () => {
      for (const u of unsubs) { try { u(); } catch { /* ya desuscrito */ } }
      if (typeof repaint.cancel === 'function') repaint.cancel();
      if (map) { try { map.remove(); } catch { /* nada */ } map = null; markerLayer = null; }
      s.destroy();
    };
  },
};
