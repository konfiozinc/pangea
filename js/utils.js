/* ============================================================================
 * PANGEA · js/utils.js
 * Utilidades transversales. Sin dependencias externas. ES2022+.
 * Contiene: hyperscript (h), iconos SVG, formateo, red, ZIP propio (store-mode),
 * embeddings locales offline (hashing trick), similitud, geolocalización.
 * ==========================================================================*/

/* ------------------------------------------------------------------ DOM ---- */

/**
 * ¿El argumento es en realidad un hijo y no un objeto de propiedades?
 * h('div.card', otroElemento) debe tratar `otroElemento` como hijo. Si se
 * interpretara como propiedades, se recorrería buscando atributos, no se
 * encontraría ninguno y el nodo desaparecería SIN NINGÚN ERROR: la interfaz
 * quedaría a medias y la causa sería invisible.
 */
function isChildLike(v) {
  return v === null || v === undefined
    || v instanceof Node
    || Array.isArray(v)
    || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/**
 * Hyperscript minimalista. h('div.card#id', {props}, ...hijos)
 * El objeto de propiedades es opcional: si se omite, el segundo argumento se
 * trata como el primer hijo.
 *
 * Props especiales: class, style (obj|string), dataset (obj), on (obj de
 * handlers), onclick/oninput/onchange… (funciones), html, text, value, checked,
 * y cualquier atributo o aria-*.
 */
export function h(tag, props = null, ...children) {
  const m = String(tag).match(/^([a-zA-Z0-9-]+)?((?:[.#][\w-]+)*)$/);
  const name = (m && m[1]) || 'div';
  const el = document.createElement(name);
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (isChildLike(props)) { children.unshift(props); props = null; }
  applyProps(el, props);
  append(el, children);
  return el;
}

export function applyProps(el, props) {
  if (!props) return el;
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style') typeof v === 'string' ? el.setAttribute('style', v) : Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    /* Objeto de manejadores: { on: { click: fn, input: fn } } */
    else if (k === 'on' && typeof v === 'object') { for (const [ev, fn] of Object.entries(v)) if (typeof fn === 'function') el.addEventListener(ev, fn); }
    /* Manejadores directos: onclick, oninput, onchange… Deben registrarse como
     * listeners reales. Si se dejaran caer en setAttribute, el navegador los
     * compilaría como cuerpo de función en línea y una arrow function suelta
     * sería una expresión descartada: el manejador nunca se ejecutaría y no
     * habría ningún error visible. */
    else if (k.length > 2 && k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open' || k === 'required') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Fragmento. */
export const frag = (...kids) => append(document.createDocumentFragment(), kids);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Vacía un nodo. */
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

/**
 * Alcance de eventos con autolimpieza.
 * const s = scope(el); s.on('click', fn); s.destroy();
 */
export function scope(root) {
  const ac = new AbortController();
  const timers = new Set();
  const observers = new Set();
  return {
    root,
    on(target, type, fn, opts = {}) {
      target.addEventListener(type, fn, { ...opts, signal: ac.signal });
      return () => target.removeEventListener(type, fn, opts);
    },
    interval(fn, ms) { const id = setInterval(fn, ms); timers.add(id); return id; },
    timeout(fn, ms) { const id = setTimeout(fn, ms); timers.add(id); return id; },
    observe(obs) { observers.add(obs); return obs; },
    destroy() { ac.abort(); timers.forEach(clearInterval); timers.forEach(clearTimeout); observers.forEach((o) => { try { o.disconnect(); } catch {} }); timers.clear(); observers.clear(); },
    get disposed() { return ac.signal.aborted; },
  };
}

/* ---------------------------------------------------------------- Iconos --- */
/** Iconografía lineal 24x24 (stroke). Uso: icon('sos', 20) */
export const ICON_PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c-2.5 2.6-3.8 5.6-3.8 9s1.3 6.4 3.8 9c2.5-2.6 3.8-5.6 3.8-9S14.5 5.6 12 3ZM3.4 9h17.2M3.4 15h17.2',
  translate: 'M4 5h9M8.5 5v2c0 4-1.7 7.2-4.5 9M6 11c1.6 2.6 3.9 4.4 6.6 5.4M13.5 20l3.6-9 3.6 9M14.8 17h4.6',
  network: 'M12 3a2.2 2.2 0 1 0 0 4.4A2.2 2.2 0 0 0 12 3ZM5 16.6a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Zm14 0a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4ZM10.6 7.2 6.4 15.1M13.4 7.2l4.2 7.9M7.2 18.8h9.6',
  shield: 'M12 3 5 6v5.5c0 4.3 2.9 8.2 7 9.5 4.1-1.3 7-5.2 7-9.5V6l-7-3Zm-2.4 8.8 1.9 1.9 3.6-3.7',
  book: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17.5H6.5A2.5 2.5 0 0 0 4 22V4.5Zm0 0V20M8 7h8M8 11h5',
  sos: 'M12 3.5 2.5 20h19L12 3.5Zm0 5.5v5m0 3v.5',
  bot: 'M12 3v3M7 9h10a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3Zm2.5 4.5v1.5m5-1.5v1.5M9 19v2m6-2v2',
  id: 'M4 5h16v14H4V5Zm3.5 4.5a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM16 9h3M16 12h3M7 16.5c.8-1.3 1.9-2 3-2s2.2.7 3 2',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  check: 'M4 12.5 9 17.5 20 6.5',
  x: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 5 5',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M4 19h16',
  upload: 'M12 20V9m0 0-4 4m4-4 4 4M4 5h16',
  mic: 'M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3ZM6 11v1a6 6 0 0 0 12 0v-1M12 18v3M9 21h6',
  volume: 'M4 10v4h3l4 3.5v-15L7 10H4Zm12-3.5a5 5 0 0 1 0 11',
  camera: 'M4 8h3l1.5-2h7L17 8h3v11H4V8Zm8 3.2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  map: 'M9 4 3 6.5v14L9 18l6 2.5 6-2.5v-14L15 6.5 9 4Zm0 0v14m6-11.5v14',
  users: 'M8 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 8 11Zm-6 8c0-3 2.7-5 6-5s6 2 6 5m3-13a3 3 0 0 1 0 6m1 7c0-2.4-1-4-2.6-4.8',
  flag: 'M5 3v18M5 4h12l-2 4 2 4H5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4.5V12l3.5 2',
  pin: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Zm0-8.6a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z',
  chart: 'M4 20h16M7 20V11m5 9V5m5 15v-6',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm8 3-1.9-.6.4-1.9-1.4-1.4-1.9.4L14.5 6 13 5.2 11 6.6 9 5.2 7.5 6l-.7 1.5-1.9-.4L3.5 8.5l.4 1.9L2 11v2l1.9.6-.4 1.9 1.4 1.4 1.9-.4L7.5 18l1.5.8 2-1.4 2 1.4 1.5-.8.7-1.5 1.9.4 1.4-1.4-.4-1.9L22 13v-2Z',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6l1-7Z',
  lock: 'M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5V11Zm7 4v2.5',
  key: 'M15 4a5 5 0 1 0-3.6 8.5L4 20v-2.5h2.5V15H9v-2.5l2.4-2.4A5 5 0 0 0 15 4Zm1.5 3.2h.01',
  copy: 'M9 9h11v11H9V9ZM4 15V4h11',
  refresh: 'M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4',
  play: 'M7 5l12 7-12 7V5Z',
  pause: 'M8 5h3v14H8V5Zm5 0h3v14h-3V5Z',
  send: 'M4 12 20 4l-7 16-2.5-6.5L4 12Z',
  edit: 'M4 20h4L19.5 8.5a2.12 2.12 0 0 0-3-3L5 17v3ZM14.5 5.5l3 3',
  link: 'M9.5 14.5 14.5 9.5M8 12 6 14a3.5 3.5 0 0 0 5 5l2-2M16 12l2-2a3.5 3.5 0 0 0-5-5l-2 2',
  file: 'M6 3h8l4 4v14H6V3Zm8 0v4h4M9 13h6M9 17h6',
  layers: 'M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5',
  heart: 'M12 20s-7-4.4-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.7C19 15.6 12 20 12 20Z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z',
  sun: 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19',
  handshake: 'M3 12l4-4 3 3 2-2 2 2 3-3 4 4-5 5-2-2-2 2-2-2-2 2-5-5Z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  microscope: 'M9 4h4v8H9V4Zm2 8v3m-4 5h12M11 15a4 4 0 0 0 4 4H7a4 4 0 0 1 4-4Z',
  seedling: 'M12 21v-7m0 0c0-4 2.5-6 7-6 0 4-2.5 6-7 6Zm0 0c0-3.5-2-5.5-6-5.5C6 19 8 21 12 21Z',
  balance: 'M12 4v16M6 20h12M4 9h4l-2 5a2 2 0 0 0 4 0L8 9Zm12 0h4l-2 5a2 2 0 0 0 4 0l-2-5Zm-4-5h4l-2 5a2 2 0 0 0 4 0l-2-5Z',
};

export function icon(name, size = 20, cls = '') {
  const d = ICON_PATHS[name] || ICON_PATHS.spark;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7'); svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ico ' + cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d); svg.append(p);
  return svg;
}

/* ------------------------------------------------------------- Formato ----- */

const LOCALE_TAG = { es: 'es-ES', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR', ar: 'ar-EG', hi: 'hi-IN', zh: 'zh-CN', ru: 'ru-RU' };

export const fmt = {
  date(ts, lang = 'es', opts = {}) {
    try { return new Intl.DateTimeFormat(LOCALE_TAG[lang] || lang, { dateStyle: 'medium', ...opts }).format(new Date(ts)); }
    catch { return new Date(ts).toLocaleDateString(); }
  },
  time(ts, lang = 'es') {
    try { return new Intl.DateTimeFormat(LOCALE_TAG[lang] || lang, { timeStyle: 'short' }).format(new Date(ts)); }
    catch { return new Date(ts).toLocaleTimeString(); }
  },
  num(n, lang = 'es', opts = {}) {
    try { return new Intl.NumberFormat(LOCALE_TAG[lang] || lang, opts).format(n); } catch { return String(n); }
  },
  /** "hace 3 min" con Intl.RelativeTimeFormat */
  rel(ts, lang = 'es') {
    const diff = Date.now() - ts, sec = diff / 1000;
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
    try {
      const rtf = new Intl.RelativeTimeFormat(LOCALE_TAG[lang] || lang, { numeric: 'auto' });
      for (const [u, s] of units) if (Math.abs(sec) >= s || u === 'second') return rtf.format(-Math.round(sec / s), u);
    } catch { /* fallback */ }
    return this.date(ts, lang);
  },
  bytes(b) {
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0, n = Number(b) || 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
  },
  /** Trunca preservando palabras. */
  trunc(str = '', max = 120) {
    const s = String(str);
    if (s.length <= max) return s;
    return s.slice(0, max).replace(/\s+\S*$/, '') + '…';
  },
  initials(name = '?') {
    return String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
  },
  /** Color determinista a partir de un texto (para avatares). */
  hueOf(str = '') {
    let hsh = 0; for (let i = 0; i < str.length; i++) hsh = (hsh * 31 + str.charCodeAt(i)) >>> 0;
    return hsh % 360;
  },
};

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uid(prefix = 'id') {
  const rnd = (globalThis.crypto && crypto.getRandomValues) ? crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 2 ** 32, Math.random() * 2 ** 32];
  return `${prefix}_${Date.now().toString(36)}${rnd[0].toString(36)}${rnd[1].toString(36)}`.slice(0, 40);
}

export function slugify(s = '') {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff\u0900-\u097f\u4e00-\u9fff]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function debounce(fn, ms = 250) {
  let t; const w = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  w.cancel = () => clearTimeout(t); return w;
}

export function throttle(fn, ms = 120) {
  let last = 0, timer = null, pend = null;
  return (...a) => {
    pend = a; const now = Date.now();
    if (now - last >= ms) { last = now; fn(...pend); }
    else if (!timer) timer = setTimeout(() => { timer = null; last = Date.now(); fn(...pend); }, ms - (now - last));
  };
}

/* ----------------------------------------------------- Texto / semántica --- */

const STOP = new Set('de la que el en y a los del se las por un para con no una su al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros my the of and to in is it you that he was for on are as with his they be at one have this from or had by hot word but what some we can out other were all there when up use your how said an each she which do their time if will way about many then them would write like so these her long make thing see him two has look more day could go come did number sound no most people over know than call first who may down side been now find any new work part take get place made live where after back little only round man year came show every good me give our under name very through just form much great think say help low line before turn cause same mean differ move right boy old too does tell sentence set three want air well also play small end put home read hand port large spell add even land here must big high such follow act why ask men change went light kind off need house picture try us again animal point mother world near build self earth father head stand own page should country found answer school grow study still learn plant cover food sun four between state keep eye never last let thought city tree cross farm hard start might story saw far sea draw left late run dont while press close night real life few north open seem together next white children begin got walk example ease paper often always music those both mark book letter until mile river car feet care second group carry took rain eat room friend began idea fish mountain stop once base hear horse cut sure watch color face wood main enough plain girl usual young ready above ever red list though feel talk bird soon body dog family direct pose leave song measure door product black short numeral class wind question happen complete ship area half rock order fire south problem piece told knew pass since top whole king space heard best hour better true during hundred five remember step early hold west ground interest reach fast verb sing listen six table travel less morning ten simple several vowel toward war lay against pattern slow center love person money serve appear road map science rule govern pull cold notice voice unit power town fine certain fly fall lead cry dark machine note wait plan figure star box noun field rest correct able pound done beauty drive stood contain front teach week final gave green oh quick develop ocean warm free minute strong special mind behind clear tail produce fact street inch multiply nothing course stay wheel full force blue object decide surface deep moon island foot system busy test record boat common gold possible plane age dry wonder laugh thousand ago ran check game shape yes cool miss brought heat snow tire bring distant fill east paint language among grand ball yet wave drop heart am present heavy dance engine position arm wide sail material fraction forest sit race window store summer train sleep prove lone leg exercise wall catch mount wish sky board joy winter sat written wild instrument kept glass grass cow job edge sign visit past soft fun bright gas weather month million bear finish happy hope flower clothes strange gone jump baby eight village meet root buy raise solve metal whether push seven paragraph third shall held hair describe cook floor either result burn hill safe cat century consider type law bit coast copy phrase silent tall sand soil roll temperature finger industry value fight lie beat excite natural view sense capital wont chair danger fruit rich thick soldier process operate practice separate difficult doctor please protect noon crop modern element hit student corner party supply whose locate ring character insect caught period indicate radio spoke atom human history effect electric expect bone rail imagine provide agree thus gentle woman captain guess necessary sharp wing create neighbor wash bat rather crowd corn compare poem string bell depend meat rub tube famous dollar stream fear sight thin triangle planet hurry chief colony clock mine tie enter major fresh search send yellow gun allow print dead spot desert suit current lift rose continue block chart hat sell success company subtract event particular deal swim term opposite wife shoe shoulder spread arrange camp invent cotton born determine quart nine truck noise level chance gather shop stretch throw shine property column molecule select wrong gray repeat require broad prepare salt nose plural anger claim continent oxygen sugar death pretty skill women season solution magnet silver thank branch match suffix especially fig afraid huge sister steel discuss forward similar guide experience score apple bought led pitch coat mass card band rope slip win dream evening condition feed tool total basic smell valley nor double seat arrive master track parent shore division sheet substance favor connect post spend chord fat glad original share station dad bread charge proper bar offer segment slave duck instant market degree populate chick dear enemy reply drink occur support speech nature range steam motion path liquid log meant quotient teeth shell neck'.split(/\s+/));

/** Tokeniza + normaliza (soporta acentos y no-latinos). */
export function tokenize(text = '') {
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9\u00c0-\u024f\u0600-\u06ff\u0900-\u097f\u4e00-\u9fff\u3040-\u30ff]+/i)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** N-gramas de caracteres: robusto para idiomas sin espacios y errores. */
function charNGrams(word, n = 3) {
  const s = `^${word}$`, out = [];
  for (let i = 0; i <= s.length - n; i++) out.push(s.slice(i, i + n));
  return out;
}

/**
 * Embedding local determinista y offline (técnica "hashing trick" + TF).
 * No sustituye a un transformer, pero funciona sin red y sin descargas.
 * Devuelve Float32Array L2-normalizado de dimensión `dim`.
 */
export function localEmbed(text, dim = 192) {
  const v = new Float32Array(dim);
  const tokens = tokenize(text);
  const add = (feature, weight) => {
    let hsh = 2166136261;
    for (let i = 0; i < feature.length; i++) { hsh ^= feature.charCodeAt(i); hsh = Math.imul(hsh, 16777619); }
    const idx = Math.abs(hsh) % dim;
    v[idx] += (hsh & 0x80000000) ? -weight : weight;
  };
  for (const t of tokens) {
    add('w:' + t, 1);
    for (const g of charNGrams(t, 3)) add('g:' + g, 0.34);
    for (const g of charNGrams(t, 4)) add('q:' + g, 0.18);
  }
  let norm = 0; for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

export function cosine(a, b) {
  if (!a || !b) return 0;
  const n = Math.min(a.length, b.length); let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

/** Similitud léxica tipo Jaccard ponderada por rareza (IDF ligero). */
export function lexicalSimilarity(textA, textB) {
  const a = new Set(tokenize(textA)), b = new Set(tokenize(textB));
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Extrae frases clave (para resúmenes y etiquetas). */
export function keywords(text, max = 6) {
  const freq = new Map();
  for (const t of tokenize(text)) freq.set(t, (freq.get(t) || 0) + 1);
  return [...freq.entries()].sort((x, y) => y[1] - x[1] || y[0].length - x[0].length).slice(0, max).map(([w]) => w);
}

/* --------------------------------------------------------------- Red ------- */

export async function jsonFetch(url, opts = {}, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal, headers: { accept: 'application/json', ...(opts.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

export const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/* --------------------------------------------------------- Archivos -------- */

export function download(filename, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return blob;
}

export function readText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(file); });
}
export function readDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
}
export function readBuffer(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file); });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0', value: text });
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); return true; } catch { return false; } finally { ta.remove(); }
  }
}

