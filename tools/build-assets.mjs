/**
 * PANGEA · tools/build-assets.mjs
 * Genera los recursos binarios del proyecto SIN dependencias externas.
 *
 *   node tools/build-assets.mjs
 *
 * Produce:
 *   · assets/icons/icon-192.png            icono PWA
 *   · assets/icons/icon-512.png            icono PWA
 *   · assets/icons/icon-maskable-512.png   icono maskable (zona segura 80 %)
 *   · assets/audio/notificacion.wav        aviso sonoro de dos tonos
 *   · assets/fonts/*.woff2 + css/fonts.css tipografía auto-alojada
 *
 * Auto-alojar las fuentes no es un detalle estético: PANGEA promete cero
 * peticiones a terceros, y una hoja de estilos de Google Fonts es exactamente
 * eso. Con los archivos en el repositorio, la promesa es verificable y la
 * aplicación se ve igual sin conexión.
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...x) => join(ROOT, ...x);

/* ============================================================ PNG =========== */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

/** Codifica RGBA en PNG (8 bits, color type 6). */
function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtro "none"
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const mix = (a, b, k) => a + (b - a) * k;
const smooth = (edge0, edge1, x) => { const t = clamp01((x - edge0) / (edge1 - edge0)); return t * t * (3 - 2 * t); };

/** Parada de color del degradado aurora (violeta → cian → esmeralda). */
const AURORA = [
  [0.00, [0x63, 0x66, 0xF1]],
  [0.34, [0x8B, 0x5C, 0xF6]],
  [0.68, [0x06, 0xB6, 0xD4]],
  [1.00, [0x10, 0xB9, 0x81]],
];

function auroraAt(t) {
  t = clamp01(t);
  for (let i = 0; i < AURORA.length - 1; i++) {
    const [t0, c0] = AURORA[i], [t1, c1] = AURORA[i + 1];
    if (t <= t1) { const k = (t - t0) / (t1 - t0); return [mix(c0[0], c1[0], k), mix(c0[1], c1[1], k), mix(c0[2], c1[2], k)]; }
  }
  return AURORA[AURORA.length - 1][1];
}

/**
 * Dibuja el icono de PANGEA: un globo terráqueo en trazo blanco sobre el
 * degradado aurora. El globo es geometría pura —círculo, meridianos y
 * paralelos—, sin dependencias de fuentes ni de imágenes externas.
 */
function drawIcon(size, { maskable = false, rounded = true } = {}) {
  const img = Buffer.alloc(size * size * 4);
  const SS = 3;                                  // supermuestreo para bordes limpios
  const c = size / 2;
  const radius = maskable ? size * 0.56 : size * 0.44;   // zona segura en maskable
  const stroke = radius * 0.085;
  const corner = rounded && !maskable ? size * 0.22 : 0;
  const bg = maskable ? size : size * (rounded ? 0.94 : 1);
  const off = (size - bg) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          /* Fondo: degradado aurora recortado por un cuadrado redondeado. */
          const qx = px - off, qy = py - off;
          let bgCov = 1;
          if (corner > 0) {
            const dx = Math.max(corner - qx, 0, qx - (bg - corner));
            const dy = Math.max(corner - qy, 0, qy - (bg - corner));
            bgCov = 1 - smooth(-0.5, 0.5, Math.hypot(dx, dy) - corner);
          } else {
            bgCov = (qx >= 0 && qx <= bg && qy >= 0 && qy <= bg) ? 1 : 0;
          }

          const t = ((qx / bg) * 0.62 + (qy / bg) * 0.38);
          const [cr, cg, cb] = auroraAt(t);
          let R = cr, G = cg, B = cb, A = bgCov;

          /* Globo: trazo blanco sobre el fondo. */
          const dx = px - c, dy = py - c;
          const dist = Math.hypot(dx, dy);
          let ink = 0;

          ink = Math.max(ink, 1 - smooth(stroke * 0.5 - 0.5, stroke * 0.5 + 0.5, Math.abs(dist - radius)));

          for (const k of [0.5, 0.866]) {           // meridianos (elipses)
            const rx = radius * k, ry = radius;
            const e = Math.hypot(dx / rx, dy / ry);
            const d2 = Math.abs(e - 1) * ((rx + ry) / 2);
            ink = Math.max(ink, 1 - smooth(stroke * 0.42 - 0.5, stroke * 0.42 + 0.5, d2));
          }

          for (const dyP of [-0.5, 0.5]) {          // paralelos (rectas dentro del círculo)
            const yy = dyP * radius;
            const half = Math.sqrt(Math.max(radius * radius - yy * yy, 0));
            if (Math.abs(dy - yy) < stroke * 0.5 && Math.abs(dx) <= half) ink = 1;
          }

          if (ink > 0 && bgCov > 0) {
            R = mix(R, 255, ink); G = mix(G, 255, ink); B = mix(B, 255, ink);
          }
          r += R * bgCov; g += G * bgCov; b += B * bgCov; a += A * 255;
        }
      }
      const n = SS * SS, i = (y * size + x) * 4;
      const av = a / n;
      /* Desmultiplica para conservar el color en los bordes suavizados. */
      const k = av > 0 ? 255 / av : 0;
      img[i] = Math.min(255, Math.round((r / n) * k / 255 * 255));
      img[i + 1] = Math.min(255, Math.round((g / n) * k / 255 * 255));
      img[i + 2] = Math.min(255, Math.round((b / n) * k / 255 * 255));
      img[i + 3] = Math.round(av);
    }
  }
  return encodePNG(size, size, img);
}

