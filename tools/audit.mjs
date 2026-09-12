/**
 * PANGEA · tools/audit.mjs
 * Auditoría estática del proyecto. Sin dependencias. Se ejecuta con:
 *
 *     node tools/audit.mjs
 *
 * Comprueba lo que se rompe en silencio y solo aparece en producción:
 *   1. Sintaxis de cada módulo ES
 *   2. Contrato de módulo (id, icon, accent, titleKey, subKey, mount)
 *   3. Que ningún módulo importe el núcleo de la aplicación (dependencia circular)
 *   4. Que cada clave de traducción usada exista en el diccionario canónico
 *   5. Que los 8 idiomas tengan exactamente el mismo conjunto de claves
 *   6. Que todo lo que el Service Worker precarga exista de verdad
 *   7. Que todo lo que index.html referencia exista de verdad
 *   8. Balance de etiquetas HTML y validez de los JSON
 *   9. Que los valores de i18n con marcadores coincidan entre idiomas ({n}, {km}…)
 *
 * Código de salida 1 si alguna comprobación falla: sirve en integración continua.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...x) => join(ROOT, ...x);

const results = [];
const ok = (name, detail = '') => results.push({ level: 'ok', name, detail });
const warn = (name, detail = '') => results.push({ level: 'warn', name, detail });
const fail = (name, detail = '') => results.push({ level: 'fail', name, detail });

const rel = (x) => relative(ROOT, x).replace(/\\/g, '/');

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

/* ------------------------------------------------------- 1. Sintaxis ES ---- */
async function checkSyntax(files) {
  const bad = [];
  for (const f of files.filter((x) => ['.js', '.mjs'].includes(extname(x)))) {
    try {
      await run(process.execPath, ['--check', f]);
    } catch (e) {
      bad.push(`${rel(f)}: ${String(e.stderr || e.message).split('\n').find((l) => /Error/.test(l)) || 'error de sintaxis'}`);
    }
  }
  bad.length ? fail('Sintaxis de todos los módulos', bad.join(' | ')) : ok('Sintaxis de todos los módulos', `${files.filter((x) => ['.js', '.mjs'].includes(extname(x))).length} archivos`);
}

/* --------------------------------------------------- 2. Contrato módulo ---- */
const REQUIRED_KEYS = ['id', 'icon', 'accent', 'titleKey', 'subKey', 'mount'];

async function checkModules() {
  const dir = p('js', 'modules');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.js'));
  const found = [];
  for (const f of files) {
    const src = await readFile(join(dir, f), 'utf8');
    /* Se inspecciona SOLO la cabecera del objeto exportado: buscar `id:` en
     * todo el archivo confundiría el identificador del módulo con cualquier
     * dato interno. La porción llega hasta la firma de `mount`. */
    const start = src.indexOf('export default');
    const head = start >= 0 ? src.slice(start, start + 2400) : src.slice(0, 600);
    const mountIdx = head.search(/\bmount\s*\(/);
    const scope = mountIdx >= 0 ? head.slice(0, mountIdx + 6) : head.slice(0, 600);
    const missing = REQUIRED_KEYS.filter((k) => !new RegExp(`\\b${k}\\s*:`).test(scope) && !new RegExp(`\\b${k}\\s*\\(`).test(scope));
    const idMatch = scope.match(/\bid:\s*'([^']+)'/);
    const id = idMatch ? idMatch[1] : null;
    const expected = f.replace(/\.js$/, '');
    if (missing.length) fail(`Contrato de ${f}`, `faltan: ${missing.join(', ')}`);
    else if (!id) fail(`Contrato de ${f}`, 'no se pudo leer el id del objeto exportado');
    else if (id !== expected && !(expected === 'nexus-id' && id === 'nexus')) {
      fail(`Contrato de ${f}`, `id '${id}' no coincide con el nombre de archivo '${expected}'`);
    } else found.push(id);
  }
  if (!found.length && files.length) fail('Contrato de módulos', 'ningún módulo válido');
  else ok('Contrato de módulos', `${found.length} módulos: ${found.join(', ')}`);

  /* El router los importa: deben existir todos. */
  const app = await readFile(p('js', 'app.js'), 'utf8');
  const imported = [...app.matchAll(/from '\.\/modules\/([^']+)\.js'/g)].map((m) => m[1]);
  const missing = imported.filter((m) => !files.includes(`${m}.js`));
  missing.length ? fail('Módulos importados por app.js', `no existen: ${missing.join(', ')}`) : ok('Módulos importados por app.js', `${imported.length} coinciden con el disco`);
  return found;
}

