/**
 * PANGEA · js/modules/manifest.js
 * La ficha de cada módulo: lo justo para dibujar el menú, sin su código.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * Antes, `app.js` importaba los ocho módulos con `import` normal. Eso obliga al
 * navegador a descargarlos TODOS antes de ejecutar la primera línea de la
 * aplicación, porque un módulo no puede empezar a funcionar hasta que su lista
 * de dependencias está completa. Y no son pequeños: entre los ocho suman 298 KB,
 * frente a los 130 KB del núcleo. Medido, la primera visita tenía que bajar
 * 428 KB de JavaScript antes de pintar nada, y en una conexión mala eso son
 * varios segundos mirando la pantalla de arranque.
 *
 * La solución es separar dos cosas que no tienen por qué ir juntas:
 *
 *   · la FICHA del módulo (nombre, icono, color), que hace falta siempre
 *     porque aparece en el menú, en el mapa del panel y en los atajos de teclado;
 *   · el CÓDIGO del módulo, que sólo hace falta cuando alguien entra en él.
 *
 * Aquí vive la ficha. El código se carga con `cargarModulo()` en el momento de
 * entrar, y los archivos siguen precargados por el Service Worker, así que
 * funcionar sin conexión no cambia: se guardan al instalar, no al visitar.
 *
 * Los valores están duplicados respecto a cada módulo, y eso es un riesgo real
 * de que se separen con el tiempo. Para que no pase, `tools/audit.mjs` compara
 * esta ficha con lo que cada módulo declara de sí mismo y falla si no coinciden.
 */

/** El orden importa: `simple` va primero a propósito. */
export const MODULES = [
  {
    /* El único módulo que una persona que no lee puede usar sin que nadie le
     * explique nada. Por eso encabeza el menú, aunque no sea el más potente. */
    id: 'simple', icon: 'handshake', accent: 'emerald',
    titleKey: 'nav.simple', subKey: 'home.needTitle', file: 'simple.js',
  },
  {
    id: 'lingua', icon: 'translate', accent: 'cyan',
    titleKey: 'lingua.title', subKey: 'lingua.sub', file: 'lingua.js',
  },
  {
    id: 'synapse', icon: 'network', accent: 'indigo',
    titleKey: 'synapse.title', subKey: 'synapse.sub', file: 'synapse.js',
  },
  {
    id: 'veritas', icon: 'shield', accent: 'emerald',
    titleKey: 'veritas.title', subKey: 'veritas.sub', file: 'veritas.js',
  },
  {
    id: 'memoria', icon: 'book', accent: 'amber',
    titleKey: 'memoria.title', subKey: 'memoria.sub', file: 'memoria.js',
  },
  {
    id: 'sos', icon: 'sos', accent: 'red',
    titleKey: 'sos.title', subKey: 'sos.sub', file: 'sos.js',
  },
  {
    id: 'agente', icon: 'bot', accent: 'cyan',
    titleKey: 'agente.title', subKey: 'agente.sub', file: 'agente.js',
  },
  {
    /* El identificador es `nexus` y el archivo se llama `nexus-id.js`. */
    id: 'nexus', icon: 'id', accent: 'indigo',
    titleKey: 'nexus.title', subKey: 'nexus.sub', file: 'nexus-id.js',
  },
];

/** Ficha de un módulo por su identificador, o null si no existe. */
export function fichaDe(id) {
  return MODULES.find((m) => m.id === id) || null;
}

/* Los módulos ya cargados. La promesa se guarda, no el resultado, para que dos
 * entradas seguidas al mismo módulo no disparen dos descargas. */
const cargados = new Map();

/**
 * Carga el código de un módulo. Sólo se llama al entrar en él.
 * @param {string} id identificador del módulo (`nexus`, no `nexus-id`)
 * @returns {Promise<object>} el objeto del módulo, con su `mount`
 */
export function cargarModulo(id) {
  if (cargados.has(id)) return cargados.get(id);

  const ficha = fichaDe(id);
  if (!ficha) return Promise.reject(new Error(`No existe el módulo «${id}»`));

  /* La ruta se arma con el nombre del archivo de la ficha. Si la descarga
   * falla, se quita de la lista para que volver a intentarlo sea posible: si
   * se quedara guardado el fallo, ese módulo no volvería a cargarse nunca en
   * toda la sesión. */
  const promesa = import(`./${ficha.file}`).then((m) => m.default).catch((e) => {
    cargados.delete(id);
    throw e;
  });

  cargados.set(id, promesa);
  return promesa;
}

/** Si un módulo ya está cargado, sin cargarlo. */
export const estaCargado = (id) => cargados.has(id);
