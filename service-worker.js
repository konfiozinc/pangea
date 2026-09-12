/* ============================================================================
 * PANGEA · service-worker.js
 * Estrategia de caché pensada para el peor escenario: alguien que instala la
 * aplicación una vez con señal intermitente y después la usa donde no hay red.
 *
 *   · Armazón (HTML, CSS, JS, iconos, fuentes) → cache-first
 *   · Datos (data/*.json)                      → network-first con reserva local
 *   · Navegación                               → cache-first con reserva index.html
 *   · CDN de terceros (Leaflet, Chart.js…)     → stale-while-revalidate acotado
 *
 * Deliberadamente NO se cachea nada que no sea GET, ni peticiones con Range,
 * ni respuestas opacas de origen cruzado sin control.
 * ==========================================================================*/

const VERSION = '1.0.0';
const SHELL_CACHE = `pangea-shell-${VERSION}`;
const DATA_CACHE = `pangea-data-${VERSION}`;
const CDN_CACHE = `pangea-cdn-${VERSION}`;
const KEEP = [SHELL_CACHE, DATA_CACHE, CDN_CACHE];

/** Tamaño máximo del caché de CDN (entradas), para no crecer sin límite. */
const CDN_LIMIT = 40;

/** Armazón de la aplicación. Rutas relativas al ámbito del Service Worker. */
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './offline.html',

  './css/fonts.css',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/modules.css',

  './js/app.js',
  './js/store.js',
  './js/crypto.js',
  './js/i18n.js',
  './js/engine.js',
  './js/utils.js',

  './js/modules/simple.js',
  './js/modules/lingua.js',
  './js/modules/synapse.js',
  './js/modules/veritas.js',
  './js/modules/memoria.js',
  './js/modules/sos.js',
  './js/modules/agente.js',
  './js/modules/nexus-id.js',

  './js/workers/embeddings.worker.js',
  './js/workers/sync.worker.js',

  './js/locales/es.js',
  './js/locales/en.js',
  './js/locales/pt.js',
  './js/locales/fr.js',
  './js/locales/ar.js',
  './js/locales/hi.js',
  './js/locales/zh.js',
  './js/locales/ru.js',

  './data/categorias.json',
  './data/idiomas.json',
  './data/frases-emergencia.json',
  './data/conocimiento-semilla.json',

  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/audio/notificacion.wav',
];

/* Las fuentes se añaden al armazón sin listarlas una por una: si un archivo
 * falta, la instalación no debe fallar por eso.
 *
 * Se precargan SOLO los subconjuntos `latin`. Los `latin-ext` (acentos de
 * Europa central y oriental) son 7 archivos y 365 KB que la mayoría de las
 * visitas nunca llegan a usar: se cachean solos, cuando el navegador los pide,
 * con la estrategia de armazón. Precachear lo que no se va a usar retrasa la
 * primera instalación sin ningún beneficio a cambio. */
const FONT_FILES = [
  'Inter-400-latin', 'Inter-500-latin', 'Inter-600-latin',
  'Inter-700-latin', 'Inter-800-latin',
  'JetBrainsMono-400-latin', 'JetBrainsMono-500-latin',
].map((n) => `./assets/fonts/${n}.woff2`);

const PRECACHE = [...SHELL, ...FONT_FILES];

/* ------------------------------------------------------------ Instalación -- */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    /* Se cachea cada recurso por separado a propósito: con addAll(), un solo
     * archivo ausente cancelaría la instalación completa y dejaría a la
     * aplicación sin funcionamiento sin conexión. Preferimos un armazón
     * incompleto pero operativo, y completarlo en visitas posteriores. */
    const results = await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) console.warn(`[pangea:sw] ${failed} recursos no se pudieron precargar (se reintentará en uso)`);
    await self.skipWaiting();
  })());
});

/* ---------------------------------------------------------- Activación ----- */

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch { /* opcional */ }
    }
    await self.clients.claim();
  })());
});

/* -------------------------------------------------------------- Utilidad -- */

const isSameOrigin = (url) => url.origin === self.location.origin;
const isData = (url) => isSameOrigin(url) && url.pathname.includes('/data/');
const isStatic = (url) => isSameOrigin(url) && /\.(?:css|js|mjs|json|woff2?|png|jpe?g|svg|webp|gif|ico|wav|mp3|ogg|txt|webmanifest)$/i.test(url.pathname);

async function put(cacheName, request, response) {
  if (!response || !response.ok || response.status === 206) return response;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch { /* cuota agotada o respuesta no cacheable: no es un error fatal */ }
  return response;
}

