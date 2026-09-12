/**
 * PANGEA · tools/serve.mjs
 * Servidor estático mínimo para probar la PWA en local. Sin dependencias.
 *
 *     node tools/serve.mjs                 # http://127.0.0.1:8188
 *     node tools/serve.mjs --port 3000
 *
 * Detalles que importan para una PWA:
 *   · Se sirve por HTTP en 127.0.0.1, que los navegadores consideran origen
 *     seguro: los Service Workers, la criptografía y la geolocalización
 *     funcionan sin necesidad de HTTPS ni certificados.
 *   · Se envían los tipos MIME correctos para .mjs, .woff2, .webmanifest y
 *     .json, sin los cuales el navegador rechaza módulos y fuentes.
 *   · El Service Worker y el manifiesto se sirven con Cache-Control: no-cache
 *     para que las actualizaciones se detecten de inmediato.
 *   · Se bloquea cualquier ruta que salga del directorio del proyecto.
 *
 * NOTE: es una herramienta de desarrollo. Para producción, cualquier
 * servidor estático —o un alojamiento en un CDN— sirve los mismos archivos.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = Number(portArg >= 0 ? argv[portArg + 1] : process.env.PORT || 8188);
const HOST = (argv.indexOf('--host') >= 0 ? argv[argv.indexOf('--host') + 1] : '127.0.0.1');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
};

const NO_CACHE = /(?:^|[\\/])(?:service-worker\.js|index\.html|manifest\.json)$/i;

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const target = normalize(join(ROOT, clean));
  /* Nunca servir nada fuera del proyecto. */
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;
  return target;
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  let target = safePath(req.url || '/');

  if (!target) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('403 · Ruta fuera del proyecto');
  }

  try {
    let info = await stat(target).catch(() => null);
    if (info && info.isDirectory()) {
      target = join(target, 'index.html');
      info = await stat(target).catch(() => null);
    }
    /* Rutas del router por hash: todo lo que no sea un archivo cae en el shell. */
    if (!info) {
      target = join(ROOT, 'index.html');
      info = await stat(target);
    }

    const ext = extname(target).toLowerCase();
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': info.size,
      'cache-control': NO_CACHE.test(target) ? 'no-cache, must-revalidate' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cross-origin-opener-policy': 'same-origin',
      /* Permisos que PANGEA realmente usa; el resto queda cerrado. */
      'permissions-policy': 'geolocation=(self), microphone=(self), camera=(self)',
    };
    if (ext === '.js' || ext === '.mjs') headers['service-worker-allowed'] = '/';

    res.writeHead(200, headers);
    createReadStream(target).pipe(res);
    res.on('finish', () => {
      const ms = Date.now() - started;
      console.log(`  ${String(res.statusCode)} ${req.method} ${req.url}  ${ms}ms`);
    });
  } catch (error) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 · No encontrado');
    console.log(`  404 ${req.method} ${req.url}`);
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log('');
  console.log('  ██████  PANGEA');
  console.log('  El sistema operativo de la inteligencia colectiva humana');
  console.log('');
  console.log(`  Servidor activo en   ${url}`);
  console.log('  Origen seguro        sí (127.0.0.1 habilita Service Worker y criptografía)');
  console.log('');
  console.log('  Prueba rápida:');
  console.log('   1. Abre la dirección en el navegador.');
  console.log('   2. Instala la app desde el icono de la barra de direcciones.');
  console.log('   3. Activa el modo avión y recarga: debe seguir funcionando.');
  console.log('');
  console.log('  Ctrl+C para detener.');
  console.log('');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  El puerto ${PORT} ya está en uso. Prueba: node tools/serve.mjs --port ${PORT + 1}\n`);
  } else {
    console.error('\n  No se pudo iniciar el servidor:', e.message, '\n');
  }
  process.exitCode = 1;
});