/* --------------------------------------------- 3. Sin dependencia circular -- */
async function checkCircular() {
  const files = await walk(p('js'));
  const bad = [];
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    if (/from\s+'\.\.\/app\.js'/.test(src) || /from\s+'\.\/app\.js'/.test(src)) {
      if (!f.endsWith('app.js')) bad.push(rel(f));
    }
  }
  bad.length
    ? fail('Dependencias circulares', `estos módulos importan app.js: ${bad.join(', ')}`)
    : ok('Dependencias circulares', 'ningún módulo importa el núcleo de la aplicación');
}

/* --------------------------------------------------- 4-5. Traducciones ----- */
async function checkI18n() {
  const canonical = await import(`file://${p('js', 'locales', 'es.js').replace(/\\/g, '/')}`);
  const keys = Object.keys(canonical.default);
  const keySet = new Set(keys);
  const langs = ['es', 'en', 'pt', 'fr', 'ar', 'hi', 'zh', 'ru'];

  for (const l of langs) {
    const mod = await import(`file://${p('js', 'locales', `${l}.js`).replace(/\\/g, '/')}`);
    const got = Object.keys(mod.default);
    const missing = keys.filter((k) => !(k in mod.default));
    const extra = got.filter((k) => !keySet.has(k));
    if (missing.length) fail(`Diccionario ${l}`, `faltan ${missing.length}: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}`);
    else if (extra.length) fail(`Diccionario ${l}`, `sobran ${extra.length}: ${extra.slice(0, 6).join(', ')}`);
    else ok(`Diccionario ${l}`, `${got.length} claves`);

    /* Los marcadores de interpolación deben sobrevivir a la traducción. */
    const phMismatch = [];
    for (const k of keys) {
      const a = (String(canonical.default[k]).match(/\{(\w+)\}/g) || []).sort().join(',');
      const b = (String(mod.default[k] || '').match(/\{(\w+)\}/g) || []).sort().join(',');
      if (a !== b) phMismatch.push(`${k} (${a || '—'} ≠ ${b || '—'})`);
    }
    if (phMismatch.length) fail(`Marcadores en ${l}`, `${phMismatch.length} discrepancias: ${phMismatch.slice(0, 4).join(', ')}`);
  }

  /* Claves usadas por el código que no existen en el diccionario canónico. */
  const files = (await walk(p('js'))).filter((f) => f.endsWith('.js') && !f.includes('locales'));
  const unknown = new Map();
  /* Las claves construidas dinámicamente (p. ej. `nav.` + colección) terminan
   * en punto: son prefijos, no claves, y se comprueban por separado. */
  const isDynamicPrefix = (k) => k.endsWith('.') || k === 'nav';
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) {
      if (!isDynamicPrefix(m[1]) && !keySet.has(m[1]) && !unknown.has(m[1])) unknown.set(m[1], rel(f));
    }
    for (const m of src.matchAll(/ctx\.t\(\s*'([a-zA-Z][\w.]*)'/g)) {
      if (!isDynamicPrefix(m[1]) && !keySet.has(m[1]) && !unknown.has(m[1])) unknown.set(m[1], rel(f));
    }
    /* Comprueba también las claves construidas con plantilla: `urgency.${x}` */
    for (const m of src.matchAll(/\bt\(\s*`([a-zA-Z][\w.]*?)\$\{/g)) {
      const prefix = m[1];
      if (![...keySet].some((k) => k.startsWith(prefix))) unknown.set(`${prefix}${'${…}'}`, rel(f));
    }
  }
  if (unknown.size) warn('Claves i18n usadas sin traducción', [...unknown].slice(0, 12).map(([k, f]) => `${k} (${f})`).join(', ') + (unknown.size > 12 ? ` … y ${unknown.size - 12} más` : ''));
  else ok('Claves i18n usadas', 'todas existen en el diccionario canónico');

  return { keys, keySet };
}

/* -------------------------------------------- 6. Precache del Service Worker */
async function checkPrecache() {
  const sw = await readFile(p('service-worker.js'), 'utf8');
  const urls = new Set();
  for (const m of sw.matchAll(/'(\.\/[^']+)'/g)) {
    if (m[1].includes('*')) continue;
    if (/\.(js|css|json|html|png|svg|wav|woff2|webmanifest)$/.test(m[1]) || m[1] === './') urls.add(m[1]);
  }
  const missing = [];
  for (const u of urls) {
    const clean = u.replace(/^\.\//, '');
    const target = clean === '' ? p('index.html') : p(clean);
    if (!existsSync(target)) missing.push(u);
  }
  /* Las fuentes se construyen con plantilla: se comprueba el directorio. */
  const fontDir = p('assets', 'fonts');
  const fonts = existsSync(fontDir) ? (await readdir(fontDir)).filter((f) => f.endsWith('.woff2')) : [];
  if (!fonts.length) warn('Tipografía auto-alojada', 'no hay woff2; se usará la reserva del sistema (ejecuta tools/build-assets.mjs)');

  missing.length
    ? fail('Precache del Service Worker', `${missing.length} recursos inexistentes: ${missing.join(', ')}`)
    : ok('Precache del Service Worker', `${urls.size} recursos verificados, ${fonts.length} fuentes`);

  /* La comprobación anterior es unidireccional: verifica que lo listado exista,
   * pero no que todo lo necesario esté listado. Un módulo nuevo podía pasar la
   * auditoría y desaparecer en la primera sesión sin conexión. */
  const runtime = [];
  const RUNTIME_EXT = /\.(?:js|mjs|css|json|html|webmanifest|png|jpe?g|svg|webp|ico|wav|mp3|ogg|woff2?)$/i;
  for (const dir of ['js', 'css', 'data', 'assets']) {
    const base = p(dir);
    if (!existsSync(base)) continue;
    for (const f of await walk(base)) {
      const relPath = './' + relative(ROOT, f).replace(/\\/g, '/');
      if (relPath.includes('/assets/fonts/')) continue;   // se añaden por plantilla
      if (!RUNTIME_EXT.test(relPath)) continue;           // la documentación no hace falta sin conexión
      runtime.push(relPath);
    }
  }
  const notPrecached = runtime.filter((r) => !urls.has(r));
  notPrecached.length
    ? fail('Cobertura del precache', `${notPrecached.length} archivos de ejecución NO están en la lista del Service Worker: ${notPrecached.slice(0, 8).join(', ')}${notPrecached.length > 8 ? ' …' : ''}`)
    : ok('Cobertura del precache', `los ${runtime.length} archivos de ejecución (js, css, data, assets) están precargados`);
}

/* ------------------------------------------------- 7. Referencias del HTML - */
async function checkHtml(html) {
  const missing = [];
  for (const m of html.matchAll(/(?:href|src)="(?!https?:|data:|#|mailto:)([^"]+)"/g)) {
    const target = p(m[1]);
    if (!existsSync(target)) missing.push(m[1]);
  }
  missing.length ? fail('Recursos referenciados por index.html', missing.join(', ')) : ok('Recursos referenciados por index.html', 'todos existen');

  /* Balance de etiquetas de los elementos que estructuran el documento.
   * Solo los elementos vacíos de HTML (que nunca llevan cierre) se excluyen;
   * los de SVG sí se cierran explícitamente, así que deben contarse. */
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '<script></script>').replace(/<style[\s\S]*?<\/style>/gi, '<style></style>');
  const stack = [];
  const unbalanced = [];
  for (const m of withoutComments.matchAll(/<\/?([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, tag, attrs, selfClose] = m;
    const name = tag.toLowerCase();
    if (m[0].startsWith('</')) {
      const top = stack.pop();
      if (top !== name) unbalanced.push(`</${name}> cierra a <${top || 'nada'}>`);
    } else if (!selfClose && !voidTags.has(name)) {
      stack.push(name);
    }
  }
  if (stack.length) unbalanced.push(`sin cerrar: ${stack.join(', ')}`);
  unbalanced.length ? fail('Balance de etiquetas HTML', unbalanced.slice(0, 5).join(' | ')) : ok('Balance de etiquetas HTML', 'correcto');

  /* Accesibilidad estructural mínima. */
  const a11y = [];
  if (!/<html[^>]+lang=/.test(html)) a11y.push('falta lang en <html>');
  if (!/<meta[^>]+name="viewport"/.test(html)) a11y.push('falta meta viewport');
  if (!/<main/.test(html)) a11y.push('falta <main>');
  if (!/skip-link/.test(html)) a11y.push('falta enlace de salto al contenido');
  a11y.length ? warn('Accesibilidad estructural', a11y.join(', ')) : ok('Accesibilidad estructural', 'lang, viewport, main, skip-link');
}

/* ------------------------------------------------------------ 8. JSON ------ */
async function checkJson(files) {
  const bad = [];
  let n = 0;
  for (const f of files.filter((x) => extname(x) === '.json')) {
    try { JSON.parse(await readFile(f, 'utf8')); n++; }
    catch (e) { bad.push(`${rel(f)}: ${e.message}`); }
  }
  bad.length ? fail('Validez de los JSON', bad.join(' | ')) : ok('Validez de los JSON', `${n} archivos`);
}

/* ------------------------------------------------- Análisis de la semilla -- */
async function checkSeeds() {
  try {
    const seed = JSON.parse(await readFile(p('data', 'conocimiento-semilla.json'), 'utf8'));
    const cols = seed.collections || {};
    const counts = Object.entries(cols).map(([k, v]) => `${k}:${v.length}`).join(' ');
    const problems = (cols.problems || []).length;
    const capacities = (cols.capacities || []).length;
    if (!problems || !capacities) warn('Datos semilla', 'sin problemas o capacidades: el emparejamiento no tendría nada que cruzar');
    else {
      /* ¿Hay al menos un par con la misma categoría? Es la condición mínima
         para que SYNAPSE produzca un emparejamiento relevante al abrir. */
      const pc = new Set((cols.problems || []).map((x) => x.category));
      const overlap = (cols.capacities || []).filter((c) => pc.has(c.category)).length;
      overlap
        ? ok('Datos semilla', `${counts} · ${overlap} capacidades comparten categoría con algún problema`)
        : fail('Datos semilla', 'ninguna capacidad comparte categoría con un problema');
    }
  } catch (e) { fail('Datos semilla', e.message); }
}

/* ------------------------------------------------------------- Ejecución --- */

async function main() {
  const t0 = Date.now();
  const files = await walk(ROOT);
  const html = await readFile(p('index.html'), 'utf8');

  await checkSyntax(files);
  await checkJson(files);
  flush('Estructura y sintaxis');

  await checkModules();
  await checkCircular();
  flush('Arquitectura de módulos');

  await checkI18n();
  flush('Internacionalización');

  await checkPrecache();
  flush('Entrega sin conexión');

  await checkHtml(html);
  flush('Documento y accesibilidad');

  await checkSeeds();
  flush('Contenido de arranque');

  /* Resumen */
  const oks = results.filter((r) => r.level === 'ok').length;
  const warns = results.filter((r) => r.level === 'warn');
  const fails = results.filter((r) => r.level === 'fail');

  console.log('');
  console.log('='.repeat(78));
  console.log(`  PANGEA · auditoría completada en ${Date.now() - t0} ms`);
  console.log(`  ${oks} correctas · ${warns.length} advertencias · ${fails.length} fallos`);
  console.log('='.repeat(78));
  if (warns.length) { console.log('\nADVERTENCIAS'); warns.forEach((w) => console.log(`  ~ ${w.name}: ${w.detail}`)); }
  if (fails.length) { console.log('\nFALLOS'); fails.forEach((f) => console.log(`  ✗ ${f.name}: ${f.detail}`)); }
  if (!fails.length && !warns.length) console.log('\n  Todo en orden. PANGEA está listo para servirse.\n');
  else if (!fails.length) console.log('');
  process.exitCode = fails.length ? 1 : 0;
}

/** Muestra por pantalla los resultados acumulados desde la última sección. */
let cursor = 0;
function flush(title) {
  console.log('');
  console.log(`── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
  for (const r of results.slice(cursor)) {
    const mark = r.level === 'ok' ? '✓' : r.level === 'warn' ? '~' : '✗';
    console.log(`  ${mark} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  }
  cursor = results.length;
}

main().catch((e) => { console.error('La auditoría falló:', e); process.exitCode = 1; });
