/* ============================================================================
 * PANGEA · js/modules/memoria.js
 * MEMORIA — Archivo descentralizado del conocimiento humano.
 *
 * Preserva saberes tradicionales, técnicos y científicos con licencias abiertas
 * para que no desaparezcan cuando desaparezca un servidor. Todo el contenido
 * vive en IndexedDB, cada registro viaja firmado (ECDSA P-256) y la validación
 * de calidad la hacen curadores voluntarios cuya nota también va firmada.
 *
 * Colecciones propias:
 *   knowledge   { id, title, kind, content, culture, lang, contentLang, license,
 *                 tags[], attachments[{ name,type,size,dataUrl,text? }], … + sig }
 *   curations   { id: `${knowledgeId}::${fingerprint}`, knowledgeId,
 *                 curator:{ fingerprint,name }, score:1..5, note, … + sig }
 *
 * Sin frameworks, sin build, sin dependencias de red. Funciona offline.
 * ==========================================================================*/

import { h, icon, scope, clear, fmt, uid, download, readText, readBuffer, readDataURL, zipSync, unzipSync, keywords, debounce, clamp } from '../utils.js';
import { Store, COLLECTIONS } from '../store.js';
import { Crypto } from '../crypto.js';

/* ------------------------------------------------------------- Constantes -- */

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;   // 8 MB por archivo (memoria.sizeLimit)
const TEXT_PREVIEW_BYTES = 256 * 1024;          // solo se relee en texto lo razonable
const INLINE_IMAGE_LIMIT = 900 * 1024;          // en modo lite no se incrustan dataURL gigantes
const MAX_TAG_CLOUD = 14;
const SEED_URL = './data/conocimiento-semilla.json';

const KINDS = ['text', 'audio', 'image', 'document', 'recipe'];
const LICENSES = ['cc-by', 'cc-by-sa', 'cc-by-nc', 'cc0', 'all-rights', 'other'];

