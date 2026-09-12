/* ============================================================================
 * PANGEA · js/crypto.js
 * NEXUS ID — Identidad descentralizada y verificable.
 * ECDSA P-256 (Web Crypto) + huella SHA-256 + cifrado AES-GCM/PBKDF2 para
 * exportar la identidad. Sin servidores, sin autoridades de certificación.
 *
 * Propiedades que habilita:
 *  · La clave pública ES el identificador (no hay registro central).
 *  · Cada contribución se firma ⇒ cualquiera puede verificar autoría e
 *    integridad offline, años después, sin conexión.
 *  · La reputación es portable: un "Pasaporte PANGEA" firmado se puede llevar
 *    a otro dispositivo y ser validado por un tercero.
 * ==========================================================================*/

import { Store, COLLECTIONS } from './store.js';

const ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALGO = { name: 'ECDSA', hash: 'SHA-256' };
const SELF_KEY = 'self';
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = {
  encode: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  decode: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};
export const toB64 = b64.encode;
export const fromB64 = b64.decode;

/* --------------------------------------------------------------- Utilidades */

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', typeof text === 'string' ? enc.encode(text) : text);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Campos que NUNCA forman parte de lo que se firma.
 *
 * La firma acredita la AUTORÍA DEL CONTENIDO, no el ciclo de vida del registro.
 * El conjunto se aplica de forma RECURSIVA y con una sola lista, para que la
 * proyección sea idempotente: un registro firmado suelto y el mismo registro
 * dentro de un paquete producen exactamente la misma cadena canónica. Con dos
 * listas distintas (una solo en la raíz) la proyección dependería del contexto
 * y dos implementaciones compatibles podrían discrepar.
 *
 *   · sobre de firma            → sig, signature (si no, sería recursivo)
 *   · almacenamiento            → id, createdAt, updatedAt (los asigna la base
 *     de datos, y se generan antes de firmar solo por comodidad, no porque la
 *     firma dependa de ellos)
 *   · estado y anotaciones      → status, confirmations, origin, importedFrom,
 *     collaborators, seed, score, explain, matchedAt, seenBy, curationAvg,
 *     curationCount: cambian con el uso normal del registro (alguien confirma
 *     una alerta, alguien colabora) sin que el autor deje de ser el autor
 *   · cachés de cálculo         → _vec, _score, local
 *
 * Así, una contribución firmada hoy sigue siendo verificable dentro de diez
 * años y tras cualquier número de actualizaciones de estado.
 */
const NOT_SIGNED = new Set([
  'sig', 'signature', 'updatedAt', '_vec', '_score', 'local',
  'id', 'createdAt',
  'status', 'confirmations', 'origin', 'importedFrom', 'collaborators',
  'seed', 'score', 'explain', 'matchedAt', 'seenBy', 'curationAvg', 'curationCount',
]);

