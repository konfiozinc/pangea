/* ============================================================================
 * PANGEA · js/i18n.js
 * Internacionalización de la interfaz. 8 idiomas iniciales, carga diferida,
 * soporte RTL, pluralización por Intl y traducción declarativa del DOM.
 *
 * Uso:
 *   await I18n.init();
 *   I18n.t('nav.synapse')                 // → "SYNAPSE"
 *   I18n.t('toast.saved', { n: 3 })       // interpolación {n}
 *   I18n.apply(document)                  // traduce [data-i18n], [data-i18n-ph],
 *                                         // [data-i18n-aria], [data-i18n-title]
 *   I18n.onChange(fn)                     // re-render al cambiar idioma
 * ==========================================================================*/

import { Store } from './store.js';

/** Idiomas soportados. `native` se muestra siempre en su propia lengua. */
export const LANGUAGES = [
  { code: 'es', native: 'Español', en: 'Spanish', dir: 'ltr', flag: '🇪🇸' },
  { code: 'en', native: 'English', en: 'English', dir: 'ltr', flag: '🇬🇧' },
  { code: 'pt', native: 'Português', en: 'Portuguese', dir: 'ltr', flag: '🇧🇷' },
  { code: 'fr', native: 'Français', en: 'French', dir: 'ltr', flag: '🇫🇷' },
  { code: 'ar', native: 'العربية', en: 'Arabic', dir: 'rtl', flag: '🇸🇦' },
  { code: 'hi', native: 'हिन्दी', en: 'Hindi', dir: 'ltr', flag: '🇮🇳' },
  { code: 'zh', native: '中文', en: 'Chinese', dir: 'ltr', flag: '🇨🇳' },
  { code: 'ru', native: 'Русский', en: 'Russian', dir: 'ltr', flag: '🇷🇺' },
];

const FALLBACK_CHAIN = ['en', 'es'];
const KEY = 'pref.lang';
const dicts = new Map();
const listeners = new Set();

let current = 'es';

async function loadDict(code) {
  if (dicts.has(code)) return dicts.get(code);
  try {
    const mod = await import(`./locales/${code}.js`);
    const d = mod.default || mod;
    dicts.set(code, d);
    return d;
  } catch (e) {
    console.warn('[i18n] idioma no disponible:', code, e && e.message);
    dicts.set(code, {});
    return {};
  }
}

function lookup(code, key) {
  const d = dicts.get(code);
  return d && Object.prototype.hasOwnProperty.call(d, key) ? d[key] : undefined;
}

function interpolate(str, params) {
  if (!params) return str;
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])));
}

export const I18n = {
  LANGUAGES,

  get lang() { return current; },
  get dir() { return (LANGUAGES.find((l) => l.code === current) || {}).dir || 'ltr'; },
  get locale() {
    const map = { es: 'es-ES', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR', ar: 'ar-EG', hi: 'hi-IN', zh: 'zh-CN', ru: 'ru-RU' };
    return map[current] || current;
  },
  available: () => LANGUAGES.slice(),

  async init() {
    const saved = await Store.kv(KEY, null);
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'es';
    const short = String(nav).slice(0, 2).toLowerCase();
    const pick = saved || (LANGUAGES.some((l) => l.code === short) ? short : 'es');
    // Base primero: la cadena de respaldo debe existir siempre.
    await Promise.all([loadDict('es'), loadDict('en'), pick !== 'es' && pick !== 'en' ? loadDict(pick) : null].filter(Boolean));
    current = pick;
    document.documentElement.lang = current;
    document.documentElement.dir = this.dir;
    return current;
  },

  async setLang(code, { persist = true } = {}) {
    if (!LANGUAGES.some((l) => l.code === code)) return current;
    await loadDict(code);
    current = code;
    document.documentElement.lang = code;
    document.documentElement.dir = this.dir;
    if (persist) await Store.setKv(KEY, code);
    listeners.forEach((fn) => { try { fn(code); } catch (e) { console.error(e); } });
    return current;
  },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** Traduce una clave con cadena de respaldo es→en→clave. */
  t(key, params) {
    if (!key) return '';
    let v = lookup(current, key);
    if (v === undefined) for (const f of FALLBACK_CHAIN) { v = lookup(f, key); if (v !== undefined) break; }
    if (v === undefined) return key;
    return interpolate(v, params);
  },

  /** ¿Existe la clave? (útil para contenido opcional) */
  has(key) { return lookup(current, key) !== undefined || FALLBACK_CHAIN.some((f) => lookup(f, key) !== undefined); },

  /** Traduce un objeto {clave: valor} completo (para selectores). */
  map(prefix, ids) { return ids.map((id) => ({ id, label: I18n.t(`${prefix}.${id}`) })); },

  /**
   * Traducción declarativa del DOM.
   *   data-i18n="clave"          → textContent
   *   data-i18n-ph="clave"       → placeholder
   *   data-i18n-title="clave"    → title
   *   data-i18n-aria="clave"     → aria-label
   *   data-i18n-html="clave"     → innerHTML (uso controlado)
   */
  apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = I18n.t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.setAttribute('placeholder', I18n.t(el.dataset.i18nPh)); });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.setAttribute('title', I18n.t(el.dataset.i18nTitle)); });
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', I18n.t(el.dataset.i18nAria)); });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = I18n.t(el.dataset.i18nHtml); });
    return root;
  },

  num: (n, opts) => { try { return new Intl.NumberFormat(I18n.locale, opts).format(n); } catch { return String(n); } },
  date: (ts, opts = { dateStyle: 'medium' }) => { try { return new Intl.DateTimeFormat(I18n.locale, opts).format(new Date(ts)); } catch { return new Date(ts).toLocaleDateString(); } },
};

/** Atajo global de traducción. */
export const t = (key, params) => I18n.t(key, params);

export default I18n;