const KIND_ICON = { text: 'book', audio: 'mic', image: 'camera', document: 'file', recipe: 'seedling' };
const LICENSE_KEY = {
  'cc-by': 'memoria.licenseCcBy',
  'cc-by-sa': 'memoria.licenseCcBySa',
  'cc-by-nc': 'memoria.licenseCcByNc',
  cc0: 'memoria.licenseCc0',
  'all-rights': 'memoria.licenseAllRights',
  other: 'memoria.licenseOther',
};
const ACCEPT_ATTR = 'image/*,audio/*,application/pdf,text/*,.txt,.md,.markdown,.json,.csv,.pdf';
const LOCALE_TAG = { es: 'es-ES', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR', ar: 'ar-EG', hi: 'hi-IN', zh: 'zh-CN', ru: 'ru-RU' };
const TEXT_EXT_RE = /\.(txt|md|markdown|json|csv|tsv|ya?ml|log|html?|xml|rtf)$/i;

/* -------------------------------------------------------------- Utilidades - */

const shortFp = (fp) => {
  const s = fp ? String(fp) : '';
  if (!s) return '—';
  return s.length > 13 ? `${s.slice(0, 12)}…` : s;
};

const kindLabel = (t, kind) => t(`memoria.kind.${KINDS.includes(kind) ? kind : 'text'}`);
const licenseLabel = (t, license) => t(LICENSE_KEY[license] || 'memoria.licenseOther');

const isTextLike = (type, name) => /^text\//i.test(type || '')
  || /^application\/(json|xml|x-yaml|yaml)$/i.test(type || '')
  || TEXT_EXT_RE.test(name || '');

const kindForType = (type, name) => {
  if (/^image\//i.test(type || '')) return 'image';
  if (/^audio\//i.test(type || '')) return 'audio';
  if (/^application\/pdf$/i.test(type || '') || /\.pdf$/i.test(name || '')) return 'document';
  return null;
};

/** Compara etiquetas de forma tolerante (acentos, mayúsculas, espacios). */
const normTag = (v) => String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const localeFor = (code) => LOCALE_TAG[code] || code || 'es-ES';

/** Índice local de respaldo cuando window.MiniSearch no está disponible. */
function buildFallbackIndex(docs, tok) {
  const df = new Map();
  const tokensById = new Map();
  const index = docs.map((d) => {
    const bag = tok([d.title, d.content, d.culture, (d.tags || []).join(' ')].filter(Boolean).join(' '));
    const tf = new Map();
    for (const w of bag) tf.set(w, (tf.get(w) || 0) + 1);
    for (const w of new Set(bag)) df.set(w, (df.get(w) || 0) + 1);
    tokensById.set(d.id, new Set(bag));
    return { id: d.id, tf, title: new Set(tok(d.title || '')), size: bag.length };
  });
  return { index, df, N: Math.max(1, docs.length), tokensById };
}

/** Búsqueda léxica ponderada: TF normalizada × IDF + bonus de título + prefijos. */
function fallbackSearch(ix, query, tok) {
  if (!ix || !ix.index || !ix.index.length) return [];
  const terms = tok(query);
  if (!terms.length) return [];
  const out = [];
  for (const doc of ix.index) {
    let score = 0, matched = 0;
    for (const term of terms) {
      const df = ix.df.get(term) || 0;
      const idf = 1 + Math.log(ix.N / (1 + df));
      let tf = doc.tf.get(term) || 0;
      let titleHit = doc.title.has(term);
      if (!tf) {
        for (const [w, c] of doc.tf) {
          if (w.startsWith(term)) { tf = c * 0.55; titleHit = titleHit || [...doc.title].some((x) => x.startsWith(term)); break; }
        }
      }
      if (!tf) continue;
      matched++;
      const norm = 1 + Math.log(1 + (doc.size || 1));
      score += idf * ((1 + Math.log(1 + tf)) / norm) * (titleHit ? 3 : 1);
    }
    if (matched) out.push({ id: doc.id, score: score * (1 + matched / terms.length) });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Acepta los formatos de payload que pueden llegar de un archivo importado. */
function readCollection(parsed, name) {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.records)) return parsed.records;
  if (parsed.collections && Array.isArray(parsed.collections[name])) return parsed.collections[name];
  if (Array.isArray(parsed[name])) return parsed[name];
  return [];
}

/* ================================================================ Módulo === */

export default {
  id: 'memoria',
  icon: 'book',
  accent: 'amber',
  titleKey: 'memoria.title',
  subKey: 'memoria.sub',

  async mount(root, ctx) {
    const t = (key, params) => ctx.t(key, params);
    const uiLang = () => (ctx.I18n && ctx.I18n.lang) || 'es';
    const lite = () => !!(ctx.state && ctx.state.lite);
    const tok = (txt) => (ctx.U && typeof ctx.U.tokenize === 'function'
      ? ctx.U.tokenize(txt)
      : String(txt == null ? '' : txt).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1));

    const s = scope(root);
    const unsubs = [];
    let disposed = false;

    /* --------------------------------------------------------- estado ------ */
    let records = [];
    let curations = [];
    let query = '';
    let kindFilter = null;
    let licenseFilter = null;
    let tagFilter = null;
    let curatedOnly = false;

    let mini = null;
    let miniBroken = false;
    let fallback = null;
    let verifyToken = 0;
    let activeStream = null;
    let speaking = null;
    let loading = false;
    let pendingReload = false;

    /* ------------------------------------------------------------- DOM ----- */
    const importInput = h('input', {
      type: 'file', accept: '.json,.zip,application/json,application/zip',
      style: 'display:none', 'aria-hidden': 'true', tabindex: '-1',
    });
    s.on(importInput, 'change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) await importArchive(file);
    });

    const countEl = h('p.tiny.dim');
    const storageLine = h('div.tiny.dim.mt-2', { text: t('a11y.loading') });
    const statusEl = h('div.tiny.dim', { role: 'status', 'aria-live': 'polite' });
    const importNote = h('div.banner.mb-4', { style: 'display:none' });
    const resultsBox = h('div');

    const searchInput = h('input.input', {
      type: 'search', autocomplete: 'off', spellcheck: 'false',
      placeholder: t('memoria.searchPh'), 'aria-label': t('memoria.searchPh'),
    });

    const kindChips = h('div.chips', { role: 'group', 'aria-label': t('action.filter') });
    const licenseChips = h('div.chips', { role: 'group', 'aria-label': t('field.license') });
    const tagChips = h('div.chips', { role: 'group', 'aria-label': t('field.tags') });

    const view = h('div.view',
      h('div.view-header',
        h('div.view-heading',
          h('h1.view-title', icon('book', 26), h('span', { text: t('memoria.title') })),
          h('p.view-sub', { text: t('memoria.sub') }),
          countEl,
        ),
        h('div.view-actions',
          h('button.btn.primary', { type: 'button', onclick: () => openCreate() }, icon('plus', 18), t('memoria.addKnowledge')),
          h('button.btn', { type: 'button', onclick: loadSeeds }, icon('seedling', 18), t('memoria.loadSeeds')),
          h('button.btn', { type: 'button', onclick: exportArchive }, icon('download', 18), t('memoria.exportAll')),
          h('button.btn', { type: 'button', onclick: () => importInput.click() }, icon('upload', 18), t('memoria.importAll')),
          importInput,
        ),
      ),
      importNote,
      h('div.banner.mb-4', icon('lock', 20), h('div.grow', h('strong', { text: t('memoria.storageNote') }), storageLine)),
      h('div.card.mb-4', h('div.card-body.stack.sm',
        h('div.search-box', icon('search', 18), searchInput),
        h('div.row.between.wrap.gap-2', kindChips, statusEl),
        h('div.row.between.wrap.gap-2', licenseChips, h('div.chips')),
        tagChips,
      )),
      resultsBox,
    );
    root.append(view);

    /* --------------------------------------------------- índice / búsqueda - */

    function buildIndex() {
      mini = null;
      fallback = null;
      if (typeof window !== 'undefined' && typeof window.MiniSearch === 'function' && !miniBroken) {
        try {
          const inst = new window.MiniSearch({
            fields: ['title', 'content', 'culture', 'tags'],
            storeFields: ['id'],
            searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 2 } },
          });
          inst.addAll(records.map((r) => ({
            id: r.id,
            title: r.title || '',
            content: r.content || '',
            culture: r.culture || '',
            tags: (r.tags || []).join(' '),
          })));
          mini = inst;
          return;
        } catch (err) {
          console.warn('[memoria] MiniSearch no utilizable, se usa el índice local', err);
          miniBroken = true;
          mini = null;
        }
      }
      fallback = buildFallbackIndex(records, tok);
    }

    function tokensOf(id) {
      if (fallback && fallback.tokensById) return fallback.tokensById.get(id) || null;
      const rec = records.find((r) => r.id === id);
      if (!rec) return null;
      return new Set(tok([rec.title, rec.content, rec.culture, (rec.tags || []).join(' ')].filter(Boolean).join(' ')));
    }

    /** Devuelve la lista ordenada de ids que casan, o null si no hay consulta. */
    function searchIds(q) {
      if (!q) return null;
      if (mini) {
        try {
          const hits = mini.search(q);
          return (hits || []).map((r) => r.id).filter(Boolean);
        } catch (err) {
          console.warn('[memoria] fallo de MiniSearch en consulta, se degrada al índice local', err);
          mini = null;
          miniBroken = true;
          fallback = buildFallbackIndex(records, tok);
        }
      }
      return fallbackSearch(fallback, q, tok).map((r) => r.id);
    }

    /* ------------------------------------------------------------ filtros -- */

    function paintFilters() {
      clear(kindChips);
      kindChips.append(h('span.tiny.dim', { text: `${t('field.type')}:` }));
      for (const k of KINDS) {
        kindChips.append(h('button.chip', {
          type: 'button', 'aria-pressed': String(kindFilter === k),
          onclick: () => { kindFilter = kindFilter === k ? null : k; paintFilters(); renderGrid(); },
        }, icon(KIND_ICON[k], 13), kindLabel(t, k)));
      }

      clear(licenseChips);
      licenseChips.append(h('span.tiny.dim', { text: `${t('field.license')}:` }));
      for (const l of LICENSES) {
        licenseChips.append(h('button.chip', {
          type: 'button', 'aria-pressed': String(licenseFilter === l),
          onclick: () => { licenseFilter = licenseFilter === l ? null : l; paintFilters(); renderGrid(); },
        }, licenseLabel(t, l)));
      }
      licenseChips.append(h('button.chip', {
        type: 'button', 'aria-pressed': String(curatedOnly),
        onclick: () => { curatedOnly = !curatedOnly; paintFilters(); renderGrid(); },
      }, icon('check', 13), t('memoria.curated')));

      clear(tagChips);
      const cloud = records.length
        ? keywords(records.map((r) => [r.title, r.culture, (r.tags || []).join(' ')].filter(Boolean).join(' ')).join(' '), MAX_TAG_CLOUD)
        : [];
      if (cloud.length) {
        tagChips.append(h('span.tiny.dim', { text: `${t('field.tags')}:` }));
        for (const word of cloud) {
          tagChips.append(h('button.chip', {
            type: 'button', 'aria-pressed': String(tagFilter === word),
            onclick: () => { tagFilter = tagFilter === word ? null : word; paintFilters(); renderGrid(); },
          }, word));
        }
      }
    }

    function matchesFilters(rec) {
      if (kindFilter && rec.kind !== kindFilter) return false;
      if (licenseFilter && rec.license !== licenseFilter) return false;
      if (tagFilter) {
        const inTags = (rec.tags || []).some((x) => normTag(x) === tagFilter);
        if (!inTags) {
          const set = tokensOf(rec.id);
          if (!set || !set.has(tagFilter)) return false;
        }
      }
      if (curatedOnly) {
        const cur = curationsFor(rec.id);
        const avg = cur.length ? cur.reduce((n, c) => n + (Number(c.score) || 0), 0) / cur.length : 0;
        if (!(cur.length >= 2 && avg >= 4)) return false;
      }
      return true;
    }

    /* -------------------------------------------------------- curaduría ---- */

    function curationsFor(knowledgeId) {
      return curations
        .filter((c) => c && c.knowledgeId === knowledgeId)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    /* -------------------------------------------------------- firmas ------- */

    function sigChip(rec, pendingLabel) {
      const fp = rec && rec.sig && rec.sig.fp;
      const el = h('span.sig', {
        title: fp || pendingLabel,
        'aria-label': fp ? `${t('nexus.signature')}: ${fp}` : pendingLabel,
      }, icon('key', 11), h('span', { text: fp ? shortFp(fp) : pendingLabel }));
      el.dataset.pending = '1';
      return el;
    }

    async function verifyChip(el, rec) {
      if (!el || !el.dataset || el.dataset.pending !== '1') return;
      delete el.dataset.pending;
      if (!rec || !rec.sig) {
        el.classList.add('invalid');
        el.title = t('state.unverified');
        el.setAttribute('aria-label', t('state.unverified'));
        return;
      }
      try {
        const verdict = await ctx.verifyRecord(rec);
        if (disposed) return;
        el.classList.toggle('valid', !!verdict.valid);
        el.classList.toggle('invalid', !verdict.valid);
        const label = `${verdict.label}${verdict.fingerprint ? ` · ${verdict.fingerprint}` : ''}`;
        el.title = label;
        el.setAttribute('aria-label', label);
      } catch {
        el.classList.add('invalid');
        el.title = t('state.unverified');
      }
    }

    /** Verifica las firmas de forma escalonada: no bloquea en móviles lentos. */
    function verifyAll(targets) {
      const token = ++verifyToken;
      const queue = targets.slice();
      const step = () => {
        if (disposed || token !== verifyToken) return;
        const item = queue.shift();
        if (!item) return;
        Promise.resolve(verifyChip(item.el, item.rec)).catch(() => {});
        setTimeout(step, lite() ? 90 : 24);
      };
      step();
    }

    /* -------------------------------------------------------- voz ---------- */

    const speechAvailable = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

    function speak(rec, btn) {
      if (!speechAvailable()) return;
      try {
        window.speechSynthesis.cancel();
        if (speaking && speaking.btn === btn) { speaking = null; btn.setAttribute('aria-pressed', 'false'); return; }
        const code = rec.contentLang || rec.lang || uiLang();
        const text = [rec.title, rec.content].filter(Boolean).join('. ').slice(0, 4000);
        if (!text) return;
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang = localeFor(code);
        utt.onend = () => {
          if (speaking && speaking.btn === btn) { speaking = null; btn.setAttribute('aria-pressed', 'false'); }
        };
        speaking = { btn, utt };
        btn.setAttribute('aria-pressed', 'true');
        window.speechSynthesis.speak(utt);
      } catch (err) {
        console.warn('[memoria] síntesis de voz no disponible', err);
      }
    }

    /* -------------------------------------------------------- tarjetas ----- */

    function mediaFor(rec) {
      const list = Array.isArray(rec.attachments) ? rec.attachments : [];
      const image = list.find((a) => a && /^image\//i.test(a.type || '') && a.dataUrl);
      const audio = list.find((a) => a && /^audio\//i.test(a.type || '') && a.dataUrl);

      if (image) {
        if (lite() && String(image.dataUrl).length > INLINE_IMAGE_LIMIT) return null;   // degradación honesta en nodos ligeros
        return h('div.know-media', h('img', {
          src: image.dataUrl, alt: rec.title || image.name || '', loading: 'lazy', decoding: 'async',
        }));
      }
      if (audio) {
        if (lite() && String(audio.dataUrl).length > INLINE_IMAGE_LIMIT) return null;
        return h('div.know-media', h('audio', { controls: true, preload: 'none', src: audio.dataUrl }));
      }
      return null;
    }

    function playbackFor(rec) {
      const hasAudio = (rec.attachments || []).some((a) => a && /^audio\//i.test(a.type || '') && a.dataUrl);
      if (hasAudio || !speechAvailable() || !String(rec.content || '').trim()) return null;
      const btn = h('button.btn.ghost.sm', {
        type: 'button', 'aria-pressed': 'false', 'aria-label': `${t('memoria.playback')}: ${rec.title || ''}`,
        onclick: () => speak(rec, btn),
      }, icon('volume', 16), t('memoria.playback'));
      return h('div.know-media', h('div.card-body.tight.row.gap-2', btn));
    }

    function renderCard(rec, sigTargets) {
      const titleId = uid('mtt');
      const cur = curationsFor(rec.id);
      const avg = cur.length ? cur.reduce((n, c) => n + (Number(c.score) || 0), 0) / cur.length : 0;
      const validated = cur.length >= 2 && avg >= 4;

      const authorName = (rec.author && rec.author.name) || shortFp(rec.author && rec.author.fingerprint);
      const authorFp = (rec.author && rec.author.fingerprint) || (rec.sig && rec.sig.fp) || '';
      const hue = fmt.hueOf(String(authorFp || authorName));

      const sigEl = sigChip(rec, t('state.unverified'));
      sigTargets.push({ el: sigEl, rec });

      const tags = Array.isArray(rec.tags) ? rec.tags.slice(0, 6) : [];
      const chips = h('div.chips',
        rec.culture ? h('span.chip.static', icon('pin', 12), rec.culture) : null,
        h('span.chip.static', icon('balance', 12), licenseLabel(t, rec.license)),
        rec.contentLang || rec.lang ? h('span.chip.static', icon('translate', 12), String((rec.contentLang || rec.lang) || '').toUpperCase()) : null,
        ...tags.map((x) => h('span.chip.static', { text: String(x) })),
      );

      const noteSigs = [];
      const detailsEl = cur.length
        ? h('details',
            h('summary.tiny.dim', { text: `${t('field.notes')} (${cur.length})` }),
            h('div.stack.sm.mt-2', ...cur.map((c) => {
              const chip = sigChip(c, t('state.unverified'));
              noteSigs.push({ el: chip, rec: c });
              return h('div.card.flat', h('div.card-body.tight.stack.sm',
                h('div.row.between.gap-2',
                  h('span.tiny.bold', { text: (c.curator && c.curator.name) || shortFp(c.curator && c.curator.fingerprint) }),
                  h('span.badge', { text: `${clamp(Number(c.score) || 0, 1, 5)}/5` }),
                ),
                c.note ? h('p.sm', { text: String(c.note) }) : null,
                chip,
              ));
            })),
          )
        : null;
      if (detailsEl) s.on(detailsEl, 'toggle', () => { if (detailsEl.open) noteSigs.forEach((x) => { verifyChip(x.el, x.rec); }); });

      const atts = Array.isArray(rec.attachments) ? rec.attachments : [];
      const attachmentRow = atts.length
        ? h('div.row.wrap.gap-2',
            ...atts.slice(0, 4).map((a) => h('span.chip.static', icon('file', 12),
              `${String(a.name || t('memoria.attachment'))} · ${fmt.bytes(a.size || 0)}`)),
            atts.length > 4 ? h('span.badge', { text: `+${atts.length - 4}` }) : null,
          )
        : null;

      const art = h('article.card.know-card', { 'aria-labelledby': titleId },
        h('div.card-body',
          mediaFor(rec),
          h('div.row.between.gap-2.wrap',
            h('span.know-kind', icon(KIND_ICON[rec.kind] || 'book', 14), kindLabel(t, rec.kind)),
            validated ? h('span.badge.ok', icon('check', 12), t('memoria.curated')) : null,
          ),
          h('h3.know-title', { id: titleId, text: rec.title || '—' }),
          rec.content ? h('p.know-excerpt.clamp-3', { text: fmt.trunc(String(rec.content), 280) }) : null,
          chips,
          attachmentRow,
          playbackFor(rec),
          h('div.know-foot',
            h('div.row.gap-2',
              h('span.avatar.sm', {
                'aria-hidden': 'true',
                style: `background:linear-gradient(135deg, hsl(${hue} 68% 56%), hsl(${(hue + 60) % 360} 68% 48%))`,
                text: fmt.initials(authorName || '?'),
              }),
              h('span.tiny.dim', { text: authorName || '—' }),
            ),
            h('div.row.gap-2',
              sigEl,
              h('time.tiny.dim', { text: fmt.rel(rec.createdAt || Date.now(), uiLang()) }),
            ),
          ),
          h('div.chips',
            h('span.badge', icon('chart', 12), `${t('memoria.quality')}: ${cur.length ? avg.toFixed(1) : '—'}`),
            h('span.badge', icon('users', 12), `${t('memoria.curators')}: ${cur.length}`),
          ),
          detailsEl,
        ),
        h('div.card-foot',
          h('button.btn.sm', { type: 'button', onclick: () => openCurate(rec) }, icon('check', 15), t('memoria.curate')),
          h('div.row.gap-2',
            h('button.btn.icon.sm.ghost', {
              type: 'button', 'aria-label': `${t('action.delete')}: ${rec.title || ''}`,
              onclick: () => removeRecord(rec),
            }, icon('x', 15)),
          ),
        ),
      );
      return art;
    }

    /* ---------------------------------------------------------- pintado ---- */

    function renderGrid() {
      verifyToken++;
      clear(resultsBox);

      const total = records.length;
      countEl.textContent = t('memoria.total', { n: total });

      if (!total) {
        statusEl.textContent = t('memoria.results', { n: 0 });
        resultsBox.append(h('div.empty',
          icon('book', 30),
          h('div.empty-title', { text: t('state.empty') }),
          h('div.empty-body', { text: t('memoria.contentPh') }),
          h('button.btn.primary.mt-4', { type: 'button', onclick: () => openCreate() }, icon('plus', 16), t('memoria.addKnowledge')),
        ));
        return;
      }

      let list = records;
      const ids = searchIds(query);
      if (ids) {
        const byId = new Map(records.map((r) => [r.id, r]));
        list = ids.map((id) => byId.get(id)).filter(Boolean);
      }
      list = list.filter(matchesFilters);

      statusEl.textContent = t('memoria.results', { n: list.length });

      if (!list.length) {
        resultsBox.append(h('div.empty',
          icon('search', 30),
          h('div.empty-title', { text: t('state.empty') }),
          h('div.empty-body', { text: t('memoria.noResults') }),
        ));
        return;
      }

      const grid = h('div.know-grid');
      const sigTargets = [];
      for (const rec of list) grid.append(renderCard(rec, sigTargets));
      resultsBox.append(grid);
      verifyAll(sigTargets);
    }

    /* ----------------------------------------------------------- carga ----- */

    const scheduleReload = debounce(() => { load(); }, 80);

    async function load() {
      if (disposed) return;
      if (loading) { pendingReload = true; return; }
      loading = true;
      try {
        const [ks, cs] = await Promise.all([Store.sorted(COLLECTIONS.knowledge, 'desc'), Store.all(COLLECTIONS.curations)]);
        if (disposed) return;
        records = ks;
        curations = cs;
        buildIndex();
        paintFilters();
        renderGrid();
      } catch (err) {
        console.error('[memoria] no se pudo leer el archivo', err);
        ctx.toast(t('toast.error'), 'err');
      } finally {
        loading = false;
        if (pendingReload && !disposed) { pendingReload = false; scheduleReload(); }
      }
    }

    /* -------------------------------------------------- alta de saber ------ */

    function openCreate() {
      const draft = { kind: 'text', attachments: [], tags: [] };
      let kindTouched = false;
      let recorder = null;
      let chunks = [];
      let tick = null;
      let startedAt = 0;

      const recSupported = typeof window !== 'undefined'
        && typeof window.MediaRecorder === 'function'
        && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

      /* --- selector de tipo --- */
      const kindBox = h('div.chips', { role: 'group', 'aria-label': t('field.type') });
      const paintKinds = () => {
        clear(kindBox);
        for (const k of KINDS) {
          kindBox.append(h('button.chip', {
            type: 'button', 'aria-pressed': String(draft.kind === k),
            onclick: () => { draft.kind = k; kindTouched = true; paintKinds(); },
          }, icon(KIND_ICON[k], 13), kindLabel(t, k)));
        }
      };
      paintKinds();

      /* --- campos --- */
      const titleInput = h('input.input', { type: 'text', required: true, maxlength: '160', 'aria-label': t('field.title') });
      const contentInput = h('textarea.textarea.tall', { placeholder: t('memoria.contentPh'), 'aria-label': t('memoria.contentPh') });
      const cultureInput = h('input.input', { type: 'text', maxlength: '120', 'aria-label': t('field.culture') });
      const langs = (ctx.I18n && ctx.I18n.LANGUAGES) || ctx.LANGUAGES || [];
      const langSelect = h('select.select', { 'aria-label': t('field.language') },
        ...langs.map((l) => h('option', { value: l.code, selected: l.code === uiLang() }, `${l.flag || ''} ${l.native || l.code}`.trim())));
      const licenseSelect = h('select.select', { 'aria-label': t('field.license') },
        ...LICENSES.map((l) => h('option', { value: l }, licenseLabel(t, l))));
      const tagsInput = h('input.input', { type: 'text', placeholder: `${t('field.tags')} · ${t('field.optional')}`, 'aria-label': t('field.tags') });
      const tagBox = h('div.chips');
      const suggestionBox = h('div.chips');

      const paintTags = () => {
        clear(tagBox);
        for (const tag of draft.tags) {
          tagBox.append(h('span.chip.static', { text: tag },
            h('button.btn.icon.sm.ghost', {
              type: 'button', 'aria-label': `${t('action.remove')}: ${tag}`,
              onclick: () => { draft.tags = draft.tags.filter((x) => x !== tag); paintTags(); },
            }, icon('x', 12))));
        }
      };
      paintTags();

      const syncTagInput = () => {
        const raw = tagsInput.value.split(',');
        draft.tags = [...new Set(raw.map((x) => x.trim()).filter(Boolean))].slice(0, 12);
        paintTags();
      };
      s.on(tagsInput, 'input', syncTagInput);
      s.on(tagsInput, 'change', syncTagInput);

      const paintSuggestions = () => {
        clear(suggestionBox);
        const words = keywords([titleInput.value, contentInput.value].filter(Boolean).join(' '), 8)
          .filter((w) => !draft.tags.some((x) => normTag(x) === w));
        if (!words.length) return;
        suggestionBox.append(h('span.tiny.dim', { text: `${t('field.tags')}:` }));
        for (const w of words) {
          suggestionBox.append(h('button.chip', {
            type: 'button', onclick: () => { draft.tags = [...draft.tags, w].slice(0, 12); paintTags(); paintSuggestions(); },
          }, icon('plus', 12), w));
        }
      };
      const scheduleSuggestions = debounce(paintSuggestions, 400);
      s.on(titleInput, 'input', scheduleSuggestions);
      s.on(contentInput, 'input', scheduleSuggestions);

      /* --- adjuntos --- */
      const fileInput = h('input', { type: 'file', multiple: true, accept: ACCEPT_ATTR, style: 'display:none', tabindex: '-1' });
      const attList = h('div.stack.sm');
      const dropHint = h('div.hint');

      const paintAttachments = () => {
        clear(attList);
        for (const att of draft.attachments) {
          const preview = [];
          if (/^image\//i.test(att.type || '') && att.dataUrl) {
            preview.push(h('div.know-media', h('img', { src: att.dataUrl, alt: att.name || '', loading: 'lazy' })));
          } else if (/^audio\//i.test(att.type || '') && att.dataUrl) {
            preview.push(h('div.know-media', h('audio', { controls: true, preload: 'none', src: att.dataUrl })));
          } else if (att.text) {
            preview.push(h('div.sig-block', h('span.mono.break', { text: String(att.text).slice(0, 800) })));
          } else {
            preview.push(h('div.row.gap-2', icon('file', 16), h('span.sm.dim', { text: att.name || t('memoria.attachment') })));
          }
          attList.append(h('div.card.flat', h('div.card-body.tight.stack.sm',
            h('div.row.between.gap-2',
              h('span.sm.bold.break', { text: att.name || t('memoria.attachment') }),
              h('div.row.gap-2',
                h('span.badge', { text: fmt.bytes(att.size || 0) }),
                h('button.btn.icon.sm.ghost', {
                  type: 'button', 'aria-label': `${t('action.remove')}: ${att.name || ''}`,
                  onclick: () => { draft.attachments = draft.attachments.filter((x) => x.id !== att.id); paintAttachments(); },
                }, icon('x', 14)),
              ),
            ),
            ...preview,
          )));
        }
      };

      async function handleFiles(files) {
        dropHint.classList.remove('error');
        dropHint.textContent = '';
        for (const file of Array.from(files || [])) {
          if (!file) continue;
          if (file.size > MAX_ATTACHMENT_BYTES) {
            dropHint.classList.add('error');
            dropHint.textContent = t('memoria.sizeLimit');
            ctx.toast(t('memoria.sizeLimit'), 'warn');
            continue;
          }
          try {
            const type = file.type || (isTextLike('', file.name) ? 'text/plain' : 'application/octet-stream');
            const dataUrl = await readDataURL(file);
            let text = null;
            if (isTextLike(type, file.name) && file.size <= TEXT_PREVIEW_BYTES) {
              text = await readText(file).catch(() => null);
            }
            draft.attachments.push({ id: uid('att'), name: file.name, type, size: file.size, dataUrl, text });
            if (!kindTouched) {
              const guessed = kindForType(type, file.name);
              if (guessed) { draft.kind = guessed; paintKinds(); }
            }
          } catch (err) {
            console.warn('[memoria] no se pudo leer el adjunto', err);
            ctx.toast(t('toast.error'), 'err');
          }
        }
        paintAttachments();
      }

      s.on(fileInput, 'change', async (e) => { const f = e.target.files; e.target.value = ''; await handleFiles(f); });

      const dropzone = h('div.dropzone', {
        role: 'button', tabindex: '0', 'aria-label': t('memoria.attachment'),
        onclick: () => fileInput.click(),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } },
        ondragover: (e) => { e.preventDefault(); dropzone.classList.add('dragover'); },
        ondragleave: () => dropzone.classList.remove('dragover'),
        ondrop: async (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); await handleFiles(e.dataTransfer && e.dataTransfer.files); },
      }, icon('upload', 26), h('div.sm', { text: t('memoria.attachment') }), h('div.tiny.dim', { text: t('memoria.sizeLimit') }));

      /* --- grabadora --- */
      const wave = h('div.wave', { 'aria-hidden': 'true', style: 'display:none' }, ...Array.from({ length: 9 }, () => h('i')));
      const recStatus = h('div.hint', { role: 'status', 'aria-live': 'polite' });
      const recTimer = h('span.tiny.dim.mono');
      const recBtn = h('button.btn', {
        type: 'button', disabled: !recSupported,
        title: recSupported ? '' : 'MediaRecorder · getUserMedia',
        onclick: () => toggleRecording(),
      }, icon('mic', 16), t('memoria.recordAudio'));

      function stopStream() {
        try { if (activeStream) activeStream.getTracks().forEach((tr) => tr.stop()); } catch { /* ya detenido */ }
        activeStream = null;
      }

      function paintRecording(on) {
        wave.style.display = on ? '' : 'none';
        recTimer.textContent = '';
        clear(recBtn);
        recBtn.append(icon(on ? 'pause' : 'mic', 16), document.createTextNode(on ? t('action.stop') : t('memoria.recordAudio')));
        if (on) {
          recStatus.textContent = t('memoria.recording');
          startedAt = Date.now();
          tick = setInterval(() => {
            const secs = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
            recTimer.textContent = `${secs}s`;
          }, 1000);
        } else {
          recStatus.textContent = '';
          if (tick) { clearInterval(tick); tick = null; }
        }
      }

      async function toggleRecording() {
        if (recorder && recorder.state === 'recording') {
          try { recorder.stop(); } catch (err) { console.warn('[memoria] no se pudo detener la grabación', err); }
          return;
        }
        try {
          activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
          console.warn('[memoria] micrófono denegado', err);
          ctx.toast(t('toast.permission'), 'err');
          stopStream();
          return;
        }
        try {
          chunks = [];
          recorder = new MediaRecorder(activeStream);
          recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
          recorder.onstop = async () => {
            const type = (recorder && recorder.mimeType) || 'audio/webm';
            const blob = new Blob(chunks, { type });
            chunks = [];
            paintRecording(false);
            stopStream();
            try {
              const dataUrl = await readDataURL(blob);
              draft.attachments.push({
                id: uid('att'),
                name: `memoria-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`,
                type: 'audio/webm', size: blob.size, dataUrl,
              });
              if (!kindTouched) { draft.kind = 'audio'; paintKinds(); }
              paintAttachments();
              recStatus.textContent = t('state.saved');
            } catch (err) {
              console.warn('[memoria] no se pudo convertir la grabación', err);
              ctx.toast(t('toast.error'), 'err');
            }
          };
          recorder.start();
          paintRecording(true);
        } catch (err) {
          console.warn('[memoria] MediaRecorder no disponible', err);
          stopStream();
          ctx.toast(t('toast.error'), 'err');
        }
      }

      function stopRecordingOnClose() {
        try { if (recorder && recorder.state === 'recording') recorder.stop(); } catch { /* noop */ }
        if (tick) { clearInterval(tick); tick = null; }
        stopStream();
      }

      /* --- cuerpo del modal --- */
      const body = h('div',
        h('div.field', h('label.label', { text: t('field.type') }), kindBox),
        h('div.field', h('label.label', h('span', { text: t('field.title') }), h('span.req', { text: '*' })), titleInput),
        h('div.field', h('label.label', h('span', { text: t('memoria.contentPh') }), h('span.req', { text: '*' })), contentInput),
        h('div.form-grid',
          h('div.field', h('label.label', { text: t('field.culture') }), cultureInput),
          h('div.field', h('label.label', { text: t('field.language') }), langSelect),
          h('div.field', h('label.label', { text: t('field.license') }), licenseSelect),
        ),
        h('div.field', h('label.label', { text: t('field.tags') }), tagsInput, tagBox, suggestionBox),
        h('div.field',
          h('label.label', { text: t('memoria.attachment') }, h('span.opt', { text: t('field.optional') })),
          dropzone, fileInput, dropHint, attList,
        ),
        h('div.field',
          h('label.label', { text: t('memoria.recordAudio') }),
          h('div.row.gap-3.wrap', recBtn, wave, recTimer),
          recStatus,
          recSupported ? null : h('div.hint', { text: 'MediaRecorder · getUserMedia' }),
        ),
      );

      const modal = ctx.openModal({
        title: t('memoria.addKnowledge'),
        iconName: 'plus',
        size: 'wide',
        body,
        actions: [
          { label: t('action.cancel'), onClick: () => { stopRecordingOnClose(); } },
          {
            label: t('action.publish'), variant: 'primary', iconName: 'send',
            onClick: async () => {
              const title = titleInput.value.trim();
              const content = contentInput.value.trim();
              let bad = false;
              titleInput.setAttribute('aria-invalid', String(!title));
              contentInput.setAttribute('aria-invalid', String(!content && !draft.attachments.length));
              if (!title) bad = true;
              if (!content && !draft.attachments.length) bad = true;
              if (bad) { ctx.toast(t('toast.fieldsRequired'), 'warn'); return false; }
              stopRecordingOnClose();
              const payload = {
                title,
                kind: draft.kind,
                content,
                culture: cultureInput.value.trim(),
                contentLang: langSelect.value,
                license: licenseSelect.value,
                tags: draft.tags.slice(),
                attachments: draft.attachments.map((a) => ({ name: a.name, type: a.type, size: a.size, dataUrl: a.dataUrl, text: a.text || undefined })),
              };
              try {
                await ctx.publish(COLLECTIONS.knowledge, payload);
                ctx.toast(t('toast.published'), 'ok');
                await ctx.awardPoints(5, t('memoria.addKnowledge'));
                scheduleReload();
              } catch (err) {
                console.error('[memoria] no se pudo publicar', err);
                ctx.toast(t('toast.error'), 'err');
                return false;
              }
              return true;
            },
          },
        ],
      });

      if (!recSupported) recStatus.textContent = 'MediaRecorder · getUserMedia';

      /* Si el modal se cierra por cualquier vía, se libera el micrófono. */
      const watcher = new MutationObserver(() => {
        if (!modal.el.isConnected) { stopRecordingOnClose(); watcher.disconnect(); }
      });
      watcher.observe(document.body, { childList: true });
      s.observe(watcher);

      setTimeout(() => { try { titleInput.focus(); } catch { /* noop */ } }, 80);
    }

    /* ------------------------------------------------------- curaduría ----- */

    function openCurate(rec) {
      let score = 0;
      const scoreChips = h('div.chips', { role: 'group', 'aria-label': t('memoria.quality') });
      const paintScore = () => {
        clear(scoreChips);
        for (let n = 1; n <= 5; n++) {
          scoreChips.append(h('button.chip', {
            type: 'button', 'aria-pressed': String(score === n), 'aria-label': `${t('memoria.quality')} ${n}/5`,
            onclick: () => { score = clamp(n, 1, 5); paintScore(); },
          }, icon('spark', 12), `${n}/5`));
        }
      };
      paintScore();

      const noteInput = h('textarea.textarea', { placeholder: t('field.notes'), 'aria-label': t('field.notes') });

      ctx.openModal({
        title: t('memoria.curate'),
        iconName: 'check',
        body: h('div',
          h('p.sm.dim', { text: rec.title || '' }),
          h('div.field', h('label.label', { text: t('memoria.quality') }), scoreChips),
          h('div.field', h('label.label', { text: t('field.notes') }), noteInput),
        ),
        actions: [
          { label: t('action.cancel') },
          {
            label: t('action.save'), variant: 'primary', iconName: 'check',
            onClick: async () => {
              if (!score) { ctx.toast(t('toast.fieldsRequired'), 'warn'); return false; }
              const me = await ctx.requireIdentity();
              if (!me) return false;
              const author = await ctx.author();
              const payload = {
                id: `${rec.id}::${author.fingerprint}`,
                knowledgeId: rec.id,
                curator: { fingerprint: author.fingerprint, name: author.name },
                score: clamp(Number(score) || 0, 1, 5),
                note: noteInput.value.trim(),
              };
              try {
                await ctx.publish(COLLECTIONS.curations, payload);
                ctx.toast(t('toast.saved'), 'ok');
                await ctx.awardPoints(3, t('memoria.curate'));
                scheduleReload();
              } catch (err) {
                console.error('[memoria] no se pudo guardar la curaduría', err);
                ctx.toast(t('toast.error'), 'err');
                return false;
              }
              return true;
            },
          },
        ],
      });
    }

    async function removeRecord(rec) {
      const ok = await ctx.confirm({
        title: t('action.delete'), body: rec.title || '', confirmLabel: t('action.delete'), danger: true,
      });
      if (!ok) return;
      try {
        await Store.del(COLLECTIONS.knowledge, rec.id);
        for (const c of curations.filter((x) => x.knowledgeId === rec.id)) await Store.del(COLLECTIONS.curations, c.id);
        ctx.toast(t('toast.deleted'), 'ok');
        scheduleReload();
      } catch (err) {
        console.error('[memoria] no se pudo eliminar', err);
        ctx.toast(t('toast.error'), 'err');
      }
    }

    /* -------------------------------------------------------- exportar ----- */

    async function exportArchive() {
      try {
        const knowledge = await Store.all(COLLECTIONS.knowledge);
        const curationRows = await Store.all(COLLECTIONS.curations);
        const base = {
          format: 'pangea-memoria',
          spec: '1.0',
          exportedAt: new Date().toISOString(),
          counts: { knowledge: knowledge.length, curations: curationRows.length },
        };
        const signed = await Crypto.signed(base);
        const manifest = { ...base, ...(signed.sig ? { sig: signed.sig, signature: signed.sig } : { signature: null }) };
        const blob = zipSync([
          { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
          { name: 'knowledge.json', data: JSON.stringify({ format: 'pangea-memoria', spec: '1.0', collection: 'knowledge', records: knowledge }, null, 2) },
          { name: 'curations.json', data: JSON.stringify({ format: 'pangea-memoria', spec: '1.0', collection: 'curations', records: curationRows }, null, 2) },
        ]);
        download(`pangea-memoria-${new Date().toISOString().slice(0, 10)}.zip`, blob, 'application/zip');
        ctx.toast(t('toast.exported'), 'ok');
      } catch (err) {
        console.error('[memoria] fallo al exportar', err);
        ctx.toast(t('toast.error'), 'err');
      }
    }

    /* -------------------------------------------------------- importar ----- */

    function paintImportNote(state, detail) {
      clear(importNote);
      const ok = state === true;
      importNote.className = `banner mb-4${ok ? ' ok' : ' warn'}`;
      importNote.style.display = '';
      importNote.append(
        icon(ok ? 'check' : 'sos', 20),
        h('div.grow',
          h('strong', { text: ok ? t('state.verified') : t('state.unverified') }),
          detail ? h('div.tiny.dim', { text: detail }) : null,
        ),
      );
    }

    async function importArchive(file) {
      try {
        let manifest = null;
        let knowledge = [];
        let curationRows = [];
        const isZip = /\.zip$/i.test(file.name || '') || file.type === 'application/zip';

        if (isZip) {
          const entries = unzipSync(await readBuffer(file));
          const findEntry = (name) => entries.find((e) => e.name === name || e.name.endsWith(`/${name}`));
          const mEntry = findEntry('manifest.json');
          if (mEntry) { try { manifest = JSON.parse(mEntry.text); } catch { manifest = null; } }
          const kEntry = findEntry('knowledge.json');
          if (kEntry) knowledge = readCollection(JSON.parse(kEntry.text), 'knowledge');
          const cEntry = findEntry('curations.json');
          if (cEntry) curationRows = readCollection(JSON.parse(cEntry.text), 'curations');
        } else {
          const parsed = JSON.parse(await readText(file));
          manifest = parsed && parsed.manifest ? parsed.manifest : null;
          knowledge = readCollection(parsed, 'knowledge');
          curationRows = readCollection(parsed, 'curations');
          if (!knowledge.length && !curationRows.length && parsed && parsed.collections) {
            knowledge = Array.isArray(parsed.collections.knowledge) ? parsed.collections.knowledge : [];
            curationRows = Array.isArray(parsed.collections.curations) ? parsed.collections.curations : [];
          }
        }

        const payload = { collections: { knowledge, curations: curationRows } };
        const report = await Store.importAll(payload);

        let verdict = null;
        if (manifest) {
          const envelope = manifest.signature || manifest.sig || null;
          if (envelope) {
            const base = {
              format: manifest.format, spec: manifest.spec,
              exportedAt: manifest.exportedAt, counts: manifest.counts,
            };
            verdict = await Crypto.verify(base, envelope);
          } else {
            verdict = false;
          }
        }

        const n = report.imported || 0;
        ctx.toast(n > 0 ? t('nexus.dataImported', { n }) : t('toast.imported'), n > 0 ? 'ok' : 'info');
        if (verdict !== null) {
          paintImportNote(verdict, `${t('memoria.total', { n: knowledge.length })} · ${t('memoria.curators')}: ${curationRows.length}`);
        } else {
          paintImportNote(false, t('nexus.signatureInvalid'));
        }
        await load();
        ctx.refresh();
      } catch (err) {
        console.error('[memoria] importación fallida', err);
        ctx.toast(t('toast.error'), 'err');
      }
    }

    /* ----------------------------------------------------------- semilla -- */

    async function loadSeeds() {
      try {
        const existing = await Store.count(COLLECTIONS.knowledge);
        if (existing) { ctx.toast(t('memoria.total', { n: existing }), 'info'); return; }
        const res = await fetch(SEED_URL, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const seed = await res.json();
        const rows = readCollection(seed, 'knowledge');
        if (!rows.length) throw new Error('sin saberes semilla');
        let n = 0;
        for (const row of rows) {
          const rec = { ...row, seed: true };
          rec.id = rec.id || uid('know');
          await Store.put(COLLECTIONS.knowledge, rec, { silent: true });
          n++;
        }
        Store.emit(COLLECTIONS.knowledge, { action: 'seed', count: n });
        ctx.toast(t('memoria.seedsLoaded'), 'ok');
        await load();
      } catch (err) {
        console.warn('[memoria] datos semilla no disponibles', err);
        ctx.toast(t('toast.error'), 'warn');
      }
    }

    /* -------------------------------------------------------- almacenaje -- */

    async function paintStorage() {
      try {
        if (!navigator.storage || typeof navigator.storage.estimate !== 'function') { storageLine.textContent = ''; return; }
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        const pct = quota ? Math.round((usage / quota) * 100) : 0;
        clear(storageLine);
        storageLine.append(
          h('div.row.between.gap-2',
            h('span', { text: `${t('nexus.storage')}: ${fmt.bytes(usage)} / ${fmt.bytes(quota)}` }),
            h('span.mono', { text: `${pct}%` }),
          ),
          h('div.progress.mt-2', h('div.progress-bar', { style: `width:${clamp(pct, 2, 100)}%` })),
        );
      } catch {
        storageLine.textContent = '';
      }
    }

    /* ------------------------------------------------------------ cableado - */

    const onSearchInput = debounce(() => { query = searchInput.value.trim(); renderGrid(); }, 180);
    s.on(searchInput, 'input', onSearchInput);
    s.on(searchInput, 'search', onSearchInput);

    unsubs.push(ctx.onStore(COLLECTIONS.knowledge, () => scheduleReload()));
    unsubs.push(ctx.onStore(COLLECTIONS.curations, () => scheduleReload()));
    s.on(window, 'online', () => scheduleReload());

    paintStorage();
    await load();

    /* El panel de mando deja una intención («Quiero compartir conocimiento»)
     * para que el formulario de preservación se abra solo. Se consume una vez. */
    if (ctx.takeIntent('compose:knowledge')) openCreate();

    /* ------------------------------------------------------------ limpieza - */
    return () => {
      disposed = true;
      verifyToken++;
      onSearchInput.cancel();
      scheduleReload.cancel();
      for (const u of unsubs) { try { u(); } catch { /* noop */ } }
      unsubs.length = 0;
      try { if (speechAvailable()) window.speechSynthesis.cancel(); } catch { /* noop */ }
      speaking = null;
      try { if (activeStream) activeStream.getTracks().forEach((tr) => tr.stop()); } catch { /* noop */ }
      activeStream = null;
      s.destroy();
    };
  },
};