async function trim(cacheName, limit) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= limit) return;
    await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
  } catch { /* irrelevante */ }
}

/** Cache-first: el armazón casi nunca cambia y debe estar siempre disponible. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: false });
  if (hit) {
    /* Revalidación silenciosa en segundo plano: así el armazón se mantiene
     * fresco sin hacer esperar a nadie. */
    fetch(request).then((res) => put(cacheName, request, res)).catch(() => {});
    return hit;
  }
  try {
    return await put(cacheName, request, await fetch(request));
  } catch (error) {
    const fallback = await cache.match('./index.html');
    if (fallback && request.mode === 'navigate') return fallback;
    throw error;
  }
}

/** Network-first: los datos pueden cambiar, pero sin red deben seguir ahí. */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    await put(cacheName, request, fresh.clone());
    return fresh;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

/** Stale-while-revalidate: responde ya y actualiza después. */
async function staleWhileRevalidate(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request).then((res) => put(cacheName, request, res)).then(() => trim(cacheName, limit)).catch(() => null);
  if (hit) { void network; return hit; }
  const res = await network;
  if (res) return res;
  return new Response('', { status: 504, statusText: 'Sin conexión' });
}

/* ------------------------------------------------------------ Peticiones -- */

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;

  let url;
  try { url = new URL(request.url); } catch { return; }
  if (!url.protocol.startsWith('http')) return;
  /* Nunca interferir con recursos de extensiones del navegador ni con el
   * panel de depuración. */
  if (url.pathname.startsWith('/__') || url.pathname.includes('chrome-extension')) return;

  /* Navegación: siempre el armazón, aunque la ruta no exista como archivo.
   * El orden importa: primero el armazón cacheado (el caso normal: la app ya se
   * visitó una vez), después la red, y solo si ninguna de las dos cosas está
   * disponible se sirve `offline.html`, que está precacheado y es autocontenido
   * —sin CSS, sin fuentes y sin scripts externos— porque precisamente en ese
   * momento nada de eso puede darse por supuesto. */
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
      } catch { /* sin precarga */ }
      const cache = await caches.open(SHELL_CACHE);
      try {
        const hit = await cache.match('./index.html');
        if (hit) {
          /* Se refresca en segundo plano sin hacer esperar a nadie. */
          fetch(request).then((res) => put(SHELL_CACHE, request, res)).catch(() => {});
          return hit;
        }
        const fresh = await fetch(request);
        return await put(SHELL_CACHE, request, fresh.clone());
      } catch {
        const offline = await cache.match('./offline.html');
        if (offline) return offline;
        return new Response('<h1>PANGEA</h1><p>Sin conexión y sin caché disponible.</p>', {
          status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
    })());
    return;
  }

  /* Datos locales: primero la red, con reserva permanente en caché. */
  if (isData(url)) { event.respondWith(networkFirst(request, DATA_CACHE)); return; }

  /* Armazón propio. */
  if (isSameOrigin(url) && (isStatic(url) || url.pathname.endsWith('/'))) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  /* Bibliotecas de terceros: se sirven de caché y se refrescan solas. */
  if (!isSameOrigin(url)) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE, CDN_LIMIT));
    return;
  }

  /* Cualquier otra petición del mismo origen pasa directa a la red. */
});

/* -------------------------------------------------------------- Mensajes -- */

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (msg.type === 'SW_UPDATED_CHECK') {
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED', version: VERSION }));
    });
    return;
  }
  if (msg.type === 'PING') { event.source?.postMessage({ type: 'PONG', version: VERSION }); }
});

/* ------------------------------------------- Sincronización en segundo plano */

self.addEventListener('sync', (event) => {
  /* La app decide cuándo sincronizar; aquí solo se registra el intento para
   * que el usuario pueda verlo. Nunca se envía nada sin consentimiento. */
  if (event.tag === 'pangea-sync') {
    event.waitUntil(self.clients.matchAll({ type: 'window' }).then((clients) => {
      clients.forEach((c) => c.postMessage({ type: 'SYNC_REQUESTED' }));
    }));
  }
});

/* ------------------------------------------------------------- Notas ------
 * Este Service Worker no envía ni recibe datos de ningún servidor propio:
 * PANGEA no tiene servidores. La única red que se toca es la que el usuario
 * provoca explícitamente (traducir, consultar un verificador externo o
 * sincronizar con su propio nodo comunitario).
 * ------------------------------------------------------------------------*/
