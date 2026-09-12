/* ============================================================================
 * PANGEA · js/store.js
 * Capa de persistencia local-first sobre IndexedDB + bus de eventos (pub/sub).
 * No hay backend obligatorio: IndexedDB es la fuente primaria de verdad.
 * Todas las escrituras emiten eventos que la UI escucha para re-renderizar.
 * ==========================================================================*/

import { uid } from './utils.js';

export const COLLECTIONS = Object.freeze({
  problems: 'problems',        // SYNAPSE · problemas publicados
  capacities: 'capacities',    // SYNAPSE · capacidades/recursos ofrecidos
  matches: 'matches',          // SYNAPSE · emparejamientos y su estado kanban
  claims: 'claims',            // VERITAS · afirmaciones a verificar
  votes: 'votes',              // VERITAS · votos y fuentes
  knowledge: 'knowledge',      // MEMORIA · saberes preservados
  curations: 'curations',      // MEMORIA · validaciones de curadores
  alerts: 'alerts',            // SOS · alertas de emergencia
  responses: 'responses',      // SOS · respuestas con recursos
  vocab: 'vocab',              // LINGUA · diccionario vivo de lenguas
  agents: 'agents',            // AGENTE · perfil del representante personal
  events: 'events',            // Log de actividad (reputación / impacto)
  settings: 'settings',        // KV: preferencias, tema, idioma
  identity: 'identity',        // NEXUS ID · claves (privada cifrada si aplica)
  telemetry: 'telemetry',      // Telemetría ética local (visible y borrable)
});

const DB_NAME = 'pangea';
const DB_VERSION = 1;
const ALL = Object.values(COLLECTIONS);

/* ------------------------------------------------------------- Motor IDB --- */

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB no disponible'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ALL) {
        if (!db.objectStoreNames.contains(name)) {
          const os = db.createObjectStore(name, { keyPath: 'id' });
          if (name !== COLLECTIONS.settings && name !== COLLECTIONS.identity) {
            try { os.createIndex('createdAt', 'createdAt', { unique: false }); } catch {}
            try { os.createIndex('status', 'status', { unique: false }); } catch {}
          }
        }
      }
    };
    req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    req.onerror = () => reject(req.error || new Error('No se pudo abrir IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB bloqueada por otra pestaña'));
  });
  return dbPromise;
}

/**
 * Ejecuta una operación dentro de una transacción y resuelve con su resultado.
 * Si `fn` devuelve un IDBRequest, se resuelve con `request.result`.
 */
function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    let t, out;
    try {
      t = db.transaction(store, mode);
      out = fn(t.objectStore(store));
    } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && typeof out === 'object' && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transacción abortada'));
  }));
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/* ------------------------------------------------------------------ Bus ---- */

const bus = new Map();

function emit(type, detail) {
  const set = bus.get(type);
  if (set) for (const fn of [...set]) { try { fn(detail); } catch (e) { console.error('[pangea:bus]', type, e); } }
  const any = bus.get('*');
  if (any) for (const fn of [...any]) { try { fn({ type, detail }); } catch {} }
}

/* ---------------------------------------------------------------- Store ---- */

