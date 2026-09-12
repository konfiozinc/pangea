/**
 * PANGEA · tools/subpath.mjs
 * Comprueba que PANGEA funciona servida desde una SUBCARPETA.
 *
 *     node tools/subpath.mjs
 *     node tools/subpath.mjs --sub otra-carpeta --port 8193
 *     node tools/subpath.mjs --url https://usuario.github.io/index-maestro-universal/
 *
 * Con `--url` no se copia nada: se comprueba la dirección YA PUBLICADA. Es la
 * comprobación que de verdad demuestra que el despliegue funciona, porque no
 * simula nada; y sólo se puede hacer cuando la aplicación ya está en internet.
 *
 * POR QU�0 HACE FALTA ESTA PRUEBA
 * ------------------------------
 * PANGEA se publica en una dirección del tipo
 *
 *     https://usuario.github.io/index-maestro-universal/
 *
 * y no en la raíz de un dominio. Esa diferencia rompe en silencio todo lo que
 * esté escrito con una barra delante: «/index.html» apunta fuera de la
 * subcarpeta. La página puede abrirse y verse bien mientras el Service Worker,
 * el manifiesto o los datos fallan por detrás, y eso no se descubre hasta que
 * ya está publicado y alguien lo instala.
 *
 * Esta prueba copia el proyecto a una carpeta temporal con la forma que tendrá
 * publicada, la sirve y abre un navegador de verdad. Comprueba lo que decide si
 * el despliegue sirve: que la aplicación arranque (que la cortina de arranque
 * desaparezca de verdad), que el manifiesto se lea, que el Service Worker coja
 * el alcance correcto, que TODOS los recursos precargados existan sin un solo
 * 404 y que siga arrancando sin conexión.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { cp, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const arg = (n, alt) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : alt);
const SUB = arg('--sub', 'index-maestro-universal');
const PUERTO = Number(arg('--port', 8193));
const PUERTO_CDP = Number(arg('--cdp-port', 9414));

const NAVEGADORES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter((n) => existsSync(n));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const resultados = [];
const anotar = (nombre, ok, detalle = '') => {
  resultados.push({ nombre, ok, detalle });
  console.log(`  ${ok ? '�S' : '�S'} ${nombre}${detalle ? ' � ' + detalle : ''}`);
};

const navegador = NAVEGADORES[0];
if (!navegador) {
  console.error('\n  No se encontró Chrome ni Edge. Esta prueba necesita un navegador.\n');
  process.exitCode = 1;
  process.exit();
}

console.log('\n���� Despliegue en subcarpeta ��������������������������������������������������������������������������������');

/* Se puede comprobar una carpeta local (simulando el despliegue) o una
   dirección ya publicada. Lo segundo es más concluyente porque no simula nada. */
const urlPublicada = arg('--url', null);
let servidor = null;
let DIRECCION;

if (urlPublicada) {
  DIRECCION = urlPublicada.endsWith('/') ? urlPublicada : urlPublicada + '/';
} else {
  const raizTemporal = await mkdtemp(join(tmpdir(), 'pangea-subcarpeta-'));
  const raizSitio = join(raizTemporal, 'sitio');
  await cp(RAIZ, join(raizSitio, SUB), {
    recursive: true,
    filter: (origen) => !/(node_modules|\.git|\.capturas)([\\/]|$)/.test(origen),
  });

  servidor = createServer(async (req, res) => {
    const destino = normalize(join(raizSitio, decodeURIComponent(String(req.url).split('?')[0])));
    if (!destino.startsWith(raizSitio + sep)) { res.writeHead(403).end(); return; }
    const info = await stat(destino).catch(() => null);
    const archivo = info?.isDirectory() ? join(destino, 'index.html') : destino;
    const existe = await stat(archivo).catch(() => null);
    if (!existe) { res.writeHead(404).end('404'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(archivo).toLowerCase()] || 'application/octet-stream', 'content-length': existe.size });
    createReadStream(archivo).pipe(res);
  });
  await new Promise((r) => servidor.listen(PUERTO, '127.0.0.1', r));
  DIRECCION = `http://127.0.0.1:${PUERTO}/${SUB}/`;
}

/* La ruta que debe tener el alcance del Service Worker, sea cual sea el sitio
   donde se esté sirviendo. */
const RUTA_ESPERADA = new URL(DIRECCION).pathname;

console.log(`  Navegador: ${navegador}`);
console.log(`  Objetivo:  ${DIRECCION}`);
console.log(urlPublicada ? '  (dirección publicada de verdad)\n' : '  (copia local con la forma del despliegue)\n');

const perfil = await mkdtemp(join(tmpdir(), 'pangea-perfil-'));
const hijo = spawn(navegador, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=430,900', `--user-data-dir=${perfil}`, `--remote-debugging-port=${PUERTO_CDP}`, 'about:blank',
], { stdio: 'ignore' });

