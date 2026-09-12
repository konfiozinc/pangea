/* ============================================================================
 * PANGEA · js/modules/lingua.js
 * LINGUA — Traducción universal en tiempo real, voz y lenguas vivas.
 *
 * Cuatro capacidades, una misma promesa: que el idioma en el que naciste
 * nunca sea la razón por la que tu problema queda sin resolver.
 *
 *   1. Traducción de texto    → MyMemory (sin clave) → nodo propio → fraseo local
 *   2. Conversación           → dos personas, dos idiomas, un dispositivo
 *   3. Lengua de señas (demo) → MediaPipe Hands, 100 % en el dispositivo
 *   4. Diccionario Vivo       → cualquiera preserva su lengua en IndexedDB
 *
 * Regla de diseño: sin red, LINGUA sigue siendo útil. El fraseo local de
 * emergencia traduce 12 idiomas sin conexión.
 * ==========================================================================*/

import {
  h, icon, scope, clear, fmt, uid, debounce, clamp, download, copyText, jsonFetch,
  readText, isOnline,
} from '../utils.js';
import { Store, COLLECTIONS } from '../store.js';

/* 12 idiomas de trabajo. `mm` = código para MyMemory, `bcp` = voz del navegador. */
const LANGS = [
  { code: 'es', name: 'Español', native: 'Español', flag: '🇪🇸', mm: 'es-ES', bcp: 'es-ES' },
  { code: 'en', name: 'English', native: 'English', flag: '🇬🇧', mm: 'en-GB', bcp: 'en-US' },
  { code: 'pt', name: 'Português', native: 'Português', flag: '🇧🇷', mm: 'pt-BR', bcp: 'pt-BR' },
  { code: 'fr', name: 'Français', native: 'Français', flag: '🇫🇷', mm: 'fr-FR', bcp: 'fr-FR' },
  { code: 'it', name: 'Italiano', native: 'Italiano', flag: '🇮🇹', mm: 'it-IT', bcp: 'it-IT' },
  { code: 'de', name: 'Deutsch', native: 'Deutsch', flag: '🇩🇪', mm: 'de-DE', bcp: 'de-DE' },
  { code: 'ar', name: 'العربية', native: 'العربية', flag: '🇸🇦', mm: 'ar-SA', bcp: 'ar-SA', rtl: true },
  { code: 'hi', name: 'हिन्दी', native: 'हिन्दी', flag: '🇮🇳', mm: 'hi-IN', bcp: 'hi-IN' },
  { code: 'zh', name: '中文', native: '中文', flag: '🇨🇳', mm: 'zh-CN', bcp: 'zh-CN' },
  { code: 'ja', name: '日本語', native: '日本語', flag: '🇯🇵', mm: 'ja-JP', bcp: 'ja-JP' },
  { code: 'ru', name: 'Русский', native: 'Русский', flag: '🇷🇺', mm: 'ru-RU', bcp: 'ru-RU' },
  { code: 'sw', name: 'Kiswahili', native: 'Kiswahili', flag: '🇰🇪', mm: 'sw-KE', bcp: 'sw-KE' },
];

/* Gestos estáticos reconocibles con la mano: patrón [pulgar, índice, medio, anular, meñique] */
const GESTURES = [
  { sign: 'hola', pattern: [1, 1, 1, 1, 1] },
  { sign: 'no', pattern: [0, 0, 0, 0, 0] },
  { sign: 'si', pattern: [1, 0, 0, 0, 0] },
  { sign: 'comida', pattern: [0, 1, 0, 0, 0] },
  { sign: 'ayuda', pattern: [0, 1, 1, 0, 0] },
  { sign: 'agua', pattern: [0, 1, 1, 1, 0] },
  { sign: 'medico', pattern: [0, 1, 1, 1, 1] },
  { sign: 'gracias', pattern: [0, 0, 0, 0, 1] },
];
const GESTURE_KEYS = GESTURES.map((g) => g.sign);

/* Reserva sin conexión: frases que salvan vidas, cargadas desde data/. */
let PHRASEBOOK = null;

