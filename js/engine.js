/* ============================================================================
 * PANGEA · js/engine.js
 * Motor semántico con degradación elegante.
 *
 *  Nivel 2 (neural)  → transformers.js + all-MiniLM-L6-v2 en un Web Worker,
 *                      descargado bajo demanda y cacheado por el Service Worker.
 *  Nivel 1 (local)   → embeddings por hashing de n-gramas (utils.localEmbed).
 *                      Funciona siempre: sin red, sin descargas, sin permisos.
 *
 * La app nunca depende de la red para razonar sobre el significado del texto.
 * ==========================================================================*/

import { localEmbed, cosine } from './utils.js';

let worker = null;
let nextId = 1;
const pending = new Map();
const listeners = new Set();

const STATE = {
  mode: 'local',      // 'local' | 'loading' | 'neural'
  ready: false,
  error: null,
  progress: 0,        // 0..100 mientras el modelo se descarga
  model: 'Xenova/all-MiniLM-L6-v2',
  dim: 192,
};

function notify() { listeners.forEach((fn) => { try { fn({ ...STATE }); } catch {} }); }

function spawnWorker() {
  try {
    const w = new Worker(new URL('./workers/embeddings.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type === 'ready') { STATE.mode = 'neural'; STATE.ready = true; notify(); return; }
      if (msg.type === 'error') { STATE.mode = 'local'; STATE.error = msg.message; notify(); return; }
      if (msg.type === 'progress') { STATE.mode = 'loading'; STATE.progress = msg.progress; notify(); return; }
      const slot = pending.get(msg.id);
      if (slot) {
        pending.delete(msg.id);
        if (msg.vectors) slot.resolve(msg.vectors.map((v) => Float32Array.from(v)));
        else slot.reject(new Error(msg.error || 'sin vectores'));
      }
    };
    w.onerror = (e) => { STATE.mode = 'local'; STATE.error = (e && e.message) || 'worker error'; notify(); };
    return w;
  } catch (e) {
    STATE.error = String(e && e.message);
    return null;
  }
}

export const Engine = {
  get state() { return { ...STATE }; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** Arranca el modelo neuronal solo si el usuario lo pide (o si hay recursos). */
  async warmup() {
    if (STATE.mode === 'neural' || worker) return STATE.mode;
    worker = spawnWorker();
    if (!worker) return 'local';
    STATE.mode = 'loading'; notify();
    worker.postMessage({ type: 'init', model: STATE.model });
    return STATE.mode;
  },

  /**
   * Convierte textos en vectores. Devuelve SIEMPRE vectores: si el modelo
   * neuronal no está disponible, usa el motor local.
   */
  async embed(texts) {
    const list = Array.isArray(texts) ? texts : [texts];
    if (STATE.mode === 'neural' && worker) {
      try {
        const id = nextId++;
        const vectors = await new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          worker.postMessage({ type: 'embed', id, texts: list });
          setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, 25000);
        });
        if (vectors.length === list.length) return vectors;
      } catch (e) {
        STATE.mode = 'local'; STATE.error = String(e && e.message); notify();
      }
    }
    STATE.mode = 'local';
    return list.map((tx) => localEmbed(tx, STATE.dim));
  },

  /** Similitud entre dos textos, con el motor activo. */
  async similarity(a, b) {
    const [va, vb] = await Engine.embed([a, b]);
    return cosine(va, vb);
  },

  /** Libera el worker (modo nodo ligero). */
  stop() {
    if (worker) { try { worker.postMessage({ type: 'dispose' }); worker.terminate(); } catch {} worker = null; }
    pending.clear();
    STATE.mode = 'local'; STATE.ready = false; notify();
  },
};

export default Engine;