/* ============================================================ WAV =========== */

/** Aviso sonoro: dos tonos suaves con caída exponencial. Nunca estridente. */
function buildChime() {
  const rate = 44100, seconds = 0.62;
  const total = Math.floor(rate * seconds);
  const data = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i++) {
    const t = i / rate;
    const env = Math.exp(-4.6 * t) * (1 - Math.exp(-90 * t));      // ataque rápido, caída suave
    const tone = t < 0.14
      ? Math.sin(2 * Math.PI * 880 * t) * 0.55
      : Math.sin(2 * Math.PI * 1318.5 * t) * 0.42 + Math.sin(2 * Math.PI * 659.25 * t) * 0.14;
    const s = Math.max(-1, Math.min(1, tone * env));
    data.writeInt16LE(Math.round(s * 20000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);          // PCM
  header.writeUInt16LE(1, 22);          // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/* =========================================================== FUENTES ======== */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap';

/** Descarga la tipografía y reescribe la hoja de estilos en local. */
async function buildFonts() {
  const res = await fetch(FONT_CSS, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error('No se pudo obtener la hoja de estilos de fuentes');
  const css = await res.text();

  /* Google Fonts antepone un comentario con el subconjunto a cada bloque:
   *     /* latin *​/  @font-face { ... }
   * Hay que capturarlos juntos, o el subconjunto se pierde. */
  const RE = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  const out = [];
  const written = new Set();
  let m;

  while ((m = RE.exec(css)) !== null) {
    const subset = m[1];
    const body = m[2];
    /* Solo los subconjuntos que la interfaz realmente necesita. Para árabe,
     * hindi, chino y japonés se usan las fuentes del propio sistema. */
    if (!['latin', 'latin-ext'].includes(subset)) continue;

    const family = (body.match(/font-family:\s*'([^']+)'/) || [])[1];
    const weight = (body.match(/font-weight:\s*(\d+)/) || [])[1] || '400';
    const style = (body.match(/font-style:\s*(\w+)/) || [])[1] || 'normal';
    const url = (body.match(/url\((https:[^)]+\.woff2)\)/) || [])[1];
    const range = (body.match(/unicode-range:\s*([^;]+);/) || [])[1];
    if (!url || !family) continue;

    const name = `${family.replace(/\s+/g, '')}-${weight}-${subset}.woff2`;
    if (!written.has(name)) {
      const bin = await fetch(url, { headers: { 'user-agent': UA } });
      if (!bin.ok) continue;
      await writeFile(p('assets', 'fonts', name), Buffer.from(await bin.arrayBuffer()));
      written.add(name);
    }
    out.push(
      `@font-face {\n` +
      `  font-family: '${family}';\n` +
      `  font-style: ${style};\n` +
      `  font-weight: ${weight};\n` +
      `  font-display: swap;\n` +
      `  src: url('../assets/fonts/${name}') format('woff2');\n` +
      (range ? `  unicode-range: ${range.trim()};\n` : '') +
      `}`,
    );
  }

  if (!out.length) throw new Error('La hoja de estilos no contenía bloques latin/latin-ext');

  const header =
    `/* ============================================================================\n` +
    ` * PANGEA · css/fonts.css  (GENERADO por tools/build-assets.mjs)\n` +
    ` * Tipografía auto-alojada: cero peticiones a terceros, cero rastreo y\n` +
    ` * aspecto idéntico sin conexión. Los idiomas no latinos (árabe, hindi,\n` +
    ` * chino, japonés) usan las fuentes del propio sistema, que ya las cubren.\n` +
    ` * ==========================================================================*/\n\n`;
  await writeFile(p('css', 'fonts.css'), header + out.join('\n\n') + '\n');
  return written.size;
}

/* ============================================================ MAIN ========== */

async function main() {
  for (const d of ['assets/icons', 'assets/img', 'assets/fonts', 'assets/audio', 'css']) {
    if (!existsSync(p(d))) await mkdir(p(d), { recursive: true });
  }

  const jobs = [];

  jobs.push((async () => {
    await writeFile(p('assets', 'icons', 'icon-192.png'), drawIcon(192));
    await writeFile(p('assets', 'icons', 'icon-512.png'), drawIcon(512));
    await writeFile(p('assets', 'icons', 'icon-maskable-512.png'), drawIcon(512, { maskable: true, rounded: false }));
    console.log('✓ iconos PNG generados (192, 512, maskable 512)');
  })());

  jobs.push((async () => {
    await writeFile(p('assets', 'audio', 'notificacion.wav'), buildChime());
    console.log('✓ aviso sonoro generado (notificacion.wav)');
  })());

  jobs.push((async () => {
    try {
      const n = await buildFonts();
      console.log(`✓ tipografía auto-alojada: ${n} archivos woff2 + css/fonts.css`);
    } catch (e) {
      console.warn('! fuentes no descargadas (se usará la reserva del sistema):', e.message);
    }
  })());

  await Promise.all(jobs);

  /* Informe de tamaños para vigilar el peso de la PWA. */
  let total = 0;
  for (const f of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'audio/notificacion.wav']) {
    const st = await readFile(p('assets', f)).catch(() => null);
    if (st) { total += st.length; console.log(`   assets/${f.padEnd(34)} ${(st.length / 1024).toFixed(1)} KB`); }
  }
  console.log(`   subtotal ${(total / 1024).toFixed(1)} KB`);
}

main().catch((e) => { console.error('Fallo al generar los recursos:', e); process.exitCode = 1; });