export default {
  id: 'lingua',
  icon: 'translate',
  accent: 'cyan',
  titleKey: 'lingua.title',
  subKey: 'lingua.sub',

  async mount(root, ctx) {
    const s = scope(root);
    const view = h('div.view');
    root.append(view);

    const state = {
      tab: 'translate',
      from: ctx.I18n.lang === 'es' ? 'en' : 'es',
      to: ctx.I18n.lang,
      input: '',
      output: '',
      busy: false,
      source: null,
      autoSpeak: false,
      listening: false,
      recognition: null,
      conversation: [],
      turn: 'a',
      signRunning: false,
      hands: null,
      stream: null,
      detected: null,
      holdCount: 0,
      lastSign: null,
      dictQuery: '',
      dictRows: [],
    };

    try {
      const res = await fetch('./data/frases-emergencia.json', { cache: 'no-cache' });
      if (res.ok) PHRASEBOOK = await res.json();
    } catch { /* el fraseo local queda inactivo, la API sigue disponible */ }

    const unsubs = [ctx.onStore(COLLECTIONS.vocab, () => { if (state.tab === 'dictionary') paint(); })];
    const cardCache = new Map();

    const langOf = (code) => LANGS.find((l) => l.code === code) || LANGS[0];
    const opposite = () => (state.from === state.to ? (state.to === 'en' ? 'es' : 'en') : state.to);

    /* ================================================== MOTOR DE TRADUCCIÓN = */

    /** Fraseo local: búsqueda por normalización sobre el libro de frases. */
    function localTranslate(text, from, to) {
      if (!PHRASEBOOK || !PHRASEBOOK.phrases) return null;
      const norm = (x) => String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿?¡!.,;:]/g, '').replace(/\s+/g, ' ').trim();
      const q = norm(text);
      if (!q) return null;

      /* 1. Coincidencia exacta o contención directa. */
      for (const p of PHRASEBOOK.phrases) {
        const src = p[from];
        if (!src) continue;
        if (norm(src) === q) return p[to] || null;
      }
      /* 2. Coincidencia parcial por tokens (frases habladas con ruido). */
      let best = null, bestScore = 0;
      const qTokens = new Set(q.split(' '));
      for (const p of PHRASEBOOK.phrases) {
        const src = p[from];
        if (!src) continue;
        const sTokens = norm(src).split(' ');
        const hit = sTokens.filter((w) => qTokens.has(w)).length / Math.max(sTokens.length, 1);
        if (hit > bestScore) { bestScore = hit; best = p[to] || null; }
      }
      return bestScore >= 0.75 ? best : null;
    }

    /** Nodo LibreTranslate propio, si el usuario configuró uno. */
    async function nodeTranslate(text, from, to) {
      const endpoint = await Store.kv('pref.translate.endpoint', '');
      if (!endpoint) return null;
      const data = await jsonFetch(endpoint.replace(/\/$/, '') + '/translate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: text, source: from, target: to, format: 'text' }),
      }, 9000);
      return data && data.translatedText ? String(data.translatedText) : null;
    }

    /**
     * Cadena de traducción con degradación elegante.
     * Devuelve { text, source } donde source ∈ 'cache' | 'api' | 'node' | 'local' | 'none'.
     */
    async function translate(text, from, to) {
      const clean = String(text || '').trim();
      if (!clean || from === to) return { text: clean, source: 'cache' };

      const key = `tr:${from}:${to}:${clean.slice(0, 180).toLowerCase()}`;
      const cached = cardCache.get(key) || await Store.kv(key, null);
      if (cached) { cardCache.set(key, cached); return { text: cached, source: 'cache' }; }

      if (isOnline()) {
        try {
          const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean.slice(0, 480))}&langpair=${encodeURIComponent(langOf(from).mm)}|${encodeURIComponent(langOf(to).mm)}`;
          const data = await jsonFetch(url, {}, 9000);
          const out = data?.responseData?.translatedText;
          if (out && !/^MYMEMORY WARNING|INVALID/i.test(out)) {
            await Store.setKv(key, out);
            return { text: out, source: 'api' };
          }
        } catch { /* se intenta el siguiente nivel */ }

        try {
          const out = await nodeTranslate(clean, from, to);
          if (out) { await Store.setKv(key, out); return { text: out, source: 'node' }; }
        } catch { /* nodo no disponible */ }
      }

      const local = localTranslate(clean, from, to);
      if (local) return { text: local, source: 'local' };
      return { text: clean, source: 'none' };
    }

    /* ============================================================ VOZ ===== */

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

    function listen(langCode, { onResult, onEnd, onError } = {}) {
      if (!SpeechRec) { ctx.toast(ctx.t('lingua.notSupported'), 'warn'); onError?.(new Error('unsupported')); return null; }
      try {
        const rec = new SpeechRec();
        rec.lang = langOf(langCode).bcp;
        rec.continuous = false;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.onresult = (e) => {
          let text = '';
          for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript;
          onResult?.(text, e.results[e.results.length - 1].isFinal);
        };
        rec.onerror = (e) => {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') ctx.toast(ctx.t('lingua.micDenied'), 'err');
          onError?.(e);
        };
        rec.onend = () => onEnd?.();
        rec.start();
        return rec;
      } catch (e) { ctx.toast(String(e.message || e), 'err'); return null; }
    }

    function speak(text, langCode) {
      if (!('speechSynthesis' in window) || !text) return;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text.slice(0, 400));
        u.lang = langOf(langCode).bcp;
        u.rate = 0.98;
        const voice = window.speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith(langCode));
        if (voice) u.voice = voice;
        window.speechSynthesis.speak(u);
      } catch { /* la síntesis es un extra, nunca un requisito */ }
    }

    /* ==================================================== ARMADO DE VISTA = */

    async function paint() {
      clear(view);
      view.append(h('div.view-header',
        h('div.view-heading',
          h('h1.view-title', icon('translate', 26), ctx.t('lingua.title')),
          h('p.view-sub', { text: ctx.t('lingua.sub') }),
        ),
        h('div.view-actions',
          h('span.badge', { class: isOnline() ? 'ok' : 'warn' }, icon(isOnline() ? 'globe' : 'bolt', 12), ctx.t(isOnline() ? 'state.online' : 'state.offline')),
          h('label.switch', h('input', {
            type: 'checkbox', checked: state.autoSpeak,
            onchange: (e) => { state.autoSpeak = e.target.checked; },
          }), h('span.switch-track'), h('span.switch-label', ctx.t('lingua.autoSpeak'))),
        ),
      ));

      view.append(h('div.tabs', ...[
        ['translate', 'lingua.tabTranslate', 'translate'],
        ['conversation', 'lingua.tabConversation', 'users'],
        ['signs', 'lingua.tabSigns', 'camera'],
        ['dictionary', 'lingua.tabDictionary', 'book'],
      ].map(([id, key, ico]) => h('button.tab', {
        class: state.tab === id ? 'active' : '', role: 'tab', 'aria-selected': String(state.tab === id),
        onclick: () => { stopSigns(); state.tab = id; paint(); },
      }, icon(ico, 15), ctx.t(key)))));

      const host = h('div');
      view.append(host);
      if (state.tab === 'translate') await tabTranslate(host);
      else if (state.tab === 'conversation') await tabConversation(host);
      else if (state.tab === 'signs') await tabSigns(host);
      else await tabDictionary(host);
    }

    /* ------------------------------------------------------ Barra idiomas - */
    function langBar() {
      const mk = (which) => h('select.select', {
        'aria-label': ctx.t(which === 'from' ? 'lingua.from' : 'lingua.to'),
        onchange: (e) => { state[which] = e.target.value; if (state.from === state.to) state[which === 'from' ? 'to' : 'from'] = opposite(); paint(); },
      }, ...LANGS.map((l) => h('option', { value: l.code, selected: state[which] === l.code }, `${l.flag} ${l.native}`)));

      return h('div.lang-bar',
        h('span.upper.dim', { text: ctx.t('lingua.from') }), mk('from'),
        h('button.btn.icon.ghost.swap-btn', {
          title: ctx.t('lingua.swap'), 'aria-label': ctx.t('lingua.swap'),
          onclick: () => { const t0 = state.from; state.from = state.to; state.to = t0; const o = state.output; state.output = state.input; state.input = o; paint(); },
        }, icon('refresh', 18)),
        h('span.upper.dim', { text: ctx.t('lingua.to') }), mk('to'),
        h('span.grow'),
        h('span.badge', icon('spark', 12), state.source === 'local' ? ctx.t('synapse.engineLocal') : state.source === 'api' ? 'MyMemory' : state.source === 'node' ? ctx.t('settings.syncTitle') : '—'),
      );
    }

    /* ------------------------------------------------------------ TRADUCIR */
    async function tabTranslate(host) {
      const input = h('textarea.textarea.tall', {
        placeholder: ctx.t('lingua.inputPh'), dir: langOf(state.from).rtl ? 'rtl' : 'ltr',
        oninput: (e) => { state.input = e.target.value; },
      }, state.input);

      const out = h('div.pane-body', {
        'data-empty': String(!state.output), dir: langOf(state.to).rtl ? 'rtl' : 'ltr',
        'aria-live': 'polite',
        text: state.output || ctx.t('lingua.outputPh'),
      });

      const micBtn = h('button.btn.icon.mic-btn', {
        class: state.listening ? 'recording' : '', title: ctx.t('lingua.speak'), 'aria-label': ctx.t('lingua.listening'),
        onclick: () => toggleMic(),
      }, icon(state.listening ? 'pause' : 'mic', 18));

      const go = async () => {
        const text = input.value.trim();
        if (!text) return;
        state.input = text;
        state.busy = true;
        clear(out); out.dataset.empty = 'false';
        out.append(h('span.spinner.sm'), document.createTextNode(' ' + ctx.t('lingua.translating')));
        const res = await translate(text, state.from, state.to);
        state.output = res.text;
        state.source = res.source;
        state.busy = false;
        paint();
        if (res.source === 'none') ctx.toast(ctx.t('lingua.offlineNotice'), 'warn');
        if (state.autoSpeak) speak(res.text, state.to);
      };

      const toggleMic = () => {
        if (state.listening) { state.recognition?.stop(); state.listening = false; paint(); return; }
        state.recognition = listen(state.from, {
          onResult: (text, final) => {
            input.value = text; state.input = text;
            if (final) { state.listening = false; go(); }
          },
          onEnd: () => { if (state.listening) { state.listening = false; paint(); } },
        });
        if (state.recognition) { state.listening = true; paint(); }
      };

      host.append(langBar());
      host.append(h('div.translate-grid',
        h('div.pane',
          h('div.pane-head',
            h('span.upper.dim', { text: ctx.t('lingua.from') }),
            h('span.row.gap-1',
              h('span.char-count', { text: `${(state.input || '').length}/5000` }),
              micBtn,
            ),
          ),
          input,
        ),
        h('div.pane.result',
          h('div.pane-head',
            h('span.upper.dim', { text: ctx.t('lingua.to') }),
            h('span.row.gap-1',
              h('button.btn.icon.ghost.sm', { title: ctx.t('lingua.speak'), onclick: () => speak(state.output, state.to) }, icon('volume', 17)),
              h('button.btn.icon.ghost.sm', { title: ctx.t('action.copy'), onclick: () => copyText(state.output).then(() => ctx.toast(ctx.t('toast.copied'), 'ok')) }, icon('copy', 17)),
            ),
          ),
          out,
        ),
      ));

      host.append(h('div.row.gap-2.wrap.mt-4',
        h('button.btn.primary.lg', { onclick: go, disabled: state.busy }, icon('spark', 18), ctx.t('lingua.translate')),
        h('button.btn.lg', { onclick: () => { state.input = ''; state.output = ''; state.source = null; paint(); } }, icon('x', 18), ctx.t('action.reset')),
        state.listening ? h('span.wave', ...Array.from({ length: 9 }, () => h('i'))) : null,
        state.listening ? h('span.sm.dim', { text: ctx.t('lingua.listening') }) : h('span.sm.dim', { text: ctx.t('lingua.listeningHint') }),
      ));

      if (!SpeechRec) host.append(h('div.banner.warn.mt-4', icon('mic', 20), h('div', h('strong', { text: ctx.t('lingua.notSupported') }))));
    }

    /* ------------------------------------------------------- CONVERSACIÓN */
    async function tabConversation(host) {
      const log = h('div.chat', { 'aria-live': 'polite' });
      if (!state.conversation.length) {
        log.append(h('div.empty', { style: 'border:none;background:none' }, icon('users', 28),
          h('div.empty-body', { text: ctx.t('lingua.conversationHint') })));
      }
      for (const m of state.conversation) {
        log.append(h('div.bubble', { class: m.side, dir: langOf(m.lang).rtl ? 'rtl' : 'ltr' },
          h('div.orig', { lang: m.lang, text: m.original }),
          h('div.tr', { text: m.translated }),
          h('div.meta', icon('translate', 11), h('span', { text: `${m.lang.toUpperCase()} → ${m.target.toUpperCase()}` }),
            h('button.btn.icon.ghost.sm', { onclick: () => speak(m.translated, m.target) }, icon('volume', 13))),
        ));
      }
      setTimeout(() => { log.scrollTop = log.scrollHeight; }, 30);

      const mkTurn = (side, langCode) => h('div.turn-card', {
        class: state.turn === side ? 'active' : '',
        onclick: () => { state.turn = side; paint(); },
      }, h('span.upper.dim', { text: ctx.t(side === 'a' ? 'lingua.turnA' : 'lingua.turnB') }),
        h('span.badge', `${langOf(langCode).flag} ${langOf(langCode).native}`),
        h('button.btn.primary', {
          class: state.turn === side && state.listening ? 'danger' : '',
          onclick: (e) => { e.stopPropagation(); toggleTurn(side, langCode); },
        }, icon(state.turn === side && state.listening ? 'pause' : 'mic', 17),
          state.turn === side && state.listening ? ctx.t('lingua.listening') : ctx.t('lingua.speak')));

      const toggleTurn = (side, langCode) => {
        const target = side === 'a' ? state.to : state.from;
        if (state.listening) { state.recognition?.stop(); state.listening = false; paint(); return; }
        state.turn = side;
        state.recognition = listen(langCode, {
          onResult: async (text, final) => {
            if (!final) return;
            state.listening = false;
            const res = await translate(text, langCode, target);
            state.conversation.push({ side, lang: langCode, target, original: text, translated: res.text, at: Date.now() });
            state.turn = side === 'a' ? 'b' : 'a';
            paint();
            speak(res.text, target);
          },
          onEnd: () => { if (state.listening) { state.listening = false; paint(); } },
        });
        if (state.recognition) { state.listening = true; paint(); }
      };

      host.append(langBar());
      host.append(h('div.banner', icon('users', 20), h('div', h('strong', { text: ctx.t('lingua.tabConversation') }), h('div.sm', { text: ctx.t('lingua.conversationHint') }))));
      host.append(h('div.turn-bar.mt-4', mkTurn('a', state.from), mkTurn('b', state.to)));
      host.append(h('div.mt-4', log));
      host.append(h('div.row.gap-2.wrap.mt-4',
        h('button.btn', { onclick: () => { state.conversation = []; paint(); } }, icon('refresh', 16), ctx.t('action.reset')),
        h('button.btn', {
          onclick: () => {
            const text = state.conversation.map((m) => `[${m.lang.toUpperCase()}] ${m.original}\n[${m.target.toUpperCase()}] ${m.translated}`).join('\n\n');
            if (!text) return;
            download(`pangea-conversacion-${Date.now()}.txt`, text, 'text/plain');
          },
        }, icon('download', 16), ctx.t('action.export')),
        state.listening ? h('span.wave', ...Array.from({ length: 9 }, () => h('i'))) : null,
      ));
    }

    /* --------------------------------------------------- LENGUA DE SEÑAS -- */
    async function tabSigns(host) {
      const video = h('video', { playsinline: '', muted: '', autoplay: '' });
      const canvas = h('canvas');
      const stage = h('div.sign-stage', video, canvas,
        h('div.sign-placeholder', { id: 'sign-ph' }, icon('camera', 30), h('div.sm.mt-2', { text: ctx.t('lingua.gestureHint') })));

      const detected = h('div.row.gap-3',
        h('span.upper.dim', { text: ctx.t('lingua.detectedSign') }),
        h('span.sign-word', { text: state.detected ? ctx.t(`lingua.sign.${state.detected}`) : ctx.t('lingua.noSign') }),
      );

      host.append(h('div.banner', icon('lock', 20), h('div',
        h('strong', { text: ctx.t('lingua.gestureTitle') }),
        h('div.sm', { text: ctx.t('lingua.gestureHint') }))));
      host.append(h('div.grid.grid-2.mt-4',
        stage,
        h('div.stack',
          h('div.card', h('div.card-body.stack',
            h('h3', { text: ctx.t('lingua.gestureTitle') }),
            detected,
            h('div.row.gap-2.wrap',
              h('button.btn.primary', { onclick: () => startSigns(video, canvas, () => paint()) },
                icon('camera', 17), ctx.t('lingua.gestureStart')),
              h('button.btn', { onclick: () => { stopSigns(); paint(); } }, icon('pause', 17), ctx.t('lingua.gestureStop')),
            ),
            h('p.hint', { text: ctx.t('lingua.gestureHint') }),
          )),
          h('div.card', h('div.card-body',
            h('h4.section-title', { text: ctx.t('lingua.tabSigns') }),
            h('div.grid.grid-2', ...GESTURE_KEYS.map((g) => h('div.rule-row',
              h('span.sm', { text: ctx.t(`lingua.sign.${g}`) }),
              h('span.rule-weight', { text: GESTURES.find((x) => x.sign === g).pattern.map((b) => (b ? '✋' : '·')).join('') }),
            ))),
            h('p.hint.mt-2', { text: ctx.t('state.demo') }),
          )),
        )));
    }

    /** Carga MediaPipe Hands solo cuando hace falta. */
    function loadScript(src) {
      return new Promise((res, rej) => {
        if (document.querySelector(`script[src="${src}"]`)) return res();
        const el = h('script', { src, crossorigin: 'anonymous' });
        el.onload = () => res();
        el.onerror = () => rej(new Error('no se pudo cargar ' + src));
        document.head.append(el);
      });
    }

    async function startSigns(video, canvas, onChange) {
      if (!isOnline()) { ctx.toast(ctx.t('lingua.offlineNotice'), 'warn'); return; }
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js');
      } catch {
        ctx.toast(ctx.t('state.error'), 'err');
        return;
      }
      try {
        state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
      } catch {
        ctx.toast(ctx.t('lingua.cameraDenied'), 'err');
        return;
      }
      video.srcObject = state.stream;
      await video.play().catch(() => {});

      if (!window.Hands) { ctx.toast(ctx.t('state.error'), 'err'); return; }
      const hands = new window.Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}` });
      hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
      hands.onResults((results) => drawSigns(results, canvas, onChange));
      state.hands = hands;
      state.signRunning = true;
      canvas.parentElement?.querySelector('#sign-ph')?.remove();

      const pump = async () => {
        if (!state.signRunning) return;
        try { await hands.send({ image: video }); } catch { /* fotograma descartado */ }
        if (state.signRunning) requestAnimationFrame(pump);
      };
      requestAnimationFrame(pump);
    }

    function stopSigns() {
      state.signRunning = false;
      try { state.hands?.close?.(); } catch {}
      state.hands = null;
      try { state.stream?.getTracks().forEach((t) => t.stop()); } catch {}
      state.stream = null;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }

    /**
     * Deducción de la seña a partir de 21 puntos de la mano.
     * Se compara la distancia al punto de la muñeca (0) entre la punta y la
     * articulación media: es invariante a escala y a la distancia a la cámara.
     */
    function drawSigns(results, canvas, onChange) {
      const g = canvas.getContext('2d');
      const W = canvas.width = canvas.clientWidth || 640;
      const H = canvas.height = canvas.clientHeight || 480;
      g.clearRect(0, 0, W, H);
      const lms = results?.multiHandLandmarks?.[0];
      if (!lms) { state.holdCount = 0; return; }

      /* Trazo del esqueleto para dar retroalimentación visual inmediata. */
      const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
      g.strokeStyle = 'rgba(99,102,241,.9)'; g.lineWidth = 3; g.lineCap = 'round';
      for (const [a, b] of CONNECTIONS) {
        g.beginPath();
        g.moveTo(lms[a].x * W, lms[a].y * H);
        g.lineTo(lms[b].x * W, lms[b].y * H);
        g.stroke();
      }
      g.fillStyle = 'rgba(16,185,129,.95)';
      for (const p of lms) { g.beginPath(); g.arc(p.x * W, p.y * H, 4, 0, Math.PI * 2); g.fill(); }

      const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.5);
      const FINGERS = [[4, 3], [8, 6], [12, 10], [16, 14], [20, 18]]; // [punta, articulación media]
      const pattern = FINGERS.map(([tip, pip]) => (d(lms[tip], lms[0]) > d(lms[pip], lms[0]) * 1.08 ? 1 : 0));

      const match = GESTURES.find((x) => x.pattern.every((b, i) => b === pattern[i]));
      if (!match) { state.holdCount = 0; return; }

      /* Estabilización: exige varios fotogramas seguidos antes de confirmar. */
      state.holdCount = (state.holdCount || 0) + 1;
      if (state.holdCount < 7) return;
      state.holdCount = 0;
      if (state.lastSign === match.sign) return;
      state.lastSign = match.sign;
      state.detected = match.sign;
      ctx.U.haptic(18);
      speak(ctx.t(`lingua.sign.${match.sign}`), ctx.I18n.lang);
      onChange?.();
    }

    /* --------------------------------------------------- DICCIONARIO VIVO */
    async function tabDictionary(host) {
      const rows = await Store.sorted(COLLECTIONS.vocab, 'desc');
      const q = state.dictQuery.toLowerCase();
      const filtered = q
        ? rows.filter((r) => `${r.word} ${r.meaning} ${r.dialect || ''} ${r.speaker || ''}`.toLowerCase().includes(q))
        : rows;

      const search = h('div.search-box',
        icon('search', 17),
        h('input.input', {
          placeholder: ctx.t('lingua.searchWord'), value: state.dictQuery,
          oninput: debounce((e) => { state.dictQuery = e.target.value; paint(); }, 220),
        }),
      );

      /* B3: importa un diccionario exportado por este mismo módulo. */
      const importFile = h('input', {
        type: 'file', accept: '.json,application/json', style: 'display:none',
        onchange: async (e) => {
          const file = e.target && e.target.files ? e.target.files[0] : null;
          if (e.target) e.target.value = '';
          if (!file) return;
          try {
            const raw = JSON.parse(await readText(file));
            if (!raw || raw.format !== 'pangea-lingua-dictionary' || !Array.isArray(raw.words)) {
              ctx.toast(ctx.t('toast.error'), 'err');
              return;
            }
            const existing = new Set((await Store.all(COLLECTIONS.vocab)).map((r) => r.id));
            let n = 0;
            for (const w of raw.words) {
              if (!w || typeof w !== 'object' || typeof w.id !== 'string' || !w.id) continue;
              if (existing.has(w.id)) continue;
              await Store.put(COLLECTIONS.vocab, { ...w }, { silent: true });
              existing.add(w.id);
              n++;
            }
            ctx.toast(ctx.t('lingua.imported', { n }), 'ok');
            await paint();
          } catch (err) {
            ctx.toast(ctx.t('toast.error'), 'err');
          }
        },
      });

      const list = filtered.length
        ? h('div.vocab-grid', ...filtered.map((w) => h('article.vocab-card',
            h('div.row.between.gap-2',
              h('div.vocab-word', { text: w.word }),
              h('div.row.gap-2',
                w.audio ? h('button.btn.icon.ghost.sm', { title: ctx.t('lingua.audioGuide'), onclick: () => { try { new Audio(w.audio).play(); } catch {} } }, icon('volume', 15)) : null,
                h('button.btn.icon.ghost.sm', { title: ctx.t('lingua.editWord'), 'aria-label': ctx.t('lingua.editWord'), onclick: () => editWord(w) }, icon('edit', 15)),
              ),
            ),
            h('div.vocab-mean', { text: w.meaning }),
            w.example ? h('div.sm.dim', { style: 'font-style:italic', text: w.example }) : null,
            h('div.vocab-meta',
              w.lang ? h('span.badge', langOf(w.lang).flag + ' ' + langOf(w.lang).native) : null,
              w.dialect ? h('span.badge', w.dialect) : null,
              w.speaker ? h('span.badge', { class: 'info', text: w.speaker }) : null,
            ),
            h('div.tiny.dim', { text: `${ctx.t('lingua.contributedBy')}: ${w.author?.name || '—'} · ${fmt.rel(w.createdAt, ctx.I18n.lang)}` }),
          )))
        : h('div.empty', icon('book', 30), h('div.empty-title', { text: ctx.t('lingua.noWords') }),
            h('div.empty-body', { text: ctx.t('lingua.dictionarySub') }));

      host.append(h('div.banner', icon('heart', 20), h('div',
        h('strong', { text: ctx.t('lingua.dictionaryTitle') }),
        h('div.sm', { text: ctx.t('lingua.dictionarySub') }))));

      host.append(h('div.row.gap-2.wrap.mt-4',
        h('button.btn.primary', { onclick: () => openWordModal() }, icon('plus', 17), ctx.t('lingua.addWord')),
        h('div.grow', { style: 'min-width:220px' }, search),
        h('span.badge', icon('book', 12), ctx.t('lingua.wordsCount', { n: rows.length })),
        h('button.btn', { onclick: () => exportDict(rows) }, icon('download', 16), ctx.t('lingua.exportDict')),
        h('button.btn', { onclick: () => importFile.click() }, icon('upload', 16), ctx.t('lingua.importDict')),
        importFile,
      ));
      host.append(h('div.mt-4', list));
    }

    function openWordModal(existing = null) {
      const editing = !!existing;
      const word = h('input.input', { placeholder: ctx.t('lingua.word'), maxlength: '80', value: editing ? String(existing.word || '') : '' });
      const meaning = h('input.input', { placeholder: ctx.t('lingua.translation'), maxlength: '160', value: editing ? String(existing.meaning || '') : '' });
      const dialect = h('input.input', { placeholder: ctx.t('lingua.dialect'), value: editing ? String(existing.dialect || '') : '' });
      const speaker = h('input.input', { placeholder: ctx.t('lingua.speaker'), value: editing ? String(existing.speaker || '') : '' });
      /* B1: campo opcional «Ejemplo de uso» (máx. 240 caracteres). */
      const example = h('input.input', { placeholder: ctx.t('field.example'), maxlength: '240', value: editing ? String(existing.example || '') : '' });
      const lang = h('select.select', {}, ...LANGS.map((l) => h('option', { value: l.code, selected: l.code === (editing ? existing.lang : state.from) }, `${l.flag} ${l.native}`)));
      /* Al editar se conserva la grabación existente salvo que se vuelva a grabar. */
      let audioData = editing ? (existing.audio || null) : null;
      let rec = null;
      const audioStatus = h('div.tiny.dim');
      if (editing && audioData) {
        audioStatus.append(h('span.badge.ok', icon('volume', 12), ctx.t('lingua.audioGuide')));
      }

      const recBtn = h('button.btn.sm', {
        onclick: async () => {
          if (rec && rec.state === 'recording') { rec.stop(); return; }
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const chunks = [];
            rec = new MediaRecorder(stream);
            rec.ondataavailable = (e) => chunks.push(e.data);
            rec.onstop = async () => {
              stream.getTracks().forEach((t) => t.stop());
              const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
              audioData = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(blob); });
              clear(audioStatus); audioStatus.append(h('span.badge.ok', icon('volume', 12), ctx.t('lingua.audioGuide')));
              clear(recBtn); recBtn.append(icon('mic', 14), document.createTextNode(ctx.t('action.record')));
            };
            rec.start();
            clear(recBtn); recBtn.append(icon('pause', 14), document.createTextNode(ctx.t('lingua.listening')));
          } catch { ctx.toast(ctx.t('toast.permission'), 'warn'); }
        },
      }, icon('mic', 14), ctx.t('action.record'));

      ctx.openModal({
        title: editing ? ctx.t('lingua.editWord') : ctx.t('lingua.addWord'), iconName: 'book', size: 'wide',
        body: h('div.stack',
          h('div.form-grid',
            h('div.field', h('label.label', ctx.t('lingua.word'), h('span.req', '*')), word),
            h('div.field', h('label.label', ctx.t('lingua.translation'), h('span.req', '*')), meaning),
            h('div.field', h('label.label', ctx.t('field.language')), lang),
            h('div.field', h('label.label', ctx.t('lingua.dialect'), h('span.opt', ctx.t('field.optional'))), dialect),
            h('div.field', h('label.label', ctx.t('lingua.speaker'), h('span.opt', ctx.t('field.optional'))), speaker),
          ),
          h('div.field', h('label.label', ctx.t('field.example'), h('span.opt', ctx.t('field.optional'))), example),
          h('div.row.gap-2.wrap', recBtn, audioStatus),
          h('p.hint', { text: ctx.t('lingua.dictionarySub') }),
        ),
        actions: [
          { label: ctx.t('action.cancel') },
          {
            label: ctx.t('action.save'), variant: 'primary',
            onClick: async () => {
              if (word.value.trim().length < 2 || meaning.value.trim().length < 2) { ctx.toast(ctx.t('toast.fieldsRequired'), 'warn'); return false; }
              const fields = {
                word: word.value.trim(), meaning: meaning.value.trim(),
                dialect: dialect.value.trim(), speaker: speaker.value.trim(),
                lang: lang.value, example: example.value.trim().slice(0, 240), audio: audioData,
              };
              if (editing) {
                const ok = await commitEdit(existing, fields);
                return ok;
              }
              await ctx.publish(COLLECTIONS.vocab, { id: uid('voc'), ...fields });
              ctx.toast(ctx.t('toast.published'), 'ok');
              await Store.log('lingua', `${fields.word} → ${fields.meaning}`, { lang: fields.lang });
            },
          },
        ],
      });
    }

    async function editWord(w) {
      const fp = w && w.sig && w.sig.fp ? w.sig.fp : null;
      if (fp) {
        const me = await ctx.author();
        if (me.anon || me.fingerprint !== fp) {
          /* Firmada por OTRA identidad: editar su contribución firmada y
           * presentarla como propia sería deshonesto. Se bloquea la edición. */
          ctx.toast(ctx.t('toast.permission'), 'warn');
          return;
        }
      }
      openWordModal(w);
    }

    /**
     * Reemplaza una palabra por su mismo `id` (nunca se duplica). Si la palabra
     * original está firmada por esta misma identidad, se vuelve a firmar con
     * `ctx.publish` (mismo `id`); si está firmada por otra identidad, NO se edita
     * (sería suplantar su contribución firmada). Si no tiene firma (anónima/local),
     * se reemplaza sin re-firmar.
     */
    async function commitEdit(original, fields) {
      const me = await ctx.author();
      const fp = original && original.sig && original.sig.fp ? original.sig.fp : null;
      if (fp) {
        if (me.anon || me.fingerprint !== fp) {
          ctx.toast(ctx.t('toast.permission'), 'warn');
          return false;
        }
        // Firmada por mí: ctx.publish firma el contenido editado y reemplaza.
        await ctx.publish(COLLECTIONS.vocab, {
          id: original.id, createdAt: original.createdAt || Date.now(), ...fields,
        });
      } else {
        // Sin firma: no hay autor ajeno que reclamar; se reemplaza en local.
        await Store.put(COLLECTIONS.vocab, {
          id: original.id, createdAt: original.createdAt || Date.now(),
          ...fields, author: original.author,
        });
      }
      ctx.toast(ctx.t('lingua.savedWord'), 'ok');
      return true;
    }

    function exportDict(rows) {
      if (!rows.length) { ctx.toast(ctx.t('state.empty'), 'warn'); return; }
      const payload = {
        format: 'pangea-lingua-dictionary', spec: '1.0',
        exportedAt: new Date().toISOString(),
        languages: LANGS.map((l) => ({ code: l.code, name: l.name, native: l.native })),
        words: rows,
      };
      download(`pangea-diccionario-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
      ctx.toast(ctx.t('toast.exported'), 'ok');
    }

    await paint();

    return () => {
      try { state.recognition?.abort?.(); } catch {}
      stopSigns();
      unsubs.forEach((u) => { try { u(); } catch {} });
      s.destroy();
    };
  },
};