try {
  for (let i = 0; i < 60; i++) {
    await dormir(300);
    try { if ((await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`)).ok) break; } catch { /* aún no */ }
  }

  const lista = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/list`)).json();
  const pestana = lista.find((t) => t.type === 'page');
  const ws = new WebSocket(pestana.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('sin canal CDP')), { once: true });
  });

  let contador = 0;
  const pendientes = new Map();
  const errores = [];
  const peticiones404 = [];
  /* Durante la fase sin conexión es NORMAL que fallen peticiones: eso es
     justamente lo que se está probando. Contarlas como errores haría que la
     prueba fallara precisamente cuando la aplicación se comporta bien. Las
     excepciones de JavaScript sí se cuentan siempre, porque ésas serían un
     fallo incluso sin red. */
  let enLinea = true;
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errores.push(m.params.exceptionDetails.text || 'excepción');
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && enLinea) errores.push(m.params.entry.text);
    if (m.method === 'Network.responseReceived' && m.params.response.status === 404) {
      peticiones404.push(m.params.response.url);
    }
    if (m.id && pendientes.has(m.id)) {
      const { resolver, rechazar } = pendientes.get(m.id);
      pendientes.delete(m.id);
      m.error ? rechazar(new Error(m.error.message)) : resolver(m.result);
    }
  });
  const enviar = (metodo, params = {}) => new Promise((resolver, rechazar) => {
    const id = ++contador;
    pendientes.set(id, { resolver, rechazar });
    ws.send(JSON.stringify({ id, method: metodo, params }));
  });
  const evaluar = async (cuerpo) => {
    const r = await enviar('Runtime.evaluate', {
      expression: `(async () => { ${cuerpo} })()`,
      returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };

  await enviar('Runtime.enable');
  await enviar('Page.enable');
  await enviar('Network.enable');
  await enviar('Log.enable');
  await enviar('Page.navigate', { url: DIRECCION });

  /* ---- 1. La aplicación arranca de verdad ------------------------------- */
  /* No basta con que el HTML llegue: hay que esperar a que la cortina de
     arranque se quite sola. Si el JavaScript no arranca, la página se queda
     tapada por esa cortina y ninguna comprobación de HTML lo detectaría.

     La espera es GENEROSA a propósito. Con `--url` esto se ejecuta contra una
     web publicada y una conexión real, y una conexión lenta puede tardar veinte
     segundos en bajar los 465 KB de la primera visita. Esperar poco hacía fallar
     la prueba en una red lenta aunque la aplicación funcionara perfectamente, y
     una prueba que miente es peor que no tenerla. */
  const LIMITE = Number(arg('--timeout', 60000));
  const t0 = Date.now();
  let arrancada = false;
  let msArranque = 0;
  while (Date.now() - t0 < LIMITE) {
    await dormir(250);
    const listo = await evaluar(`return { arrancando: document.documentElement.hasAttribute('data-booting'), app: !!document.querySelector('#app .app-sidebar, #app nav, #sidebar') };`).catch(() => null);
    if (listo && !listo.arrancando && listo.app) { arrancada = true; msArranque = Date.now() - t0; break; }
  }
  const estado = await evaluar(`return {
    arrancando: document.documentElement.hasAttribute('data-booting'),
    cortinaVisible: (() => { const b = document.querySelector('#boot'); if (!b) return false; const s = getComputedStyle(b); return s.visibility !== 'hidden' && s.opacity !== '0'; })(),
    barra: !!document.querySelector('#sidebar'),
    principal: !!document.querySelector('#main'),
    titulo: document.title,
  };`);
  anotar('La aplicación arranca y la cortina de arranque desaparece',
    arrancada && !estado.cortinaVisible,
    `«${estado.titulo}» · arrancó en ${(msArranque / 1000).toFixed(1)} s · barra=${estado.barra} · principal=${estado.principal} · cortina visible=${estado.cortinaVisible}`);

  /* ---- 2. El manifiesto ------------------------------------------------- */
  const manifiesto = await enviar('Page.getAppManifest');
  const parseado = manifiesto.parsed || {};
  const criticos = (manifiesto.errors || []).filter((e) => e.critical);
  anotar('El manifiesto se lee sin errores', criticos.length === 0,
    criticos.map((e) => e.message).join(' | ') || 'sin errores');

  const identidad = await evaluar(`
    const m = await (await fetch('manifest.json')).json();
    return { declarado: m.id, resuelto: new URL(m.id, new URL('manifest.json', location.href)).href, esperado: location.href };
  `);
  anotar('El identificador de la aplicación apunta a la subcarpeta',
    identidad.resuelto === identidad.esperado,
    `id: «${identidad.declarado}» �  ${identidad.resuelto}`);
  anotar('El alcance del manifiesto es la subcarpeta',
    String(parseado.scope || '').endsWith(RUTA_ESPERADA), `${parseado.scope}`);

  /* ---- 3. El Service Worker -------------------------------------------- */
  const sw = await evaluar(`
    try {
      const reg = await navigator.serviceWorker.getRegistration() || await navigator.serviceWorker.register('service-worker.js', { scope: './' });
      await navigator.serviceWorker.ready;
      const r = await navigator.serviceWorker.getRegistration() || reg;
      return { ok: true, alcance: r.scope, activo: !!r.active };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  `);
  anotar('El Service Worker se registra con el alcance correcto',
    sw.ok && String(sw.alcance).endsWith(RUTA_ESPERADA),
    sw.ok ? `alcance=${sw.alcance} · activo=${sw.activo}` : `ERROR: ${sw.error}`);

  /* ---- 4. Que TODOS los recursos precargados existan -------------------- */
  await dormir(2000);
  const cache = await evaluar(`
    const nombres = await caches.keys();
    if (!nombres.length) return { error: 'sin caché: el Service Worker no llegó a activarse' };
    let total = 0; const faltan = []; const nombres2 = [];
    for (const n of nombres) {
      const c = await caches.open(n);
      const pedidas = await c.keys();
      total += pedidas.length;
      nombres2.push(n + ' (' + pedidas.length + ')');
      for (const p of pedidas) { const r = await c.match(p); if (!r || !r.ok) faltan.push(p.url); }
    }
    return { total, faltan, caches: nombres2 };
  `);
  anotar('Todo lo precargado está guardado y sin errores',
    cache && !cache.error && cache.faltan.length === 0,
    cache?.error ? cache.error
      : `${cache.total} recursos${cache.faltan.length ? ' · FALLAN: ' + cache.faltan.slice(0, 5).join(', ') : ''}`);
  if (cache?.caches) console.log(`      cachés: ${cache.caches.join(' · ')}`);

  anotar('Ninguna petición del arranque devolvió 404', peticiones404.length === 0,
    peticiones404.slice(0, 4).join(' | ') || 'ninguna');

  /* ---- 5. Sin conexión: es la razón de ser de PANGEA -------------------- */
  enLinea = false;
  await enviar('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await dormir(300);
  const t1 = Date.now();
  await enviar('Page.reload', { ignoreCache: true });
  /* También aquí se espera a que arranque de verdad, en vez de dormir un rato
     fijo y mirar: en una máquina cargada o con el disco lento, 3,5 segundos no
     alcanzan y la prueba fallaba sin que hubiera nada roto. */
  let sinRedArrancada = false;
  let msSinRed = 0;
  while (Date.now() - t1 < LIMITE) {
    await dormir(250);
    const s = await evaluar(`return { arrancando: document.documentElement.hasAttribute('data-booting'), barra: !!document.querySelector('#sidebar') };`).catch(() => null);
    if (s && s.barra && !s.arrancando) { sinRedArrancada = true; msSinRed = Date.now() - t1; break; }
  }
  const sinRed = await evaluar(`return {
    arrancando: document.documentElement.hasAttribute('data-booting'),
    barra: !!document.querySelector('#sidebar'),
  };`);
  anotar('Sigue arrancando sin conexión', sinRedArrancada && sinRed.barra && !sinRed.arrancando,
    `arrancó en ${(msSinRed / 1000).toFixed(1)} s · barra=${sinRed.barra} · cortina de arranque=${sinRed.arrancando ? 'SIGUE PUESTA' : 'quitada'}`);
  await enviar('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  anotar('Sin errores de JavaScript con la red disponible', errores.length === 0,
    errores.slice(0, 2).join(' | ') || 'ninguno');
} catch (e) {
  anotar('Prueba del despliegue en subcarpeta', false, String(e.message || e));
} finally {
  spawnSync('taskkill', ['/PID', String(hijo.pid), '/T', '/F'], { stdio: 'ignore' });
  if (servidor) servidor.close();
}

/* ���� Resumen ������������������������������������������������������������������������������������������������������������������������������ */

const ok = resultados.filter((r) => r.ok).length;
const fallos = resultados.filter((r) => !r.ok);
console.log('\n' + '='.repeat(70));
console.log(`  Despliegue en subcarpeta: ${ok}/${resultados.length} correctas`);
console.log('='.repeat(70));
if (fallos.length) {
  console.log('\n  FALLOS');
  for (const f of fallos) console.log(`  �S ${f.nombre} � ${f.detalle}`);
  console.log('\n  Publicarlo así dejaría fallos que no se ven en la pantalla.\n');
} else {
  console.log('\n  PANGEA sirve tal cual en una subcarpeta: se puede publicar sin tocar nada.\n');
}
process.exitCode = fallos.length ? 1 : 0;
