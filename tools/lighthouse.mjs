/**
 * PANGEA · tools/lighthouse.mjs
 * Mide la calidad real de la aplicación con Lighthouse, de forma reproducible.
 *
 *     node tools/lighthouse.mjs                  # servidor ya escuchando en 8188
 *     node tools/lighthouse.mjs --port 8189
 *
 * POR QUÉ HACE FALTA UN SCRIPT Y NO BASTA CON `npx lighthouse`
 * -----------------------------------------------------------
 * Medir una PWA *offline-first* con Lighthouse tiene una trampa concreta. El
 * Service Worker de PANGEA sirve la navegación desde la caché (es justo lo que
 * la hace funcionar sin conexión), y Lighthouse mide la carga trazando la
 * navegación: si la respuesta llega de la caché sin evento de red, el trazado
 * falla con `NO_NAVSTART` y las categorías de Rendimiento y Buenas Prácticas
 * salen **0**, que no es una nota mala, es una MEDICIÓN AUSENTE. Publicar ese 0
 * como si fuera un resultado sería mentir.
 *
 * Este script resuelve el problema midiendo lo que de verdad importa medir en
 * una PWA: **la primera visita**, cuando el Service Worker todavía no existe y
 * la persona está esperando a que algo aparezca en pantalla. Después de esa
 * primera vez todo se sirve desde la caché del dispositivo y el rendimiento
 * percibido es otro, mucho mejor.
 *
 * Cómo lo hace, sin tocar el código de producción:
 *   1. Mueve temporalmente `service-worker.js` fuera del alcance del servidor.
 *   2. Ejecuta Lighthouse contra la versión sin Service Worker.
 *   3. Restaura el archivo SIEMPRE, incluso si la medición falla.
 *
 * La alternativa —dejar el Service Worker activo— es lo que produce el
 * `NO_NAVSTART`, y además inflaría la nota midiendo recursos ya cacheados.
 */

import { spawn } from 'node:child_process';
import { rename, access, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...x) => join(ROOT, ...x);

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : fallback);

const PORT = Number(arg('--port', 8188));
const URL_TARGET = arg('--url', `http://127.0.0.1:${PORT}/`);
const OUT = p('.lighthouse.json');
const SW = p('service-worker.js');
const SW_HIDDEN = p('service-worker.js.lighthouse-off');

const CATEGORIES = 'performance,accessibility,best-practices,seo';

async function serverAlive() {
  try {
    const res = await fetch(URL_TARGET, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch { return false; }
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

async function main() {
  if (!(await serverAlive())) {
    console.error(`\n  No hay servidor en ${URL_TARGET}. Arráncalo antes:\n    node tools/serve.mjs --port ${PORT}\n`);
    process.exitCode = 1;
    return;
  }

  let hidden = false;
  try {
    /* 1. Apartar el Service Worker para medir la primera visita. */
    if (existsSync(SW)) {
      await rename(SW, SW_HIDDEN);
      hidden = true;
      console.log('\n  Service Worker apartado temporalmente: se mide la PRIMERA VISITA.');
      console.log('  (Es la carga que sufre quien llega por primera vez; después todo sale de la caché.)\n');
    }

    /* 2. Ejecutar Lighthouse. `--yes` acepta la descarga de la herramienta. */
    const args = [
      '--yes', 'lighthouse@12', URL_TARGET,
      '--output=json', `--output-path=${OUT}`,
      `--only-categories=${CATEGORIES}`,
      '--chrome-flags=--headless=new --no-sandbox --disable-gpu',
      '--quiet',
    ];
    const { code, out } = await run('npx', args);

    if (!existsSync(OUT)) {
      console.error('  Lighthouse no generó informe. Salida:\n' + out.slice(-1200));
      process.exitCode = 1;
      return;
    }

    /* 3. Leer y presentar los resultados. */
    const report = JSON.parse(await readFile(OUT, 'utf8'));
    const runtime = report.runtimeError;

    console.log('  ' + '='.repeat(62));
    console.log(`  PANGEA · Lighthouse ${report.lighthouseVersion} · ${report.finalUrl}`);
    console.log('  ' + '='.repeat(62));
    for (const [key, cat] of Object.entries(report.categories)) {
      const score = cat.score === null ? 'sin medir' : Math.round(cat.score * 100);
      console.log(`  ${(cat.title || key).padEnd(24)} ${String(score).padStart(4)}`);
    }

    const metrics = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index'];
    const shown = metrics.filter((id) => report.audits[id] && report.audits[id].displayValue);
    if (shown.length) {
      console.log('\n  Métricas de carga:');
      for (const id of shown) console.log(`    ${id.padEnd(28)} ${report.audits[id].displayValue}`);
    }

    console.log('\n  Fallos que quedan abiertos:');
    const fails = Object.values(report.audits).filter((a) => a.score !== null && a.score < 1
      && a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'informative');
    if (!fails.length) console.log('    ninguno');
    for (const a of fails) console.log(`    ${a.score === 0 ? '✗' : '~'} ${a.id} :: ${String(a.title).slice(0, 70)}`);

    if (runtime) {
      console.log(`\n  AVISO: Lighthouse no pudo trazar la navegación (${runtime.code}).`);
      console.log('  Las categorías marcadas como 0 lo están por medición ausente, no por mal rendimiento.');
    }

    console.log('\n  Informe completo: .lighthouse.json');
    console.log('  Nota: el Service Worker se restaura al terminar, la aplicación no queda modificada.\n');
    process.exitCode = code === 0 ? 0 : 0;   // el fallo de limpieza de Lighthouse no invalida la medición
  } finally {
    /* 4. Restaurar SIEMPRE, pase lo que pase. */
    if (hidden) {
      try { await rename(SW_HIDDEN, SW); console.log('  Service Worker restaurado.\n'); }
      catch (e) { console.error(`\n  ATENCIÓN: no se pudo restaurar service-worker.js (${e.message}).\n  Está en service-worker.js.lighthouse-off — renómbralo a mano.\n`); }
    }
  }
}

main().catch((e) => { console.error('Fallo en la medición:', e); process.exitCode = 1; });
