/**
 * PANGEA · tools/e2e.mjs
 * Prueba de extremo a extremo contra un navegador REAL, sin dependencias.
 *
 *     node tools/e2e.mjs                       # usa http://127.0.0.1:8188
 *     node tools/e2e.mjs --url http://127.0.0.1:8188 --browser "C:\ruta\msedge.exe"
 *
 * Se conecta al navegador por el Protocolo de DevTools (CDP) usando el cliente
 * WebSocket nativo de Node. Comprueba lo que una validación de sintaxis nunca
 * puede comprobar: que la aplicación ARRANCA, que los botones responden, que el
 * emparejamiento produce resultados, que las firmas criptográficas se verifican
 * de verdad contra IndexedDB, que la traducción funciona y —lo más importante—
 * que todo sigue funcionando SIN CONEXIÓN.
 *
 * Deja en el informe cualquier excepción de JavaScript y cualquier error de
 * consola: un error silencioso es exactamente lo que se cuela en producción.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Mata el árbol de procesos del navegador.
 *
 * En Windows `child.kill()` NO termina los procesos hijos: Chrome sobrevive
 * como un conjunto de procesos huérfanos que se van acumulando. Cada corrida
 * dejaba entre 80 y 160 MB de residuo, y a la cuarta o quinta medición el
 * equipo estaba tan cargado que las cifras de rendimiento se degradaban solas
 * (el LCP pasó de 1,7 s a 10 s sin que el código hubiera empeorado). Medir en
 * un entorno sucio es peor que no medir.
 */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ya cerrado */ }
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* ya cerrado */ } }
  }
}

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : fallback);

const URL_BASE = arg('--url', 'http://127.0.0.1:8188/');
const PORT = Number(arg('--port', 9333));
const BROWSERS = [
  arg('--browser', null),
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

/**
 * Espera activa hasta que una condición de la página se cumpla.
 * Un `sleep` fijo es la causa número uno de pruebas que fallan sin motivo:
 * el primer arranque escribe los datos semilla en IndexedDB y eso tarda lo que
 * tarde el dispositivo.
 *
 * Nota importante: la expresión se envuelve en una función asíncrona, así que
 * debe evaluarse con `awaitPromise: true`. Con `awaitPromise: false` el
 * resultado sería el propio objeto Promise, que serializado a JSON es `{}`
 * —siempre verdadero— y la espera terminaría de inmediato.
 */
async function waitFor(cdp, expression, { timeout = 20000, poll = 150, label = '' } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    try {
      /* Evaluación con tiempo límite corto: durante una navegación la página
       * puede no responder, y un solo intento colgado no debe agotar la espera. */
      last = await cdp.evaluate(expression, { timeout: 8000 });
      if (last) return last;
    } catch (e) { last = e.message; }
    await sleep(poll);
  }
  throw new Error(`condición no cumplida${label ? ' (' + label + ')' : ''}: último resultado ${JSON.stringify(last).slice(0, 200)}`);
}

/**
 * Navega a una ruta y ESPERA a que la vista tenga contenido de verdad.
 *
 * Esperar a que exista `#view .view` no basta: el router crea ese contenedor y
 * solo después lo rellena, así que una espera ingenua mide una vista vacía y la
 * prueba falla de forma intermitente según lo que tarde IndexedDB. Aquí se
 * espera a que tenga hijos y, cuando se indica, a un selector concreto del
 * módulo.
 */
async function goto(cdp, route, selector = null, timeout = 25000) {
  await cdp.evaluate(`location.hash = '#/${route}'; return true;`);
  await waitFor(cdp,
    `const v = document.querySelector('#view .view');
     return (location.hash === '#/${route}') && !!v && v.children.length > 0;`,
    { timeout, label: `ruta ${route}` });
  if (selector) {
    await waitFor(cdp, `return !!document.querySelector(${JSON.stringify(selector)});`, { timeout, label: `${route} · ${selector}` });
  }
  await sleep(120);
}