/* ------------------------------------------------------ ZIP (store mode) --- */
/* Implementación propia del formato ZIP (método 0 = sin compresión).
 * Permite exportar/importar "Pasaportes PANGEA" (.pangea / .zip) sin librerías. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Crea un Blob ZIP a partir de [{ name, data: string|Uint8Array }].
 * Sin compresión (método 0): rápido, portable y suficiente para datos firmados.
 */
export function zipSync(entries) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const dosTime = (() => { const d = new Date(); return { t: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF, d: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF }; })();

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : new Uint8Array(e.data);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, dosTime.t, true); lh.setUint16(12, dosTime.d, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameBytes.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), nameBytes, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true); cd.setUint16(12, dosTime.t, true); cd.setUint16(14, dosTime.d, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

/** Lee un ZIP creado con zipSync (método store). Devuelve [{name, text, bytes}]. */
export function unzipSync(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer), dv = new DataView(arrayBuffer);
  const dec = new TextDecoder();
  // Localiza el End Of Central Directory
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ZIP inválido (sin EOCD)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    if (method === 0) {
      const lnameLen = dv.getUint16(lho + 26, true), lextraLen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnameLen + lextraLen;
      const bytes = u8.slice(start, start + size);
      out.push({ name, bytes, text: dec.decode(bytes) });
    }
    p += 46 + nameLen + extraLen + commLen;
  }
  return out;
}