export const Store = {
  COLLECTIONS,
  ready: () => open().then(() => true),

  on(type, fn) {
    if (!bus.has(type)) bus.set(type, new Set());
    bus.get(type).add(fn);
    return () => bus.get(type).delete(fn);
  },
  emit,

  /** Inserta o actualiza. Normaliza id/createdAt/updatedAt. */
  async put(collection, record, { silent = false } = {}) {
    const rec = { createdAt: Date.now(), ...record };
    rec.id = rec.id || uid(collection.slice(0, 4));
    rec.updatedAt = Date.now();
    await tx(collection, 'readwrite', (os) => os.put(rec));
    if (!silent) emit(collection, { action: 'put', record: rec });
    return rec;
  },

  /**
   * Escribe muchos registros en UNA SOLA transacción.
   *
   * Escribir en bucle con `put` abre una transacción por registro: los 42
   * registros de ejemplo eran 42 transacciones encadenadas antes de poder pintar
   * nada, y la medición de rendimiento lo delataba como bloqueo del hilo
   * principal. Una transacción por colección hace el mismo trabajo en una
   * fracción del tiempo y con la misma garantía atómica: o entran todos o no
   * entra ninguno.
   */
  async putMany(collection, records, { silent = false } = {}) {
    const rows = (Array.isArray(records) ? records : []).filter((r) => r && typeof r === 'object');
    if (!rows.length) return 0;
    const now = Date.now();
    const prepared = rows.map((r) => ({ createdAt: now, ...r, id: r.id || uid(collection.slice(0, 4)), updatedAt: now }));
    await tx(collection, 'readwrite', (os) => { for (const r of prepared) os.put(r); return prepared.length; });
    if (!silent) emit(collection, { action: 'putMany', count: prepared.length });
    return prepared.length;
  },

  get(collection, id) { return tx(collection, 'readonly', (os) => os.get(id)); },

  async all(collection) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(collection, 'readonly');
      const r = t.objectStore(collection).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  },

  async query(collection, predicate) {
    const rows = await Store.all(collection);
    return predicate ? rows.filter(predicate) : rows;
  },

  async sorted(collection, dir = 'desc') {
    const rows = await Store.all(collection);
    rows.sort((a, b) => (dir === 'desc' ? (b.createdAt || 0) - (a.createdAt || 0) : (a.createdAt || 0) - (b.createdAt || 0)));
    return rows;
  },

  async count(collection) { await open(); const db = await open(); return new Promise((res, rej) => { const r = db.transaction(collection, 'readonly').objectStore(collection).count(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },

  async del(collection, id, { silent = false } = {}) {
    await tx(collection, 'readwrite', (os) => os.delete(id));
    if (!silent) emit(collection, { action: 'delete', id });
    return true;
  },

  async clear(collection, { silent = false } = {}) {
    await tx(collection, 'readwrite', (os) => os.clear());
    if (!silent) emit(collection, { action: 'clear' });
  },

  /** Actualización parcial por id. */
  async patch(collection, id, patch) {
    const current = await tx(collection, 'readonly', (os) => req2p(os.get(id)));
    if (!current) throw new Error('Registro inexistente: ' + id);
    const next = { ...current, ...patch, id, updatedAt: Date.now() };
    return Store.put(collection, next);
  },

  /* ----------------------------------------------------------- KV / ajustes */

  async kv(key, fallback = null) {
    try {
      const row = await tx(COLLECTIONS.settings, 'readonly', (os) => req2p(os.get(key)));
      return row && 'value' in row ? row.value : fallback;
    } catch { return fallback; }
  },
  async setKv(key, value) {
    await tx(COLLECTIONS.settings, 'readwrite', (os) => os.put({ id: key, value, createdAt: Date.now() }));
    emit('settings', { action: 'put', key, value });
    return value;
  },

  /* ----------------------------------------------------------- Telemetría --- */

  async track(kind, payload = {}) {
    try {
      const day = new Date().toISOString().slice(0, 10);
      const row = await tx(COLLECTIONS.telemetry, 'readonly', (os) => req2p(os.get(day)));
      const counters = { ...((row && row.counters) || {}) };
      counters[kind] = (counters[kind] || 0) + 1;
      await tx(COLLECTIONS.telemetry, 'readwrite', (os) => os.put({ id: day, counters, updatedAt: Date.now(), createdAt: row ? row.createdAt : Date.now() }));
    } catch { /* la telemetría nunca debe romper la app */ }
  },
  async telemetrySummary() { return Store.sorted(COLLECTIONS.telemetry, 'desc'); },
  async wipeTelemetry() { await Store.clear(COLLECTIONS.telemetry); return true; },

  /* ------------------------------------------------------------- Eventos --- */

  async log(type, message, meta = {}) {
    return Store.put(COLLECTIONS.events, { type, message, meta }, { silent: false });
  },

  /* -------------------------------------------------- Exportar / Importar -- */

  /**
   * Preferencias que NUNCA deben salir del dispositivo en un paquete de datos.
   * Una clave de API es un secreto: si viajara dentro del pasaporte, el usuario
   * lo repartiría sin saberlo cada vez que comparte su archivo.
   */
  SENSITIVE_SETTINGS: Object.freeze(['pref.llm.key', 'pref.translate.endpoint.token']),

  /**
   * Colecciones que NUNCA salen del dispositivo en un paquete de datos.
   *
   *   · `identity`  → contiene la clave privada en claro.
   *   · `telemetry` → es el contador local de uso. La promesa del proyecto es
   *     que la telemetría no sale del dispositivo, y un pasaporte puede acabar
   *     en un nodo comunitario ajeno: enviarla ahí sería exactamente lo que
   *     decimos que no hacemos.
   */
  NEVER_EXPORTED: Object.freeze([COLLECTIONS.identity, COLLECTIONS.telemetry]),

  /**
   * Exporta los datos del usuario.
   *
   * La colección `identity` se excluye por omisión porque contiene la clave
   * privada en claro, y un pasaporte está pensado para compartirse o llevarse
   * en un USB. La identidad solo viaja por su propio camino cifrado (formato
   * PANGEA-ID-1, en crypto.js). Incluirla aquí convertiría cualquier copia de
   * seguridad en una filtración de identidad.
   */
  async exportAll({ includeIdentity = false } = {}) {
    const data = {};
    const omitted = [];
    for (const c of ALL) {
      const skip = c === COLLECTIONS.identity
        ? !includeIdentity
        : Store.NEVER_EXPORTED.includes(c);
      if (skip) { data[c] = []; omitted.push(c); continue; }
      let rows = await Store.all(c);
      if (c === COLLECTIONS.settings) {
        const before = rows.length;
        rows = rows.filter((r) => !Store.SENSITIVE_SETTINGS.includes(r.id));
        if (rows.length < before) omitted.push('settings:secretos');
      }
      data[c] = rows;
    }
    return {
      format: 'pangea-exchange',
      spec: '1.0',
      app: 'PANGEA',
      exportedAt: new Date().toISOString(),
      counts: Object.fromEntries(ALL.map((c) => [c, data[c].length])),
      omitted,
      collections: data,
    };
  },

  /**
   * Importa con estrategia "última escritura gana" y detección de duplicados.
   *
   * Dos protecciones deliberadas:
   *   · La colección `identity` NUNCA se importa desde un paquete de datos. La
   *     identidad tiene su propio camino cifrado y con contraseña; aceptarla
   *     aquí permitiría sustituir la identidad de alguien con solo enviarle un
   *     archivo.
   *   · Un paquete cuyo `format` sea de otro tipo (por ejemplo `pangea-sos`)
   *     se rechaza: cada formato tiene su importador, que valida la firma y
   *     marca la procedencia. Colarlo por la vía genérica saltaría esas
   *     comprobaciones.
   */
  async importAll(payload, { merge = true } = {}) {
    if (!payload || typeof payload !== 'object') throw new Error('Paquete inválido');
    if (payload.format && payload.format !== 'pangea-exchange') {
      throw new Error(`Este archivo es un paquete «${payload.format}»: ábrelo desde el módulo que lo generó`);
    }
    const cols = payload.collections || payload;
    /* Contadores honestos: `imported` = identificadores nuevos, `overwritten` =
     * registros existentes que se reemplazaron porque el entrante era más
     * reciente, `skipped` = descartados de verdad (sin id o más antiguos que lo
     * que ya había). Antes las sobrescrituras se contaban como «omitidas», lo
     * que hacía ilegible cualquier interfaz de estado de sincronización. */
    const report = { imported: 0, overwritten: 0, skipped: 0, collections: {}, identitySkipped: false };
    for (const c of ALL) {
      const rows = Array.isArray(cols[c]) ? cols[c] : [];
      if (!rows.length) continue;
      if (c === COLLECTIONS.identity) { report.identitySkipped = true; continue; }
      let imp = 0, over = 0, skip = 0;
      const existing = merge ? new Map((await Store.all(c)).map((r) => [r.id, r])) : new Map();
      const batch = [];
      for (const row of rows) {
        if (!row || typeof row !== 'object' || !row.id) { skip++; continue; }
        const prev = existing.get(row.id);
        if (prev) {
          if ((prev.updatedAt || prev.createdAt || 0) >= (row.updatedAt || row.createdAt || 0)) { skip++; continue; }
          over++;
        } else imp++;
        batch.push(row);
      }
      if (batch.length) await tx(c, 'readwrite', (os) => { for (const r of batch) os.put(r); return batch.length; });
      report.imported += imp; report.overwritten += over; report.skipped += skip;
      report.collections[c] = { imported: imp, overwritten: over, skipped: skip };
      emit(c, { action: 'import', count: batch.length });
    }
    emit('import', report);
    return report;
  },

  async wipeAll() {
    for (const c of ALL) {
      if (c === COLLECTIONS.identity) continue; // la identidad se borra explícitamente
      await Store.clear(c, { silent: true });
    }
    emit('*', { type: 'wipe', detail: {} });
    emit('wipe', {});
  },

  /** Estadísticas agregadas para el panel de mando. */
  async stats() {
    const [problems, capacities, matches, claims, knowledge, alerts, responses, vocab] = await Promise.all([
      Store.count(COLLECTIONS.problems), Store.count(COLLECTIONS.capacities), Store.count(COLLECTIONS.matches),
      Store.count(COLLECTIONS.claims), Store.count(COLLECTIONS.knowledge), Store.count(COLLECTIONS.alerts),
      Store.count(COLLECTIONS.responses), Store.count(COLLECTIONS.vocab),
    ]);
    const resolved = (await Store.query(COLLECTIONS.matches, (m) => m.status === 'resuelto')).length;
    return { problems, capacities, matches, claims, knowledge, alerts, responses, vocab, resolved };
  },
};

export default Store;