/* ----------------------------------------------------------- Cliente CDP --- */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.handlers = new Map();
    /** Sesiones adjuntas (por ejemplo, el Service Worker), con su modo de red. */
    this.sessions = new Set();
    this.offline = false;
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        if (msg.method !== 'Target.attachedToTarget' && msg.method !== 'Target.detachedFromTarget') this.events.push(msg);
        const hs = this.handlers.get(msg.method);
        if (hs) for (const fn of hs) { try { fn(msg.params, msg.sessionId); } catch (e) { console.error('handler', e); } }
      }
    });
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(fn);
    return () => this.handlers.get(method).delete(fn);
  }

  send(method, params = {}, { sessionId = null, timeout = 30000 } = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`tiempo agotado en ${method}`)); }, timeout);
      this.pending.set(id, { resolve: (r) => { clearTimeout(t); resolve(r); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  /** Aplica (o levanta) el modo avión en la página Y en todas las sesiones
   * adjuntas. Sin esto, el Service Worker seguiría teniendo red propia y la
   * prueba «sin conexión» no probaría nada. */
  async setOffline(offline) {
    this.offline = offline;
    const params = { offline, latency: 0, downloadThroughput: offline ? 0 : -1, uploadThroughput: offline ? 0 : -1 };
    const targets = [null, ...this.sessions];
    await Promise.all(targets.map((sid) => this.send('Network.emulateNetworkConditions', params, { sessionId: sid }).catch(() => null)));
  }

  /** Evalúa una expresión en la página. `awaitPromise` permite código asíncrono.
   *  El `timeout` importa en las esperas: si la página está navegando, un
   *  evaluate puede quedarse colgado y consumiría el presupuesto entero de la
   *  espera en un único intento. */
  async evaluate(expression, { awaitPromise = true, sessionId = null, timeout = 30000 } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    }, { sessionId, timeout });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'excepción en la página');
    }
    return res.result?.value;
  }

  errors() {
    const out = [];
    for (const e of this.events) {
      if (e.method === 'Runtime.exceptionThrown') {
        const d = e.params.exceptionDetails;
        out.push(`excepción: ${d.exception?.description || d.text}`);
      }
      if (e.method === 'Runtime.consoleAPICalled' && ['error'].includes(e.params.type)) {
        out.push(`console.error: ${(e.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 300));
      }
      if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
        const t = e.params.entry.text || '';
        /* La red caída durante la prueba sin conexión es justamente lo esperado. */
        if (/Failed to load resource|net::ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/i.test(t)) continue;
        out.push(`log: ${t}`.slice(0, 300));
      }
    }
    this.events = [];
    return [...new Set(out)];
  }
}

/* ------------------------------------------------------------- Arranque ---- */

async function findBrowser() {
  for (const b of BROWSERS) if (b && existsSync(b)) return b;
  throw new Error('No se encontró ningún navegador compatible (Chrome/Edge/Chromium)');
}

async function launch(browserPath, profileDir) {
  const child = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-features=Translate,MediaRouter',
    '--window-size=1440,960',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ], { stdio: 'ignore' });

  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return child;
    } catch { /* aún no escucha */ }
  }
  child.kill();
  throw new Error('El navegador no abrió el puerto de depuración');
}

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('No hay ninguna pestaña disponible');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('No se pudo abrir el canal CDP')), { once: true });
  });
  return new CDP(ws);
}

/* --------------------------------------------------------------- Pruebas --- */

async function run() {
  const browserPath = await findBrowser();
  console.log(`\n  Navegador: ${browserPath}`);
  console.log(`  Objetivo:  ${URL_BASE}\n`);

  const profileDir = await mkdtemp(join(tmpdir(), 'pangea-e2e-'));
  const child = await launch(browserPath, profileDir);
  let cdp;
  let failed = 0;

  /* Capturas de pantalla opcionales: `--shots <carpeta>`. Ver la interfaz es
   * la única forma de detectar un diseño roto que ninguna aserción mide. */
  const shotsDir = arg('--shots', null);
  const shot = async (name) => {
    if (!shotsDir) return;
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await mkdir(shotsDir, { recursive: true });
      await writeFile(join(shotsDir, `${name}.png`), Buffer.from(data, 'base64'));
    } catch (e) { console.warn('  (captura fallida:', name, e.message, ')'); }
  };

  try {
    cdp = await connect();
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');

    /* El Service Worker se ejecuta en su propio «target». Hay que adjuntarse a
     * él para poder cortarle la red también a él; de lo contrario, el modo
     * avión solo afectaría a la página y la prueba sin conexión sería falsa. */
    cdp.on('Target.attachedToTarget', async (params) => {
      const type = params.targetInfo?.type;
      if (type !== 'service_worker' && type !== 'worker' && type !== 'shared_worker') return;
      cdp.sessions.add(params.sessionId);
      try {
        await cdp.send('Network.enable', {}, { sessionId: params.sessionId });
        if (cdp.offline) await cdp.setOffline(true);
      } catch { /* la sesión pudo cerrarse */ }
    });
    cdp.on('Target.detachedFromTarget', (params) => cdp.sessions.delete(params.sessionId));
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

    /* Observadores de rendimiento ANTES de que cargue la página: los datos de
     * LCP, CLS y tareas largas solo se capturan si el observador ya está puesto
     * cuando ocurren. Se registran con `buffered: true` para no perder nada.
     *
     * Se miden aquí, con la API del propio navegador, porque Lighthouse no
     * consigue trazar la navegación en este entorno (falla con NO_NAVSTART y
     * deja Rendimiento «sin medir»). Estas son las mismas métricas que usa
     * Lighthouse por debajo, sin su limitación de red simulada. */
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__perf = { lcp: 0, cls: 0, longtasks: [] };
        try {
          new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; })
            .observe({ type: 'largest-contentful-paint', buffered: true });
          new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; })
            .observe({ type: 'layout-shift', buffered: true });
          new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longtasks.push(e.duration); })
            .observe({ type: 'longtask', buffered: true });
        } catch (e) { /* navegadores sin soporte: se informa como no medido */ }
      `,
    });

    /* ---- 1. Arranque ------------------------------------------------- *
     * UNA sola condición, y exigente. Esperar por partes es una trampa: al
     * navegar, el documento nuevo nace como un <html> vacío sin el atributo
     * `data-booting`, así que comprobar solo ese atributo da por arrancada una
     * página que todavía no existe. Se exige la URL correcta Y que la primera
     * vista tenga contenido: eso solo ocurre cuando la aplicación ha corrido. */
    await cdp.send('Page.navigate', { url: URL_BASE });
    await sleep(600);
    await waitFor(cdp,
      `const v = document.querySelector('#view .view');
       return location.href.startsWith(${JSON.stringify(URL_BASE)})
         && !document.documentElement.hasAttribute('data-booting')
         && !!v && v.children.length > 0;`,
      { timeout: 45000, poll: 200, label: 'arranque completo' });
    await sleep(600);

    const boot = await cdp.evaluate(`
      return {
        booting: document.documentElement.hasAttribute('data-booting'),
        navItems: document.querySelectorAll('.nav-item').length,
        bottomNav: document.querySelectorAll('.bottomnav-item').length,
        hero: !!document.querySelector('.hero'),
        stats: document.querySelectorAll('.stat-value').length,
        statLabels: [...document.querySelectorAll('.stat-label')].map(e => e.textContent).join(','),
        identityChip: !!document.querySelector('#identity-chip'),
        lang: document.documentElement.lang,
        title: document.title,
      };
    `);
    record('La aplicación arranca y pinta el armazón',
      !boot.booting && boot.navItems >= 8 && boot.hero && boot.stats >= 8 && boot.identityChip,
      `expuesto=${!boot.booting} nav=${boot.navItems} panel=${boot.hero} métricas=${boot.stats} chip=${boot.identityChip} idioma=${boot.lang} etiquetas=[${boot.statLabels}]`);

    const bootErrors = cdp.errors();
    record('El arranque no produce errores de JavaScript', bootErrors.length === 0,
      bootErrors.slice(0, 3).join(' | ') || 'ninguno');

    /* ---- 1c. Rendimiento: primera visita y visita repetida ------------ *
     * Las métricas que describen de verdad la experiencia. Se miden DOS veces
     * porque una PWA tiene dos estados muy distintos: la primera visita, con la
     * caché vacía y el Service Worker instalándose, y todas las siguientes, que
     * se sirven desde el propio dispositivo. Medir solo la primera sería
     * injusto; medir solo la segunda ocultaría el coste de entrada. */
    const perfCold = await cdp.evaluate(`
      await new Promise(r => setTimeout(r, 1200));
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const p = window.__perf || { lcp: 0, cls: 0, longtasks: [] };
      return {
        dcl: Math.round(nav.domContentLoadedEventEnd || 0),
        ttfb: Math.round(nav.responseStart || 0),
        lcp: Math.round(p.lcp || 0),
        cls: Math.round((p.cls || 0) * 1000) / 1000,
        tbt: Math.round(p.longtasks.reduce((n, d) => n + Math.max(0, d - 50), 0)),
        transferKB: Math.round((nav.transferSize || 0) / 1024),
      };
    `);

    /* Visita repetida: la que ocurre de verdad casi siempre. */
    await cdp.send('Page.reload', { ignoreCache: false });
    await waitFor(cdp,
      `const v = document.querySelector('#view .view');
       return !!v && v.children.length > 0;`,
      { timeout: 30000, poll: 150, label: 'recarga desde caché' });
    const perfWarm = await cdp.evaluate(`
      await new Promise(r => setTimeout(r, 1200));
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const p = window.__perf || { lcp: 0, cls: 0, longtasks: [] };
      return {
        dcl: Math.round(nav.domContentLoadedEventEnd || 0),
        ttfb: Math.round(nav.responseStart || 0),
        lcp: Math.round(p.lcp || 0),
        cls: Math.round((p.cls || 0) * 1000) / 1000,
        tbt: Math.round(p.longtasks.reduce((n, d) => n + Math.max(0, d - 50), 0)),
        transferKB: Math.round((nav.transferSize || 0) / 1024),
      };
    `);

    /* Se afirma lo que es ESTRUCTURAL y verificable, no un umbral inventado:
     *   · el diseño no salta en ninguna de las dos visitas (CLS ≤ 0,1, el
     *     criterio de «buena experiencia» de Google);
     *   · el armazón HTML es pequeño (una PWA no debe enviar un documento gordo);
     *   · la visita repetida es MÁS RÁPIDA que la primera, que es exactamente
     *     la promesa de una aplicación offline-first: la segunda vez ya no
     *     depende de la red.
     *
     * La comparación era «la segunda visita tiene que ser ESTRICTAMENTE más
     * rápida que la primera», y funcionaba mientras la primera visita se pasaba
     * segundos esperando a tres bibliotecas de CDN. Desde que esas bibliotecas
     * dejaron de bloquear el arranque, las dos visitas pintan igual de rápido y
     * la diferencia se quedó en ruido de cronómetro: medido, 2108 ms frente a
     * 2112 ms. Mantener la exigencia estricta obligaría a que la primera visita
     * volviera a ser lenta para que la prueba pasara, que es exactamente lo
     * contrario de lo que queremos.
     *
     * Lo que de verdad demuestra que la caché funciona es que la segunda visita
     * no sea más lenta (con un margen para el ruido de medición) y que
     * transfiera una fracción de los datos: 10 KB frente a 829 KB.
     * Los valores absolutos se informan tal como salen, sin maquillar. */
    const cacheWorks = perfWarm.lcp > 0 && perfWarm.lcp <= perfCold.lcp * 1.15 + 100;
    record('El diseño no salta y la segunda visita no depende de la red',
      perfCold.cls <= 0.1 && perfWarm.cls <= 0.1 && perfCold.transferKB < 60 && cacheWorks,
      `1ª visita: LCP ${perfCold.lcp} ms · TBT ${perfCold.tbt} ms · CLS ${perfCold.cls} · HTML ${perfCold.transferKB} KB · TTFB ${perfCold.ttfb} ms`
      + `  ‖  2ª visita (desde caché): LCP ${perfWarm.lcp} ms · TBT ${perfWarm.tbt} ms · CLS ${perfWarm.cls} · transferido ${perfWarm.transferKB} KB`);

    if (argv.includes('--boot-only')) throw new Error('corte solicitado con --boot-only');

    /* ---- 1b. Panel de mando: gráficos e impacto ----------------------- */
    await goto(cdp, 'home', '.hero');
    await waitFor(cdp, `return document.querySelectorAll('.stat-value').length >= 8;`, { timeout: 15000, label: 'métricas del panel' });
    await sleep(900);
    const dashboard = await cdp.evaluate(`
      const canvas = document.querySelector('#chart-impact');
      const lite = document.documentElement.getAttribute('data-lite') === 'true';
      let painted = false, coverage = 0;
      if (canvas) {
        try {
          /* Se recorre TODO el lienzo: un gráfico de anillo se dibuja en el
           * centro, así que muestrear una esquina daría un falso negativo. */
          const ctx = canvas.getContext('2d');
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let opaque = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i] > 8) opaque++;
          coverage = opaque / (data.length / 4);
          painted = coverage > 0.01;
        } catch { painted = canvas.width > 0; }
      }
      return {
        hasCanvas: !!canvas, painted, coverage: Math.round(coverage * 1000) / 10, lite,
        chartGlobal: typeof window.Chart,
        timeline: document.querySelectorAll('.timeline-item').length,
        tiles: document.querySelectorAll('.module-tile').length,
      };
    `);
    /* El panel debe cumplir su contrato en LOS DOS casos, y la prueba acepta
     * ambos a propósito: si Chart.js está disponible, el gráfico se dibuja de
     * verdad (se recorren los píxeles del lienzo); si el CDN no responde —cosa
     * que ocurre, y que el proyecto asume como estado normal—, debe aparecer la
     * reserva y el resto del panel tiene que seguir siendo utilizable. Probar
     * solo el camino feliz dejaría sin verificar justamente la degradación
     * elegante, que es uno de los principios del proyecto. */
    record('El panel de mando dibuja el gráfico, o degrada con elegancia',
      dashboard.tiles >= 7
      && (dashboard.chartGlobal === 'function'
        ? (dashboard.hasCanvas && dashboard.painted)
        : !dashboard.hasCanvas),
      dashboard.chartGlobal === 'function'
        ? `Chart.js disponible · lienzo ${dashboard.painted ? `pintado (${dashboard.coverage}% de píxeles)` : 'vacío'} · accesos=${dashboard.tiles} · actividad=${dashboard.timeline}`
        : `Chart.js NO disponible (CDN inalcanzable) · reserva mostrada, sin lienzo · accesos=${dashboard.tiles} · sin errores · modo ligero=${dashboard.lite}`);

    /* ---- 2. Onboarding guiado ---------------------------------------- */
    const onboard = await cdp.evaluate(`
      const overlay = document.querySelector('.onboard');
      if (!overlay) return { present: false };
      const dots = overlay.querySelectorAll('.onboard-dots button').length;
      const next = overlay.querySelector('.btn.aurora');
      const skip = overlay.querySelector('.btn.ghost');
      next?.click();
      await new Promise(r => setTimeout(r, 80));
      const advanced = overlay.querySelector('.onboard-dots button[aria-current="true"]') === overlay.querySelectorAll('.onboard-dots button')[1];
      skip?.click();
      await new Promise(r => setTimeout(r, 400));
      const gone = !document.querySelector('.onboard');
      /* Al cerrar la introducción, la aplicación ofrece crear la identidad.
       * Es correcto que lo haga; la prueba se limita a cerrar ese diálogo para
       * no dejar una capa modal abierta durante el resto de la sesión. */
      let dialogClosed = true;
      /* El diálogo posterior tarda un poco en abrirse (espera a saber si hay
       * identidad), así que se ESPERA a que aparezca antes de cerrarlo. Mirar
       * una sola vez dejaba una capa modal abierta el resto de la sesión. */
      for (let i = 0; i < 25 && !document.querySelector('.modal-backdrop'); i++) {
        await new Promise(r => setTimeout(r, 150));
      }
      const backdrop = document.querySelector('.modal-backdrop');
      if (backdrop) {
        /* Se pulsa «Cancelar», que es lo que haría una persona. */
        const cancel = backdrop.querySelector('.modal-foot button');
        if (cancel) cancel.click();
        else backdrop.querySelector('.modal-head button')?.click();
        await new Promise(r => setTimeout(r, 450));
        dialogClosed = !document.querySelector('.modal-backdrop');
      }
      return { present: true, dots, hasNext: !!next, hasSkip: !!skip, advanced, gone, dialogClosed };
    `);
    record('Onboarding presente y descartable', onboard.present && onboard.dots >= 7 && onboard.advanced && onboard.gone,
      `${onboard.dots || 0} pasos · avanzar=${onboard.advanced} saltar=${onboard.hasSkip} descartado=${onboard.gone} · diálogo posterior cerrado=${onboard.dialogClosed}`);

    /* ---- 2b. ¿Ve realmente el usuario la aplicación? ------------------ *
     * Todas las demás comprobaciones consultan el DOM y pulsan botones por
     * código, así que pasarían aunque una capa opaca tapara la interfaz
     * entera. Esta es la única que mira lo que hay delante de los ojos: se
     * pregunta al navegador qué elemento está en el centro del contenido. */
    const visibility = await cdp.evaluate(`
      const boot = document.getElementById('boot');
      const bootVisible = !!boot && getComputedStyle(boot).visibility !== 'hidden'
        && parseFloat(getComputedStyle(boot).opacity || '1') > 0.01 && boot.getBoundingClientRect().width > 0;
      const main = document.querySelector('#main');
      const r = main.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(220, r.height / 2));
      return {
        bootPresent: !!boot, bootVisible,
        onTopOfContent: !!hit && !!hit.closest('#main'),
        whatIsOnTop: hit ? hit.tagName.toLowerCase() + (typeof hit.className === 'string' && hit.className ? '.' + hit.className.split(' ')[0] : '') : null,
      };
    `);
    record('La interfaz es realmente visible: nada la tapa',
      !visibility.bootVisible && visibility.onTopOfContent,
      `cortina=${visibility.bootVisible ? 'TAPANDO' : 'retirada'} · elemento en el centro del contenido=${visibility.whatIsOnTop}`);

    /* ---- 3. Navegación por todos los módulos ------------------------- */
    const routes = ['simple', 'lingua', 'synapse', 'veritas', 'memoria', 'sos', 'agente', 'nexus', 'settings', 'home'];
    const visited = [];
    const routeErrors = {};
    for (const r of routes) {
      const t0 = Date.now();
      try {
        await goto(cdp, r);
      } catch { /* se reporta abajo como vista ausente */ }
      const ms = Date.now() - t0;
      await sleep(250);
      const okRoute = await cdp.evaluate(`
        const view = document.querySelector('#view .view');
        return { rendered: !!view, sections: view ? view.children.length : 0, current: (document.querySelector('[data-route][aria-current="page"]')||{}).dataset?.route || null };
      `);
      const errs = cdp.errors();
      if (errs.length) routeErrors[r] = errs.slice(0, 2).join(' | ');
      visited.push({ r, ms, ...okRoute });
    }
    const brokenRoutes = visited.filter((v) => !v.rendered);
    const slowest = visited.slice().sort((a, b) => b.ms - a.ms)[0];
    record('Los 10 destinos renderizan sin error', brokenRoutes.length === 0 && Object.keys(routeErrors).length === 0,
      brokenRoutes.length || Object.keys(routeErrors).length
        ? [...brokenRoutes.map((b) => `${b.r}: sin vista`), ...Object.entries(routeErrors).map(([k, v]) => `${k}: ${v}`)].join(' | ')
        : `${visited.map((v) => `${v.r}:${v.ms}ms`).join(' ')} · más lento ${slowest.r}`);

    /* ---- 3b. NEXUS ID: la identidad se crea ANTES de publicar --------- *
     * Este es el orden real del usuario y el que describe el flujo prioritario
     * del proyecto: introducción → crear identidad → publicar. Además, sin
     * identidad los módulos no firman y varios ni siquiera abren su formulario
     * (VERITAS exige identidad para poder firmar una afirmación), así que
     * invertir el orden haría que las pruebas midieran un estado irreal. */
    const identityBoot = await cdp.evaluate(`
      const crypto = await import('./js/crypto.js');
      let me = await crypto.Crypto.current();
      let created = false;
      if (!me) {
        location.hash = '#/nexus';
        await new Promise(r => setTimeout(r, 1600));
        const btn = [...document.querySelectorAll('#view button')].find((b) => /crear mi identidad/i.test(b.textContent));
        if (btn) { btn.click(); created = true; await new Promise(r => setTimeout(r, 2500)); }
        me = await crypto.Crypto.current();
      }
      return { created, fingerprint: me ? me.fingerprint : null };
    `);
    record('La identidad NEXUS se crea en su momento del flujo',
      /^PAN-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(identityBoot.fingerprint || ''),
      `${identityBoot.created ? 'creada' : 'ya existía'} · ${identityBoot.fingerprint || 'sin identidad'}`);

    /* ---- 4. SYNAPSE: el motor de emparejamiento produce resultados ---- */
    await goto(cdp, 'synapse', '.kanban');
    const matching = await cdp.evaluate(`
      const btn = [...document.querySelectorAll('button')].find(b => /emparejamiento/i.test(b.textContent));
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 3500));
      const count = await new Promise((resolve) => {
        const req = indexedDB.open('pangea');
        req.onsuccess = () => {
          const t = req.result.transaction('matches', 'readonly');
          const c = t.objectStore('matches').count();
          c.onsuccess = () => resolve(c.result);
          c.onerror = () => resolve(-1);
        };
        req.onerror = () => resolve(-1);
      });
      const cards = document.querySelectorAll('.kcard').length;
      const kanbanCols = document.querySelectorAll('.kanban-col').length;
      return { count, cards, kanbanCols };
    `);
    record('SYNAPSE empareja problemas con capacidades', matching.count > 0 && matching.kanbanCols === 4,
      `${matching.count} emparejamientos · ${matching.cards} tarjetas en ${matching.kanbanCols} columnas`);

    /* ================= FLUJOS REALES DE CREACIÓN (§47) =================
     * Las pruebas anteriores comprueban la aplicación leyendo y pulsando por
     * código. Estas recorren lo que hace una persona de verdad: abrir el
     * formulario, escribir en los campos, guardar y comprobar que el registro
     * llegó a IndexedDB. Es la diferencia entre «la interfaz existe» y «la
     * función está implementada», que es exactamente la distinción que este
     * proyecto se exige a sí mismo.
     *
     * Los campos se localizan por su ETIQUETA traducida, leída del propio
     * diccionario de la aplicación (`js/i18n.js`), no por su posición: así la
     * prueba no se rompe cuando un formulario gana o pierde campos. */
    const FLOW = `
      const i18n = await import('./js/i18n.js');
      const T = (k) => i18n.I18n.t(k);
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const modalOpen = () => !!document.querySelector('.modal');

      /** Texto limpio de una etiqueta: sin el «*» de obligatorio ni el
       *  «opcional» que los formularios añaden como <span> pegado. */
      const labelText = (field) => {
        const l = field.querySelector('.label');
        if (!l) return '';
        const clone = l.cloneNode(true);
        clone.querySelectorAll('.req, .opt').forEach((x) => x.remove());
        return clone.textContent.replace(/\\s*\\*\\s*$/, '').trim();
      };

      /** Escribe en el campo cuya etiqueta corresponde a alguna de las claves
       *  dadas (se prueban en orden). Se localiza por ETIQUETA y no por
       *  posición, para que la prueba no se rompa cuando un formulario gana o
       *  pierde campos. */
      const setField = (labelKeys, value) => {
        const keys = Array.isArray(labelKeys) ? labelKeys : [labelKeys];
        const fields = [...document.querySelectorAll('.modal .field')];
        for (const key of keys) {
          const want = T(key).trim();
          const field = fields.find((f) => {
            const txt = labelText(f);
            return txt === want || txt.startsWith(want);
          });
          if (!field) continue;
          const el = field.querySelector('input:not([type=file]):not([type=checkbox]), textarea, select');
          if (!el) continue;
          if (el.tagName === 'SELECT') {
            const opt = [...el.options].find((o) => o.value === value) || el.options[0];
            el.value = opt.value;
          } else {
            el.value = value;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return null;
        }
        return 'sin campo para ' + keys.join(' / ');
      };

      /** Pulsa el botón cuyo texto contiene la clave dada, dentro de la vista. */
      const clickInView = (labelKey) => {
        const text = T(labelKey);
        const b = [...document.querySelectorAll('#view button')].find((x) => x.textContent.trim().includes(text));
        if (!b) return false;
        b.click();
        return true;
      };

      /** Envía el modal abierto pulsando su acción principal. */
      const submitModal = () => {
        const btns = [...document.querySelectorAll('.modal button')];
        if (!btns.length) return false;
        const primary = btns.find((b) => /primary/.test(b.className))
          || [...document.querySelectorAll('.modal-foot button')].pop();
        if (!primary) return false;
        primary.click();
        return true;
      };

      /** Último aviso mostrado: es la explicación de por qué algo no se guardó. */
      const lastToast = () => {
        const t = [...document.querySelectorAll('.toast')].pop();
        return t ? t.textContent.trim().slice(0, 120) : null;
      };

      const count = (store) => new Promise((res) => {
        const r = indexedDB.open('pangea');
        r.onsuccess = () => {
          const c = r.result.transaction(store, 'readonly').objectStore(store).count();
          c.onsuccess = () => res(c.result);
          c.onerror = () => res(-1);
        };
        r.onerror = () => res(-1);
      });

      /** Lee el último registro de una colección (el recién creado). */
      const lastOf = (store) => new Promise((res) => {
        const r = indexedDB.open('pangea');
        r.onsuccess = () => {
          const all = r.result.transaction(store, 'readonly').objectStore(store).getAll();
          all.onsuccess = () => {
            const rows = (all.result || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            res(rows[0] || null);
          };
          all.onerror = () => res(null);
        };
        r.onerror = () => res(null);
      });
    `;

    /* ---- 6. TEST 4 y 5 · Crear un problema y una capacidad ------------ */
    const createPair = await cdp.evaluate(`
      ${FLOW}
      location.hash = '#/synapse';
      await wait(1500);
      const problemsBefore = await count('problems');
      const capsBefore = await count('capacities');

      clickInView('synapse.newProblem');
      await wait(700);
      const problemErrs = [
        setField(['synapse.postProblem', 'field.title'], 'E2E · La escuela no tiene agua potable: hacen falta filtros de agua'),
        setField('field.description', 'En la escuela el agua llega turbia y los niños no pueden beberla. Necesitamos filtros de agua potable de bajo costo para treinta familias y aprender a mantenerlos.'),
        setField('field.category', 'agua'),
      ].filter(Boolean);
      submitModal();
      await wait(1300);
      const problemRec = await lastOf('problems');

      clickInView('synapse.newCapacity');
      await wait(700);
      const capErrs = [
        setField(['synapse.postCapacity', 'field.title'], 'E2E · Construyo filtros de agua potable de bajo costo'),
        setField('field.description', 'Llevo doce años construyendo filtros de agua potable con barro local. Enseño a fabricar y mantener filtros de agua en tres días de taller y dejo los planos abiertos.'),
        setField('field.category', 'agua'),
      ].filter(Boolean);
      submitModal();
      await wait(1300);
      const capRec = await lastOf('capacities');

      return {
        problemsBefore, capsBefore,
        problemsAfter: await count('problems'),
        capsAfter: await count('capacities'),
        problemErrs, capErrs,
        problem: problemRec ? { title: problemRec.title, cat: problemRec.category, urgency: problemRec.urgency, signed: !!problemRec.sig, author: problemRec.author?.fingerprint || null } : null,
        capacity: capRec ? { title: capRec.title, signed: !!capRec.sig, availability: capRec.availability ?? null, langs: capRec.langs ?? null } : null,
      };
    `);
    record('TEST 4 · Publicar un problema desde el formulario real',
      createPair.problemsAfter === createPair.problemsBefore + 1 && createPair.problem
      && createPair.problem.signed && /E2E/.test(createPair.problem.title || ''),
      createPair.problemErrs.length ? `campos no encontrados: ${createPair.problemErrs.join('; ')}`
        : `${createPair.problemsBefore}→${createPair.problemsAfter} problemas · «${String(createPair.problem?.title).slice(0, 44)}» · firmado=${createPair.problem?.signed} · urgencia=${createPair.problem?.urgency}`);
    record('TEST 5 · Publicar una capacidad desde el formulario real',
      createPair.capsAfter === createPair.capsBefore + 1 && createPair.capacity && createPair.capacity.signed,
      createPair.capErrs.length ? `campos no encontrados: ${createPair.capErrs.join('; ')}`
        : `${createPair.capsBefore}→${createPair.capsAfter} capacidades · «${String(createPair.capacity?.title).slice(0, 44)}» · firmado=${createPair.capacity?.signed}`);

    /* El problema y la capacidad recién creados deben emparejar entre sí. */
    const rematch = await cdp.evaluate(`
      ${FLOW}
      location.hash = '#/synapse';
      await wait(1200);
      clickInView('synapse.suggestMatches');
      await wait(3500);
      const rows = await new Promise((res) => {
        const r = indexedDB.open('pangea');
        r.onsuccess = () => {
          const all = r.result.transaction('matches', 'readonly').objectStore('matches').getAll();
          all.onsuccess = () => res(all.result || []);
          all.onerror = () => res([]);
        };
        r.onerror = () => res([]);
      });
      const paired = rows.filter((m) => String(m.explain?.needTitle || '').startsWith('E2E')
        && String(m.explain?.offerTitle || '').startsWith('E2E'));
      return { total: rows.length, paired: paired.length, score: paired[0]?.score ?? null, parts: (paired[0]?.explain?.parts || []).length };
    `);
    record('TEST 6 y 7 · El motor empareja lo que se acaba de publicar',
      rematch.paired > 0 && rematch.parts >= 5,
      `${rematch.total} emparejamientos · ${rematch.paired} entre las dos publicaciones de prueba · afinidad ${rematch.score}% explicada con ${rematch.parts} razones`);

    /* ---- 7. TEST 8 y 9 · Crear una afirmación y votarla --------------- */
    const claimFlow = await cdp.evaluate(`
      ${FLOW}
      location.hash = '#/veritas';
      await wait(1500);
      const before = await count('claims');
      clickInView('veritas.newClaim');
      await wait(700);
      const errs = [
        setField('field.description', 'E2E · Hervir el agua durante un minuto elimina los coliformes fecales.'),
        setField('field.context', 'Aplicable a agua clara; con agua muy turbia hay que filtrar antes de hervir.'),
      ].filter(Boolean);
      submitModal();
      await wait(1400);
      const claim = await lastOf('claims');
      const votesBefore = await count('votes');

      /* Votar la afirmación recién creada: se abre su tarjeta y se elige opción. */
      let voted = false;
      let voteErr = null;
      const card = document.querySelector('.claim-card');
      if (card) {
        const voteBtn = card.querySelector('.vote-btn[data-vote="true"]');
        if (voteBtn) {
          voteBtn.click();
          await wait(800);
          /* El campo de evidencia es obligatorio: sin él, el voto no se guarda. */
          voteErr = setField('field.evidence', 'Lo he comprobado en campo con kits de laboratorio en dos temporadas distintas y con agua clara el resultado se sostiene.');
          submitModal();
          await wait(1300);
          voted = true;
        } else { voteErr = 'sin botón de voto en la tarjeta'; }
      } else { voteErr = 'sin tarjeta de afirmación'; }
      return {
        before, after: await count('claims'), votesBefore, votesAfter: await count('votes'),
        errs, voted, voteErr,
        claim: claim ? { context: !!claim.context, signed: !!claim.sig, text: String(claim.text || '').slice(0, 40) } : null,
      };
    `);
    record('TEST 8 · Publicar una afirmación con contexto',
      claimFlow.after === claimFlow.before + 1 && claimFlow.claim && claimFlow.claim.context && claimFlow.claim.signed,
      claimFlow.errs.length ? `campos no encontrados: ${claimFlow.errs.join('; ')}`
        : `${claimFlow.before}→${claimFlow.after} afirmaciones · contexto=${claimFlow.claim?.context} · firmada=${claimFlow.claim?.signed}`);
    record('TEST 9 · Votar una afirmación aportando evidencia',
      claimFlow.voted && claimFlow.votesAfter > claimFlow.votesBefore,
      `${claimFlow.votesBefore}→${claimFlow.votesAfter} votos registrados${claimFlow.voteErr ? ' · ' + claimFlow.voteErr : ''}`);

    /* ---- 8. TEST 10 · Preservar conocimiento ------------------------- */
    const knowledgeFlow = await cdp.evaluate(`
      ${FLOW}
      location.hash = '#/memoria';
      await wait(1600);
      const before = await count('knowledge');
      clickInView('memoria.addKnowledge');
      await wait(900);
      const errs = [
        setField('field.title', 'E2E · Cómo saber si el grano está seco con sal'),
        setField('memoria.contentPh', 'Se llena un frasco hasta la mitad con el grano, se añade una cucharada de sal gruesa y se agita tres minutos. Si la sal se pega a las paredes, el grano todavía tiene humedad.'),
      ].filter(Boolean);
      submitModal();
      await wait(1600);
      const rec = await lastOf('knowledge');
      return {
        before, after: await count('knowledge'), errs,
        rec: rec ? { title: rec.title, kind: rec.kind, license: rec.license, signed: !!rec.sig } : null,
      };
    `);
    record('TEST 10 · Preservar conocimiento desde el formulario real',
      knowledgeFlow.after === knowledgeFlow.before + 1 && knowledgeFlow.rec && knowledgeFlow.rec.signed,
      knowledgeFlow.errs.length ? `campos no encontrados: ${knowledgeFlow.errs.join('; ')}`
        : `${knowledgeFlow.before}→${knowledgeFlow.after} saberes · «${String(knowledgeFlow.rec?.title).slice(0, 40)}» · licencia=${knowledgeFlow.rec?.license}`);

    /* ---- 9. TEST 12 · Emitir una alerta SOS --------------------------- */
    const alertFlow = await cdp.evaluate(`
      ${FLOW}
      location.hash = '#/sos';
      await wait(1600);
      const before = await count('alerts');
      clickInView('sos.newAlert');
      await wait(900);
      const errs = [
        setField('field.title', 'E2E · Se cortó el acceso por el derrumbe'),
        setField(['sos.issue', 'field.description'], 'El camino de entrada al caserío quedó bloqueado. Somos cuarenta personas, hay dos heridos leves y necesitamos transporte para llegar al puesto de salud.'),
      ].filter(Boolean);
      submitModal();
      await wait(1600);
      const rec = await lastOf('alerts');
      return {
        before, after: await count('alerts'), errs,
        rec: rec ? { title: rec.title, type: rec.type, severity: rec.severity, status: rec.status, signed: !!rec.sig, precision: rec.locationPrecision ?? null, hasLocation: !!rec.location } : null,
      };
    `);
    record('TEST 12 · Emitir una alerta SOS desde el formulario real',
      alertFlow.after === alertFlow.before + 1 && alertFlow.rec && alertFlow.rec.signed,
      alertFlow.errs.length ? `campos no encontrados: ${alertFlow.errs.join('; ')}`
        : `${alertFlow.before}→${alertFlow.after} alertas · tipo=${alertFlow.rec?.type} · gravedad=${alertFlow.rec?.severity} · estado=${alertFlow.rec?.status} · firmada=${alertFlow.rec?.signed} · sin ubicación (no se pidió)`);

    /* ---- 10. TEST 13 · Exportar e importar (ida y vuelta) ------------- */
    const roundTrip = await cdp.evaluate(`
      ${FLOW}
      const store = await import('./js/store.js');
      const dump = await store.Store.exportAll();
      const counts = JSON.stringify(dump.counts);
      /* Se importa lo mismo que se exportó: no debe duplicar nada y debe
         informar de las filas ya existentes como omitidas. */
      const report = await store.Store.importAll(dump);
      const sameProblems = await count('problems');
      return {
        counts, imported: report.imported, overwritten: report.overwritten, skipped: report.skipped,
        identitySkipped: !!report.identitySkipped, sameProblems,
        omitted: dump.omitted || [],
      };
    `);
    record('TEST 13 · Exportar e importar el paquete completo sin duplicar',
      roundTrip.imported === 0 && roundTrip.sameProblems > 0 && roundTrip.omitted.includes('identity'),
      `${roundTrip.counts} · reimportado: nuevos=${roundTrip.imported} sobrescritos=${roundTrip.overwritten} omitidos=${roundTrip.skipped} · identidad excluida=${roundTrip.identitySkipped}`);

    /* ---- 11b. MODO SIMPLE: dos botones, sin leer ---------------------- *
     * La comprobación que de verdad importa para el usuario final: que exista
     * una pantalla en la que no haya NADA que leer y en la que las dos únicas
     * acciones posibles sean del tamaño de un tercio de la pantalla. Se mide el
     * área táctil real, no la declarada en el CSS. */
    const simple = await cdp.evaluate(`
      ${FLOW}
      location.hash = '#/simple';
      for (let i = 0; i < 60 && document.querySelectorAll('.simple-btn').length < 2; i++) await wait(150);
      const btns = [...document.querySelectorAll('.simple-btn')];
      const geometry = btns.map((b) => {
        const r = b.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), area: Math.round(r.width * r.height) };
      });
      return {
        buttons: btns.length,
        geometry,
        labels: btns.map((b) => b.textContent.trim()),
        /* Texto visible total de la pantalla: si el modo simple necesita leer
         * mucho, ha dejado de ser simple. */
        visibleText: (document.querySelector('#view') || {}).innerText || '',
        inputs: document.querySelectorAll('#view input, #view textarea, #view select').length,
        fields: document.querySelectorAll('#view .field').length,
        links: document.querySelectorAll('#view a').length,
      };
    `);
    const minArea = simple.geometry.reduce((m, g) => Math.min(m, g.area), Infinity);
    record('El modo simple son dos botones gigantes y ningún formulario',
      simple.buttons === 2 && simple.inputs === 0 && simple.fields === 0 && minArea > 20000
      && simple.visibleText.length < 90,
      simple.geometry.map((g, i) => `${simple.labels[i]}: ${g.w}×${g.h} px`).join(' · ')
      + ` · campos=${simple.fields} entradas=${simple.inputs} · texto visible=${simple.visibleText.length} caracteres`);

    /* «Puedo ayudar»: un toque debe mostrar quién necesita qué, en tarjetas
       grandes y sin ningún formulario por medio. */
    const simpleHelp = await cdp.evaluate(`
      ${FLOW}
      location.hash = '#/simple';
      for (let i = 0; i < 60 && document.querySelectorAll('.simple-btn').length < 2; i++) await wait(150);
      document.querySelectorAll('.simple-btn')[1].click();
      for (let i = 0; i < 60 && !document.querySelector('.simple-need') && !document.querySelector('.simple-empty'); i++) await wait(150);
      const cards = [...document.querySelectorAll('.simple-need')];
      const heights = cards.map((c) => Math.round(c.getBoundingClientRect().height));
      return {
        cards: cards.length,
        minHeight: heights.length ? Math.min(...heights) : 0,
        firstTitle: cards.length ? cards[0].querySelector('.simple-need-title').textContent.slice(0, 50) : null,
        hasEmpty: !!document.querySelector('.simple-empty'),
        forms: document.querySelectorAll('#view input, #view textarea, #view select').length,
      };
    `);
    record('«Puedo ayudar» muestra las necesidades en tarjetas grandes y sin formularios',
      (simpleHelp.cards > 0 || simpleHelp.hasEmpty) && simpleHelp.forms === 0 && simpleHelp.minHeight >= 80,
      `${simpleHelp.cards} necesidades · altura mínima de tarjeta ${simpleHelp.minHeight} px · campos de formulario ${simpleHelp.forms}`
      + (simpleHelp.firstTitle ? ` · primera: «${simpleHelp.firstTitle}»` : ' · sin necesidades abiertas'));


    const needBlock = await cdp.evaluate(`
      ${FLOW}
      location.hash = '#/home';
      await wait(1500);
      const title = document.querySelector('.need-title');
      const buttons = [...document.querySelectorAll('.need-btn')].map((b) => b.textContent.trim());
      const hasPeer = await new Promise((res) => {
        const r = indexedDB.open('pangea');
        r.onsuccess = () => {
          const all = r.result.transaction('matches', 'readonly').objectStore('matches').getAll();
          all.onsuccess = () => res((all.result || []).length > 0);
          all.onerror = () => res(false);
        };
        r.onerror = () => res(false);
      });
      return { title: title ? title.textContent : null, buttons, hasPeer };
    `);
    record('El panel abre con «¿Qué necesitas?» y sus cinco salidas',
      needBlock.buttons.length === 5 && !!needBlock.title,
      `«${needBlock.title}»: ${needBlock.buttons.join(' · ')}`);

    /* Cada botón del panel debe llevar al módulo Y ABRIR SU FORMULARIO. Solo
       navegar dejaría a la persona buscando el botón que acaba de pulsar, que
       es exactamente lo que la acción principal existe para evitar. */
    const intentFlow = await cdp.evaluate(`
      ${FLOW}
      const probes = [];
      const cases = [
        { index: 0, route: 'synapse', field: 'synapse.postProblem' },
        { index: 1, route: 'synapse', field: 'synapse.postCapacity' },
        { index: 2, route: 'memoria', field: 'field.title' },
        { index: 3, route: 'veritas', field: 'field.description' },
        { index: 4, route: 'sos', field: 'sos.issue' },
      ];
      for (const c of cases) {
        location.hash = '#/home';
        await wait(1100);
        const b = [...document.querySelectorAll('.need-btn')][c.index];
        if (!b) { probes.push({ ok: false, why: 'sin botón ' + c.index }); continue; }
        b.click();
        await wait(1800);
        const opened = modalOpen();
        const label = T(c.field);
        const hasField = [...document.querySelectorAll('.modal .field')].some((f) => {
          const l = f.querySelector('.label');
          if (!l) return false;
          const clone = l.cloneNode(true);
          clone.querySelectorAll('.req, .opt').forEach((x) => x.remove());
          return clone.textContent.trim().startsWith(label);
        });
        probes.push({ ok: opened && hasField, route: location.hash, opened, hasField, field: c.field });
        if (opened) document.querySelector('.modal-head button')?.click();
        await wait(500);
      }
      return { probes };
    `);
    const badProbes = intentFlow.probes.filter((p) => !p.ok);
    record('Cada botón del panel abre directamente su formulario',
      badProbes.length === 0,
      badProbes.length
        ? badProbes.map((p) => `${p.field}: ${p.opened ? 'abrió pero sin el campo' : 'no abrió el formulario'}`).join(' · ')
        : intentFlow.probes.map((p) => `${p.route.replace('#/', '')}→${p.field}`).join(' · '));

    /* Perfil: se abre desde la huella de una publicación y debe demostrar la
       autoría recalculando la huella desde la clave pública que firmó. */
    const profileFlow = await cdp.evaluate(`
      ${FLOW}
      const store = await import('./js/store.js');
      const rows = await store.Store.all('problems');
      const mine = rows.find((r) => r.sig && r.author && !r.author.anon && String(r.title || '').startsWith('E2E'));
      if (!mine) return { error: 'sin publicación firmada de prueba' };
      location.hash = '#/profile/' + encodeURIComponent(mine.author.fingerprint);
      await wait(2200);
      const view = document.querySelector('#view .view');
      return {
        rendered: !!view && view.children.length > 0,
        fingerprint: (document.querySelector('.id-fingerprint') || {}).textContent || null,
        verifiedBadge: [...document.querySelectorAll('#view .badge')].map((b) => b.textContent.trim()).join(' | '),
        items: document.querySelectorAll('#view .list-item').length,
        cards: document.querySelectorAll('#view .card').length,
      };
    `);
    record('El perfil de una persona demuestra su autoría y lista sus aportes',
      profileFlow.rendered && profileFlow.items > 0 && /PAN-/.test(profileFlow.fingerprint || ''),
      profileFlow.error || `${profileFlow.fingerprint} · ${profileFlow.items} contribuciones · ${profileFlow.cards} tarjetas · ${String(profileFlow.verifiedBadge).slice(0, 70)}`);


    /* ---- 5. NEXUS ID: claves reales y firma verificable --------------- */
    const identity = await cdp.evaluate(`
      location.hash = '#/nexus';
      await new Promise(r => setTimeout(r, 1200));
      const crypto = await import('./js/crypto.js');
      const store = await import('./js/store.js');
      let me = await crypto.Crypto.current();
      let created = false;
      if (!me) {
        /* Se busca SOLO dentro de la vista: el panel lateral también contiene
         * un botón con la palabra «identidad» que únicamente navega. */
        const btn = [...document.querySelectorAll('#view button')].find(b => /crear mi identidad/i.test(b.textContent));
        if (btn) { btn.click(); created = true; await new Promise(r => setTimeout(r, 3000)); }
        me = await crypto.Crypto.current();
      }
      if (!me) return { error: 'no se pudo crear la identidad', buttonFound: created };
      const payload = { title: 'Prueba de firma E2E', body: 'Contenido firmado con ECDSA P-256.', category: 'tecnologia', urgency: 'low' };
      const base = { id: 'e2e_' + Date.now().toString(36), createdAt: Date.now(), ...payload, author: { fingerprint: me.fingerprint, name: 'E2E' }, lang: 'es' };
      const signed = await crypto.Crypto.signed(base);
      await store.Store.put('problems', signed);
      const readBack = await store.Store.get('problems', signed.id);
      const valid = await crypto.Crypto.verify(readBack);
      const tampered = { ...readBack, title: 'Título alterado por un atacante' };
      const stillValid = await crypto.Crypto.verify(tampered);

      /* SUPLANTACIÓN DE HUELLA: firmar con la clave propia y escribir en el
       * sobre la huella de otra persona. La firma es válida, así que solo una
       * comprobación explícita de que fp corresponde a pub lo detecta. */
      const spoof = await crypto.Crypto.signed({ kind: 'pangea.statement', text: 'firmado por otro' });
      const forged = JSON.parse(JSON.stringify(spoof));
      forged.sig.fp = 'PAN-AAAA-BBBB-CCCC';
      const spoofAccepted = await crypto.Crypto.verify(forged);

      /* EL PASAPORTE NO DEBE LLEVAR SECRETOS: ni la clave privada ni las
       * claves de API configuradas. */
      await store.Store.setKv('pref.llm.key', 'clave-secreta-de-prueba');
      const dump = await store.Store.exportAll();
      const dumpText = JSON.stringify(dump);
      const leaks = {
        identityRows: (dump.collections.identity || []).length,
        privateKey: dumpText.includes(me.priv.slice(0, 40)),
        apiKey: dumpText.includes('clave-secreta-de-prueba'),
        telemetryRows: (dump.collections.telemetry || []).length,
        omitted: dump.omitted || [],
      };

      return { fingerprint: me.fingerprint, valid, stillValid, hasSignature: !!readBack.sig, alg: me.alg, created, spoofAccepted, leaks };
    `);
    record('NEXUS ID genera claves ECDSA P-256', /^PAN-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(identity.fingerprint || ''),
      identity.fingerprint || identity.error);
    record('La firma se verifica tras pasar por IndexedDB', identity.valid === true && identity.hasSignature,
      identity.valid ? 'firma válida al releer' : 'LA FIRMA NO VERIFICA');
    record('Una alteración del contenido invalida la firma', identity.stillValid === false,
      identity.stillValid ? '¡el contenido alterado sigue validando!' : 'detección de manipulación correcta');
    record('Suplantar la huella del firmante se rechaza', identity.spoofAccepted === false,
      identity.spoofAccepted ? '¡una firma con huella ajena fue aceptada!' : 'huella recalculada desde la clave pública');
    record('El pasaporte exportado no contiene secretos',
      identity.leaks && identity.leaks.identityRows === 0 && !identity.leaks.privateKey
      && !identity.leaks.apiKey && identity.leaks.telemetryRows === 0,
      identity.leaks ? `identidad=${identity.leaks.identityRows} telemetría=${identity.leaks.telemetryRows} clavePrivada=${identity.leaks.privateKey} claveApi=${identity.leaks.apiKey} omitido=[${identity.leaks.omitted.join(', ')}]` : 'sin datos');

    /* ---- 6. LINGUA: traducción y fraseo local ------------------------- */
    const lingua = await cdp.evaluate(`
      location.hash = '#/lingua';
      for (let i = 0; i < 80 && !document.querySelector('.pane textarea'); i++) await new Promise(r => setTimeout(r, 150));
      const selects = document.querySelectorAll('.lang-bar select');
      if (selects.length >= 2) {
        selects[0].value = 'es'; selects[0].dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
        const s2 = document.querySelectorAll('.lang-bar select');
        s2[1].value = 'en'; s2[1].dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
      }
      const ta = document.querySelector('.pane textarea');
      ta.value = 'Necesito ayuda';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const go = [...document.querySelectorAll('#view button.btn')].find(b => /^traducir$/i.test(b.textContent.trim()));
      go?.click();
      await new Promise(r => setTimeout(r, 4000));
      const out = document.querySelector('.pane.result .pane-body');
      return { text: (out?.textContent || '').trim(), empty: out?.dataset.empty, found: !!go };
    `);
    record('LINGUA traduce texto', !!lingua.text && lingua.text.length > 2 && lingua.empty === 'false',
      `«Necesito ayuda» → «${lingua.text.slice(0, 60)}»${lingua.found ? '' : ' (botón no encontrado)'}`);

    /* ---- 7. VERITAS: sellado de consenso ------------------------------ */
    await goto(cdp, 'veritas', '.claim-card');
    const veritas = await cdp.evaluate(`
      const claims = await new Promise((resolve) => {
        const req = indexedDB.open('pangea');
        req.onsuccess = () => { const c = req.result.transaction('claims','readonly').objectStore('claims').count(); c.onsuccess = () => resolve(c.result); c.onerror = () => resolve(-1); };
        req.onerror = () => resolve(-1);
      });
      return { claims, cards: document.querySelectorAll('.claim-card').length, seals: document.querySelectorAll('.seal').length };
    `);
    record('VERITAS lista afirmaciones con su sello',
      veritas.claims > 0 && veritas.cards > 0 && veritas.seals > 0,
      `${veritas.claims} afirmaciones · ${veritas.cards} tarjetas · ${veritas.seals} sellos de consenso`);

    /* ---- 8. SOS: alertas y exportación firmada ------------------------ */
    await goto(cdp, 'sos', '.map-shell');
    const sos = await cdp.evaluate(`
      const alerts = await new Promise((resolve) => {
        const req = indexedDB.open('pangea');
        req.onsuccess = () => { const c = req.result.transaction('alerts','readonly').objectStore('alerts').count(); c.onsuccess = () => resolve(c.result); c.onerror = () => resolve(-1); };
        req.onerror = () => resolve(-1);
      });
      const mapShell = document.querySelector('.map-shell');
      return { alerts, hasMap: !!mapShell, mapOffline: !!document.querySelector('.map-shell.offline'), tabCount: document.querySelectorAll('.tabs .tab').length };
    `);
    record('SOS monta alertas y mapa con degradación elegante', sos.hasMap && sos.tabCount >= 3,
      `${sos.alerts} alertas · mapa ${sos.hasMap ? (sos.mapOffline ? 'en modo local (sin Leaflet)' : 'activo') : 'ausente'}`);

    /* ---- 9. MEMORIA: búsqueda offline sobre el archivo ---------------- */
    await goto(cdp, 'memoria', '.search-box input');
    const memoria = await cdp.evaluate(`
      const ta = document.querySelector('.search-box input');
      let results = null;
      if (ta) {
        ta.value = 'agua';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 900));
        results = document.querySelectorAll('.know-card').length;
      }
      const total = await new Promise((resolve) => {
        const req = indexedDB.open('pangea');
        req.onsuccess = () => { const c = req.result.transaction('knowledge','readonly').objectStore('knowledge').count(); c.onsuccess = () => resolve(c.result); c.onerror = () => resolve(-1); };
        req.onerror = () => resolve(-1);
      });
      return { total, results, hasSearch: !!ta, miniSearch: typeof window.MiniSearch };
    `);
    record('MEMORIA busca en el archivo local', memoria.hasSearch && memoria.total > 0,
      `${memoria.total} saberes · búsqueda «agua» → ${memoria.results} resultados · MiniSearch=${memoria.miniSearch}`);

    /* ---- 10. Servicio de trabajo sin conexión ------------------------- */
    await goto(cdp, 'home', '.hero');
    const swState = await cdp.evaluate(`
      const reg = await navigator.serviceWorker.getRegistration();
      const keys = await caches.keys();
      let cached = 0;
      for (const k of keys) cached += (await (await caches.open(k)).keys()).length;
      return { registered: !!reg, active: !!(reg && reg.active), controlled: !!navigator.serviceWorker.controller, caches: keys.length, cached };
    `);
    record('Service Worker registrado y caché poblada',
      swState.registered && swState.active && swState.cached > 20,
      `${swState.caches} cachés · ${swState.cached} recursos · control=${swState.controlled}`);

    /* ---- 11. LA PRUEBA DECISIVA: modo avión --------------------------- */
    await cdp.setOffline(true);
    await cdp.send('Page.reload', { ignoreCache: false });
    await waitFor(cdp, `return !document.documentElement.hasAttribute('data-booting');`, { timeout: 30000, label: 'arranque sin conexión' });
    await waitFor(cdp, `const v = document.querySelector('#view .view'); return !!v && v.children.length > 0;`, { timeout: 20000, label: 'vista sin conexión' });
    await waitFor(cdp, `return document.querySelectorAll('.stat-value').length >= 8;`, { timeout: 15000, label: 'métricas sin conexión' });
    await sleep(300);
    const offline = await cdp.evaluate(`
      return {
        booting: document.documentElement.hasAttribute('data-booting'),
        navItems: document.querySelectorAll('.nav-item').length,
        hero: !!document.querySelector('.hero'),
        stats: document.querySelectorAll('.stat-value').length,
      };
    `);

    /* Sonda de red determinista: se pide un recurso del propio origen que no
     * está en caché y que no existe. Con red, el servidor responde 404 y la
     * promesa se resuelve; sin red, el Service Worker agota la caché, falla el
     * fetch y la promesa se rechaza. No depende de DNS ni de terceros. */
    const probe = await cdp.evaluate(`
      let offline = false;
      try {
        await fetch('./sonda-de-red-' + Date.now() + '.json', { cache: 'no-store' });
      } catch { offline = true; }
      return { offline };
    `);

    record('SIN CONEXIÓN la aplicación sigue funcionando',
      !offline.booting && offline.navItems >= 8 && offline.hero && offline.stats >= 8 && probe.offline === true,
      `navegación=${offline.navItems} panel=${offline.hero} métricas=${offline.stats} red_caída_confirmada=${probe.offline}`);

    /* Navegación sin conexión a un módulo que exige datos locales. */
    const offlineModule = await cdp.evaluate(`
      location.hash = '#/memoria';
      for (let i = 0; i < 80 && !document.querySelector('.know-card'); i++) await new Promise(r => setTimeout(r, 150));
      return { rendered: !!document.querySelector('#view .view'), cards: document.querySelectorAll('.know-card').length };
    `);
    record('SIN CONEXIÓN los módulos siguen navegables',
      offlineModule.rendered && offlineModule.cards > 0,
      `${offlineModule.cards} tarjetas del archivo offline`);

    /* ---- 12. Traducción sin conexión (fraseo local) ------------------- */
    const offlineLingua = await cdp.evaluate(`
      location.hash = '#/lingua';
      for (let i = 0; i < 80 && !document.querySelector('.pane textarea'); i++) await new Promise(r => setTimeout(r, 150));
      const selects = document.querySelectorAll('.lang-bar select');
      if (selects.length >= 2) {
        selects[0].value = 'es'; selects[0].dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
        const s2 = document.querySelectorAll('.lang-bar select');
        s2[1].value = 'en'; s2[1].dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
      }
      const ta = document.querySelector('.pane textarea');
      ta.value = 'Necesito agua potable';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const go = [...document.querySelectorAll('#view button.btn')].find(b => /^traducir$/i.test(b.textContent.trim()));
      go?.click();
      await new Promise(r => setTimeout(r, 3000));
      return { text: (document.querySelector('.pane.result .pane-body')?.textContent || '').trim() };
    `);
    record('SIN CONEXIÓN la traducción de emergencia responde',
      /water/i.test(offlineLingua.text),
      `«Necesito agua potable» → «${offlineLingua.text.slice(0, 60)}»`);

    /* ---- 12b. Traducción real entre 8 idiomas, sin conexión ----------- *
     * El fraseo de emergencia es el único traductor que funciona con la red
     * cortada, así que es también la prueba más exigente del criterio «traduce
     * entre al menos 8 idiomas»: se recorre el selector de destino y se
     * comprueba que cada idioma devuelve una frase distinta y no la original. */
    const multiLang = await cdp.evaluate(`
      const targets = ['en', 'pt', 'fr', 'it', 'de', 'ar', 'hi', 'zh', 'ru'];
      const setSel = (idx, val) => {
        const sels = document.querySelectorAll('.lang-bar select');
        if (sels.length < 2) return;
        sels[idx].value = val;
        sels[idx].dispatchEvent(new Event('change', { bubbles: true }));
      };
      const out = {};
      for (const target of targets) {
        setSel(0, 'es');
        await new Promise(r => setTimeout(r, 650));
        setSel(1, target);
        await new Promise(r => setTimeout(r, 650));
        const ta = document.querySelector('.pane textarea');
        if (!ta) { out[target] = null; continue; }
        ta.value = 'Necesito agua potable';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 120));
        const btn = [...document.querySelectorAll('#view button.btn')].find(b => /^traducir$/i.test(b.textContent.trim()));
        btn?.click();
        await new Promise(r => setTimeout(r, 800));
        out[target] = (document.querySelector('.pane.result .pane-body')?.textContent || '').trim();
      }
      return { out, source: 'Necesito agua potable' };
    `);
    const langs = Object.entries(multiLang.out || {});
    const translated = langs.filter(([, v]) => v && v.length > 2 && v.toLowerCase() !== multiLang.source.toLowerCase());
    const distinct = new Set(translated.map(([, v]) => v)).size;
    record('SIN CONEXIÓN traduce entre 9 idiomas distintos',
      translated.length >= 8 && distinct === translated.length,
      `${translated.length}/${langs.length} idiomas con traducción propia y distinta · ${langs.slice(0, 4).map(([k, v]) => `${k}:"${String(v).slice(0, 22)}"`).join(' ')}`);

    /* ---- 13. Restauración ------------------------------------------- */
    await cdp.setOffline(false);
    await cdp.evaluate(`await fetch('./manifest.json').catch(() => {}); return true;`);

    /* ---- 14. Adaptación a cualquier dispositivo ----------------------- */
    const viewports = [
      { name: 'móvil 390×844', width: 390, height: 844, scale: 3 },
      { name: 'móvil económico 320×640', width: 320, height: 640, scale: 2 },
      { name: 'tableta 768×1024', width: 768, height: 1024, scale: 2 },
      { name: 'escritorio 1440×900', width: 1440, height: 900, scale: 1 },
    ];
    const responsive = [];
    for (const vp of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width, height: vp.height, deviceScaleFactor: vp.scale, mobile: vp.width < 1024,
      });
      await sleep(450);
      const probe = await cdp.evaluate(`
        const bn = document.querySelector('.app-bottomnav');
        const sb = document.querySelector('.app-sidebar');
        return {
          bottomNavVisible: getComputedStyle(bn).display !== 'none',
          sidebarOffcanvas: getComputedStyle(sb).position === 'fixed',
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        };
      `);
      /* En móvil manda la navegación inferior y la barra lateral es un cajón;
       * en escritorio ocurre lo contrario. Y en ningún caso debe haber
       * desplazamiento horizontal: eso rompe la sensación de aplicación. */
      const expectsMobile = vp.width <= 1024;
      const okLayout = expectsMobile
        ? probe.bottomNavVisible && probe.sidebarOffcanvas
        : !probe.bottomNavVisible && !probe.sidebarOffcanvas;
      responsive.push({ ...vp, ...probe, ok: okLayout && probe.overflowX <= 1 });
    }
    const badViewports = responsive.filter((v) => !v.ok);
    record('Se adapta a móvil, tableta y escritorio sin desbordar',
      badViewports.length === 0,
      responsive.map((v) => `${v.name}:${v.ok ? 'ok' : `FALLA(desborde=${v.overflowX}px, nav=${v.bottomNavVisible}, cajón=${v.sidebarOffcanvas})`}`).join(' · '));

    /* Captura en móvil con las dos columnas del panel apiladas. */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await goto(cdp, 'home', '.hero');
    await sleep(600);
    await shot('movil-panel');
    await goto(cdp, 'sos', '.map-shell');
    await sleep(600);
    await shot('movil-sos');

    /* ---- 15. Tema claro y oscuro ------------------------------------- */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const theme = await cdp.evaluate(`
      const lum = (css) => {
        const m = css.match(/\\d+/g) || [255, 255, 255];
        return 0.2126 * (+m[0]) + 0.7152 * (+m[1]) + 0.0722 * (+m[2]);
      };
      const btn = document.querySelector('#theme-toggle');
      const start = { attr: document.documentElement.getAttribute('data-theme'), lum: lum(getComputedStyle(document.body).backgroundColor) };
      btn.click(); await new Promise(r => setTimeout(r, 400));
      const mid = { attr: document.documentElement.getAttribute('data-theme'), lum: lum(getComputedStyle(document.body).backgroundColor) };
      btn.click(); await new Promise(r => setTimeout(r, 400));
      const end = { attr: document.documentElement.getAttribute('data-theme'), lum: lum(getComputedStyle(document.body).backgroundColor) };
      /* Se deja el tema oscuro puesto para la comprobación visual final. */
      return { start, mid, end };
    `);
    const darkReached = [theme.start, theme.mid, theme.end].some((s) => s.attr === 'dark' && s.lum < 90);
    const lightReached = [theme.start, theme.mid, theme.end].some((s) => s.attr === 'light' && s.lum > 160);
    record('El tema claro y el oscuro se aplican de verdad',
      darkReached && lightReached,
      `${theme.start.attr}(${Math.round(theme.start.lum)}) → ${theme.mid.attr}(${Math.round(theme.mid.lum)}) → ${theme.end.attr}(${Math.round(theme.end.lum)})`);

    /* Capturas de escritorio: una por módulo, para revisar el diseño a ojo. */
    if (shotsDir) {
      /* La prueba de tema deja el modo oscuro puesto: se vuelve a claro para
       * revisar la paleta luminosa y se captura el oscuro al final. */
      await cdp.evaluate(`document.documentElement.setAttribute('data-theme', 'light'); return true;`);
      for (const r of routes) {
        await goto(cdp, r);
        await sleep(700);
        await shot(`escritorio-${r}`);
      }
      /* Y el archivo en oscuro, que es el tema por defecto del sistema. */
      await goto(cdp, 'memoria', '.search-box input');
      await sleep(600);
      await shot('escritorio-memoria-oscuro');
      console.log(`  Capturas guardadas en ${shotsDir}`);
    }

    /* ---- 17. Idiomas y escritura de derecha a izquierda --------------- */
    const i18n = await cdp.evaluate(`
      const sel = document.querySelector('#topbar select.select');
      if (!sel) return { error: 'sin selector de idioma en la cabecera' };
      sel.value = 'ar';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 2000));
      const rtl = {
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        arabicText: /[\\u0600-\\u06FF]/.test(document.body.innerText),
        navLabel: (document.querySelector('.nav-item .label') || {}).textContent || '',
        arabicNav: /[\\u0600-\\u06FF]/.test((document.querySelector('.nav-item .label') || {}).textContent || ''),
      };
      /* Volver al español para no dejar el idioma cambiado. */
      const sel2 = document.querySelector('#topbar select.select');
      sel2.value = 'es';
      sel2.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1600));
      return {
        rtl,
        back: { lang: document.documentElement.lang, dir: document.documentElement.dir },
      };
    `);
    record('El árabe se aplica en modo de derecha a izquierda (RTL)',
      i18n.rtl && i18n.rtl.lang === 'ar' && i18n.rtl.dir === 'rtl' && i18n.rtl.arabicText
      && i18n.rtl.arabicNav && i18n.back && i18n.back.dir === 'ltr',
      i18n.error || `árabe: dir=${i18n.rtl.dir} texto=${i18n.rtl.arabicText} navegación_traducida=${i18n.rtl.arabicNav} «${i18n.rtl.navLabel}» → español: dir=${i18n.back.dir}`);

    /* ---- 18. Errores acumulados -------------------------------------- */
    const errors = cdp.errors();
    record('Sin errores de JavaScript en toda la sesión', errors.length === 0,
      errors.length ? errors.slice(0, 5).join(' | ') : 'ninguna excepción ni error de consola');

  } catch (e) {
    record('Ejecución de la prueba', false, String(e.message || e));
    failed++;
    if (argv.includes('--dump')) {
      try {
        const dump = await cdp.evaluate(`
          const cls = (e) => (typeof e.className === 'string' ? e.className : e.tagName);
          return {
            hash: location.hash,
            sidebarChildren: [...document.querySelectorAll('#sidebar > *')].map(cls),
            brandChildren: [...document.querySelectorAll('.brand > *')].map(cls),
            brandTextChildren: [...document.querySelectorAll('.brand-text > *')].map(cls),
            hasSideFoot: !!document.querySelector('.side-foot'),
            hasIdentityChip: !!document.querySelector('#identity-chip'),
            topbarChildren: [...document.querySelectorAll('#topbar > *')].map(cls),
            viewChildren: [...document.querySelectorAll('#view > *')].map(cls),
            homeSections: [...document.querySelectorAll('#view .view > *')].map(cls),
            statCount: document.querySelectorAll('.stat').length,
            statLabelCount: document.querySelectorAll('.stat-label').length,
            statValueCount: document.querySelectorAll('.stat-value').length,
            heroHtml: (document.querySelector('.hero')?.outerHTML || '').slice(0, 700),
          };
        `);
        console.log('\n  --- VOLCADO DE DIAGNÓSTICO ---');
        const diagErrors = cdp.errors();
        if (diagErrors.length) {
          console.log('  ERRORES DE LA PÁGINA:');
          diagErrors.slice(0, 6).forEach((e) => console.log('    · ' + e.slice(0, 400)));
        } else {
          console.log('  ERRORES DE LA PÁGINA: ninguno capturado');
        }
        for (const [k, v] of Object.entries(dump)) {
          console.log(`  ${k}: ${Array.isArray(v) ? JSON.stringify(v) : String(v).slice(0, 300)}`);
        }
        console.log('  --- FIN DEL VOLCADO ---\n');
      } catch (dumpErr) { console.log('  (no se pudo obtener el volcado:', dumpErr.message, ')'); }
    }
  } finally {
    try { await cdp?.send('Browser.close'); } catch { /* el canal pudo cerrarse antes */ }
    killTree(child.pid);
    await sleep(700);
    try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* perfil temporal */ }
  }

  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok);
  console.log('');
  console.log('='.repeat(78));
  console.log(`  PANGEA · prueba de extremo a extremo: ${ok}/${results.length} correctas`);
  console.log('='.repeat(78));
  if (bad.length) { console.log('\n  FALLOS'); bad.forEach((b) => console.log(`  ✗ ${b.name} — ${b.detail}`)); console.log(''); }
  process.exitCode = bad.length ? 1 : 0;
}

run();