/* --------------------------------------------------------- Geolocalización - */

export function getPosition(opts = { timeout: 12000 }) {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Geolocalización no disponible'));
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5), acc: Math.round(p.coords.accuracy || 0) }),
      (e) => rej(new Error(e.message || 'Permiso denegado')), opts,
    );
  });
}

/** Distancia Haversine en km. */
export function distanceKm(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return +(2 * R * Math.asin(Math.sqrt(s))).toFixed(1);
}

/* ------------------------------------------------------------ Entorno ----- */

export const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * Perfil del dispositivo, usado para decidir el «modo nodo ligero».
 *
 * Se exige una señal CLARA de limitación, no una sola débil: `cores <= 2` por
 * sí solo degradaría la experiencia en equipos modestos pero perfectamente
 * capaces de dibujar un gráfico. Las señales que sí cuentan son la intención
 * explícita del usuario (`saveData`), una red de 2G y una memoria declarada de
 * 2 GB o menos.
 */
export function deviceTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null;
  const conn = navigator.connection || {};
  const saveData = !!conn.saveData;
  const slowNet = /(^|-)2g$/.test(String(conn.effectiveType || ''));

  if (saveData || slowNet) return 'lite';
  if (mem !== null && mem <= 2) return 'lite';
  if (cores <= 2 || (mem !== null && mem <= 4)) return 'mid';
  return 'full';
}

export async function storageEstimate() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, pct: quota ? Math.round((usage / quota) * 100) : 0 };
  } catch { return null; }
}

/** Notifica a la UI con vibración opcional (móvil). */
export function haptic(pattern = 12) {
  try { if (navigator.vibrate && !prefersReducedMotion()) navigator.vibrate(pattern); } catch {}
}

/** Genera un color accesible desde un hue. */
export function hsl(hue, s = 62, l = 55) { return `hsl(${hue} ${s}% ${l}%)`; }