export function canonical(value) {
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Uint8Array || v instanceof Float32Array) return Array.from(v);
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (NOT_SIGNED.has(k) || v[k] === undefined) continue;
      out[k] = walk(v[k]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

/** Huella legible: PAN-XXXX-XXXX-XXXX derivada de SHA-256 de la clave pública. */
export async function fingerprintOf(pubJwkString) {
  const hex = await sha256Hex(pubJwkString);
  const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos
  const groups = [];
  for (let g = 0; g < 3; g++) {
    let s = '';
    for (let i = 0; i < 4; i++) {
      const byte = parseInt(hex.slice((g * 4 + i) * 2, (g * 4 + i) * 2 + 2), 16);
      s += ALPH[byte % ALPH.length];
    }
    groups.push(s);
  }
  return 'PAN-' + groups.join('-');
}

/* -------------------------------------------------------------- Identidad -- */

const importPub = (jwk) => crypto.subtle.importKey('jwk', JSON.parse(jwk), ALGO, true, ['verify']);
const importPriv = (jwk) => crypto.subtle.importKey('jwk', JSON.parse(jwk), ALGO, true, ['sign']);

let cache = { identity: null, keys: null };

export const Crypto = {
  toB64, fromB64, canonical, sha256Hex, fingerprintOf,

  /** ¿Existe ya una identidad local? */
  async exists() { return !!(await Store.kv('nexus.identity', null)) || !!(await Store.get(COLLECTIONS.identity, SELF_KEY).catch(() => null)); },

  async current() {
    if (cache.identity) return cache.identity;
    const rec = await Store.get(COLLECTIONS.identity, SELF_KEY).catch(() => null);
    cache.identity = rec || null;
    return cache.identity;
  },

  /**
   * Crea el par de claves ECDSA P-256 del usuario.
   * La clave privada nunca sale del dispositivo salvo exportación cifrada explícita.
   */
  async generate({ name = '', langs = [], areas = [] } = {}) {
    const pair = await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify']);
    const [pubJwk, privJwk] = await Promise.all([
      crypto.subtle.exportKey('jwk', pair.publicKey),
      crypto.subtle.exportKey('jwk', pair.privateKey),
    ]);
    const pub = JSON.stringify(pubJwk), priv = JSON.stringify(privJwk);
    const record = {
      id: SELF_KEY,
      pub, priv,
      fingerprint: await fingerprintOf(pub),
      name: name || '',
      langs, areas,
      createdAt: Date.now(),
      alg: 'ECDSA-P256-SHA256',
      version: 1,
    };
    await Store.put(COLLECTIONS.identity, record, { silent: true });
    cache = { identity: record, keys: { publicKey: pair.publicKey, privateKey: pair.privateKey } };
    Store.emit('identity', { action: 'created', fingerprint: record.fingerprint });
    await Store.log('nexus', 'Identidad NEXUS creada', { fingerprint: record.fingerprint });
    return record;
  },

  async keys() {
    if (cache.keys) return cache.keys;
    const id = await Crypto.current();
    if (!id) throw new Error('No hay identidad NEXUS');
    const keys = { publicKey: await importPub(id.pub), privateKey: await importPriv(id.priv) };
    cache.keys = keys;
    return keys;
  },

  async updateProfile(patch) {
    const id = await Crypto.current();
    if (!id) throw new Error('No hay identidad NEXUS');
    const next = { ...id, ...patch, id: SELF_KEY, updatedAt: Date.now() };
    await Store.put(COLLECTIONS.identity, next, { silent: true });
    cache.identity = next;
    Store.emit('identity', { action: 'updated' });
    return next;
  },

  /**
   * Firma un objeto. Devuelve el sobre firmado (envelope) que se adjunta al
   * registro: { sig, pub, fp, alg, at }. `canonical` ignora el propio sobre.
   */
  async sign(obj) {
    const id = await Crypto.current();
    if (!id) return null;
    const { privateKey } = await Crypto.keys();
    const bytes = enc.encode(canonical(obj));
    const raw = await crypto.subtle.sign(SIGN_ALGO, privateKey, bytes);
    return { sig: b64.encode(raw), pub: id.pub, fp: id.fingerprint, alg: 'ECDSA-P256-SHA256', at: Date.now() };
  },

  /** Adjunta la firma al registro (campo `sig`), devolviendo una copia. */
  async signed(obj) {
    const env = await Crypto.sign(obj);
    if (!env) return { ...obj };
    return { ...obj, sig: env };
  },

  /**
   * Verifica una firma contra la clave pública incluida en el sobre.
   *
   * Comprueba DOS cosas, y la segunda es tan importante como la primera:
   *   1. que la firma sea matemáticamente válida para `sig.pub`;
   *   2. que la huella declarada en `sig.fp` SEA la que corresponde a `sig.pub`.
   *
   * Sin la segunda comprobación, cualquiera podría firmar con su propia clave y
   * escribir la huella de otra persona en el sobre: la firma validaría y la
   * interfaz mostraría un autor que no es el firmante. La huella es un dato
   * derivado, así que se recalcula siempre y nunca se confía en la declarada.
   */
  async verify(obj, envelope = null) {
    try {
      const env = envelope || obj.sig;
      if (!env || !env.sig || !env.pub) return false;
      const pubJwk = typeof env.pub === 'string' ? env.pub : JSON.stringify(env.pub);
      const key = await importPub(pubJwk);
      const ok = await crypto.subtle.verify(SIGN_ALGO, key, b64.decode(env.sig), enc.encode(canonical(obj)));
      if (!ok) return false;
      if (env.fp) {
        const real = await fingerprintOf(pubJwk);
        if (real !== env.fp) return false;
      }
      return true;
    } catch { return false; }
  },

  /** ¿Quién firmó? La huella SIEMPRE se recalcula desde la clave pública. */
  async signerOf(obj) {
    const env = obj && obj.sig;
    if (!env || !env.pub) return null;
    const pubJwk = typeof env.pub === 'string' ? env.pub : JSON.stringify(env.pub);
    const fingerprint = await fingerprintOf(pubJwk);
    const me = await Crypto.current();
    return {
      fingerprint,
      claimed: env.fp || null,
      spoofed: !!env.fp && env.fp !== fingerprint,
      isSelf: !!(me && me.fingerprint === fingerprint),
      at: env.at || null,
      verified: await Crypto.verify(obj),
    };
  },

  /* ------------------------------------------- Exportar / importar identidad */

  /** Deriva una clave AES-GCM con PBKDF2 (250k iteraciones, SHA-256). */
  async deriveKey(password, salt, iterations = 250000) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
  },

  /**
   * Exporta la identidad (con clave privada) cifrada con contraseña.
   * Formato propio "PANGEA-ID-1" — portable y auditable.
   */
  async exportIdentity(password, extra = {}) {
    const id = await Crypto.current();
    if (!id) throw new Error('No hay identidad NEXUS que exportar');
    if (!password || password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await Crypto.deriveKey(password, salt);
    const payload = enc.encode(JSON.stringify({ identity: id, exportedAt: new Date().toISOString(), ...extra }));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
    return {
      format: 'PANGEA-ID-1',
      kdf: 'PBKDF2-SHA256-250000',
      cipher: 'AES-GCM-256',
      salt: b64.encode(salt),
      iv: b64.encode(iv),
      data: b64.encode(ct),
      fingerprint: id.fingerprint,
      createdAt: new Date().toISOString(),
    };
  },

  async importIdentity(bundle, password) {
    if (!bundle || bundle.format !== 'PANGEA-ID-1') throw new Error('Formato de identidad no reconocido');
    const key = await Crypto.deriveKey(password, b64.decode(bundle.salt), 250000);
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.decode(bundle.iv) }, key, b64.decode(bundle.data));
    } catch { throw new Error('Contraseña incorrecta o archivo dañado'); }
    const parsed = JSON.parse(dec.decode(plain));
    const id = { ...parsed.identity, id: SELF_KEY };
    await Store.put(COLLECTIONS.identity, id, { silent: true });
    cache = { identity: id, keys: null };
    Store.emit('identity', { action: 'imported', fingerprint: id.fingerprint });
    return id;
  },

  /** Elimina la identidad del dispositivo (irreversible sin respaldo). */
  async forget() {
    await Store.del(COLLECTIONS.identity, SELF_KEY, { silent: true });
    cache = { identity: null, keys: null };
    Store.emit('identity', { action: 'forgotten' });
    return true;
  },

  /**
   * Crea una atestación de reputación firmada y portable.
   * Cualquiera puede verificar que el emisor realmente otorgó los puntos.
   */
  async attest({ to, points, reason, context = {} }) {
    const me = await Crypto.current();
    if (!me) return null;
    const claim = {
      kind: 'pangea.attestation',
      from: me.fingerprint,
      to,
      points,
      reason,
      context,
      issuedAt: new Date().toISOString(),
      nonce: crypto.getRandomValues(new Uint32Array(1))[0].toString(36),
    };
    return Crypto.signed(claim);
  },

  /**
   * Verifica una atestación ajena y devuelve un veredicto legible.
   *
   * El emisor NO se lee del campo `from` (que es texto libre dentro de lo
   * firmado, pero podría narrar cualquier cosa): se recalcula la huella a
   * partir de la clave pública que realmente produjo la firma y se compara con
   * el emisor declarado. Sin ese paso, cualquiera podría emitir una atestación
   * a nombre de otra persona.
   */
  async verifyAttestation(att) {
    const ok = await Crypto.verify(att);
    let signerFingerprint = null;
    if (att && att.sig && att.sig.pub) {
      const pubJwk = typeof att.sig.pub === 'string' ? att.sig.pub : JSON.stringify(att.sig.pub);
      signerFingerprint = await fingerprintOf(pubJwk);
    }
    const matchesIssuer = !!signerFingerprint && signerFingerprint === att.from;
    return {
      valid: ok,
      from: att.from, to: att.to, points: att.points, reason: att.reason,
      issuedAt: att.issuedAt,
      signerFingerprint,
      declaredIssuer: att.from,
      matchesIssuer,
      verdict: ok && matchesIssuer ? 'válida' : ok ? 'firma válida, emisor no coincide' : 'no verificable',
    };
  },
};

export default Crypto;
