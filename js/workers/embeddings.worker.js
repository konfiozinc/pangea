/* ============================================================================
 * PANGEA · js/workers/embeddings.worker.js
 * Worker de embeddings neuronales (transformers.js + all-MiniLM-L6-v2).
 *
 * Se carga BAJO DEMANDA desde js/engine.js. Si el modelo no puede descargarse
 * (sin red, dispositivo limitado, política corporativa), el worker lo comunica
 * y el motor principal cae con elegancia a los embeddings locales por n-gramas.
 * Nunca es un requisito: es una mejora.
 *
 * Mensajes aceptados:
 *   { type:'init', model }                     → descarga y prepara el modelo
 *   { type:'embed', id, texts:[...] }          → { id, vectors:number[][], dim }
 *   { type:'dispose' }                         → libera memoria
 * ==========================================================================*/

const CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

let extractor = null;
let loading = null;
let activeModel = DEFAULT_MODEL;

async function load(model) {
  if (extractor && activeModel === model) return extractor;
  if (loading) return loading;
  loading = (async () => {
    const mod = await import(/* @vite-ignore */ `${CDN}/dist/transformers.min.js`);
    const { pipeline, env } = mod;
    /* Todo se cachea en el navegador: la segunda visita funciona sin red. */
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    env.backends.onnx.wasm.numThreads = Math.min(2, navigator.hardwareConcurrency || 1);
    extractor = await pipeline('feature-extraction', model, {
      quantized: true,
      progress_callback: (p) => {
        if (p && p.status === 'progress' && typeof p.progress === 'number') {
          self.postMessage({ type: 'progress', progress: Math.round(p.progress) });
        }
      },
    });
    activeModel = model;
    return extractor;
  })();
  try { return await loading; } finally { loading = null; }
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === 'dispose') {
      extractor = null;
      self.postMessage({ type: 'ready', disposed: true });
      return;
    }

    const model = msg.model || activeModel;
    const pipe = await load(model);
    self.postMessage({ type: 'ready', model });

    if (msg.type === 'embed') {
      const texts = Array.isArray(msg.texts) ? msg.texts : [String(msg.texts ?? '')];
      const out = await pipe(texts, { pooling: 'mean', normalize: true });
      const dim = out.dims[out.dims.length - 1];
      const flat = Array.from(out.data);
      const vectors = [];
      for (let i = 0; i < texts.length; i++) vectors.push(flat.slice(i * dim, (i + 1) * dim));
      self.postMessage({ id: msg.id, vectors, dim, model });
    }
  } catch (error) {
    self.postMessage({
      id: msg.id,
      type: msg.type === 'embed' ? 'result' : 'error',
      error: String((error && error.message) || error),
      message: String((error && error.message) || error),
    });
  }
};

self.postMessage({ type: 'boot' });
