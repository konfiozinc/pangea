/* ============================================================================
 * PANGEA · js/workers/sync.worker.js
 * Sincronización opcional con un "nodo PANGEA" autoalojado.
 *
 * PANGEA no necesita servidores: funciona entero en el dispositivo. Este worker
 * existe para comunidades que despliegan su propio nodo (Supabase, PocketBase o
 * cualquier API compatible) y quieren intercambiar alertas y emparejamientos
 * entre vecinos sin depender de una nube ajena.
 *
 * Garantías:
 *   · Nunca se ejecuta solo: el usuario configura la dirección y pulsa sincronizar.
 *   · Sin nodo configurado, no se realiza NINGUNA petición de red.
 *   · Un fallo de red jamás bloquea la aplicación: se informa y se sigue en local.
 *
 * Mensajes aceptados:
 *   { type:'push', endpoint, token, payload }  → sube un paquete firmado
 *   { type:'pull', endpoint, token, since }    → descarga cambios posteriores
 *   { type:'ping', endpoint, token }           → comprueba que el nodo responde
 * ==========================================================================*/

const TIMEOUT_MS = 15000;

/**
 * Control de tiempo de espera. Devuelve la señal que se pasa a fetch y una
 * función para cancelar el temporizador. (Antes recibía una promesa que nunca
 * se usaba ni se resolvía: el temporizador funcionaba, pero la firma de la
 * función mentía sobre lo que hacía.)
 */
function timeoutSignal(ms = TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return { signal: ctl.signal, done: () => clearTimeout(t) };
}

async function request(url, { method = 'GET', token = '', body = null, signal } = {}) {
  const res = await fetch(url, {
    method,
    signal,
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  const base = String(msg.endpoint || '').replace(/\/+$/, '');
  if (!base) {
    self.postMessage({ id: msg.id, ok: false, error: 'sin_nodo', message: 'No hay nodo configurado' });
    return;
  }

  const { signal, done } = timeoutSignal();
  try {
    if (msg.type === 'ping') {
      const data = await request(`${base}/pangea/health`, { token: msg.token, signal });
      self.postMessage({ id: msg.id, ok: true, data });
    } else if (msg.type === 'push') {
      const data = await request(`${base}/pangea/sync`, { method: 'POST', token: msg.token, body: msg.payload, signal });
      self.postMessage({ id: msg.id, ok: true, data });
    } else if (msg.type === 'pull') {
      const qs = msg.since ? `?since=${encodeURIComponent(msg.since)}` : '';
      const data = await request(`${base}/pangea/sync${qs}`, { token: msg.token, signal });
      self.postMessage({ id: msg.id, ok: true, data });
    } else {
      self.postMessage({ id: msg.id, ok: false, error: 'tipo_desconocido' });
    }
  } catch (error) {
    self.postMessage({
      id: msg.id,
      ok: false,
      error: error && error.name === 'AbortError' ? 'timeout' : 'fallo_red',
      message: String((error && error.message) || error),
      offline: true,
    });
  } finally {
    done();
  }
};

self.postMessage({ type: 'boot' });
