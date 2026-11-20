'use strict';
/**
 * Copia en la nube de las estadísticas: Firebase Realtime Database.
 *
 * - Studio inicia sesión con correo y contraseña (Firebase Authentication, API REST).
 * - Cada dato se guarda bajo users/<uid>, y las reglas solo permiten leer o
 *   escribir a ese mismo usuario.
 * - Los datos locales siguen siendo la fuente principal: la nube es copia y
 *   punto de consulta desde otros equipos.
 */
const production = require('./production.cjs');

const STATE = 'nube';
const SECRET = 'nube-secreto';
const TIMEOUT = 30000;
const BATCH = 1500;

const RULES = JSON.stringify({
  rules: {
    users: {
      $uid: {
        '.read': 'auth != null && auth.uid === $uid',
        '.write': 'auth != null && auth.uid === $uid'
      }
    }
  }
}, null, 2);

const AUTH_ERRORS = {
  EMAIL_NOT_FOUND: 'No existe una cuenta con ese correo. Usa «Crear cuenta».',
  INVALID_PASSWORD: 'La contraseña no es correcta.',
  INVALID_LOGIN_CREDENTIALS: 'Correo o contraseña incorrectos.',
  EMAIL_EXISTS: 'Ya existe una cuenta con ese correo. Usa «Iniciar sesión».',
  OPERATION_NOT_ALLOWED: 'Activa el acceso con correo y contraseña en Firebase → Authentication → Método de acceso.',
  CONFIGURATION_NOT_FOUND: 'Activa Firebase Authentication en tu proyecto y habilita «Correo electrónico/contraseña».',
  WEAK_PASSWORD: 'La contraseña debe tener al menos 6 caracteres.',
  INVALID_EMAIL: 'El correo no es válido.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Demasiados intentos. Espera unos minutos.',
  USER_DISABLED: 'Esta cuenta está desactivada en Firebase.',
  TOKEN_EXPIRED: 'La sesión venció. Vuelve a iniciar sesión.',
  INVALID_REFRESH_TOKEN: 'La sesión venció. Vuelve a iniciar sesión.'
};

/** Lee apiKey, databaseURL y projectId del bloque firebaseConfig pegado tal cual. */
function parseConfig(input) {
  const text = typeof input === 'string' ? input : JSON.stringify(input || {});
  const pick = key => text.match(new RegExp('["\']?' + key + '["\']?\\s*:\\s*["\']([^"\']+)["\']'))?.[1]?.trim();
  const config = { apiKey: pick('apiKey'), databaseURL: pick('databaseURL'), projectId: pick('projectId') };
  if (!/^AIza[\w-]{30,45}$/.test(config.apiKey || '')) throw Error('No encontré una apiKey válida en la configuración');
  let url;
  try { url = new URL(config.databaseURL); } catch { throw Error('Falta databaseURL: crea la Realtime Database y copia de nuevo la configuración'); }
  if (url.protocol !== 'https:' || url.username || url.password ||
      !/(^|\.)(firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname)) throw Error('databaseURL debe ser una dirección de Firebase');
  config.databaseURL = url.origin;
  if (!/^[a-z0-9-]{4,40}$/.test(config.projectId || '')) throw Error('No encontré el projectId en la configuración');
  return config;
}

/** Claves válidas para Realtime Database (sin . $ # [ ] /). */
function safeKey(value) {
  return String(value).replace(/[.$#[\]/\u0000-\u001f\u007f]/g, '_').slice(0, 700) || '_';
}

const stamp = at => safeKey(String(at).replace(/[.:]/g, '-'));

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || typeof item === 'function') continue;
      out[safeKey(key)] = clean(item);
    }
    return out;
  }
  return typeof value === 'number' && !Number.isFinite(value) ? null : value;
}

function createCloud(root, vault, fetchImpl = globalThis.fetch) {
  const state = () => production.readState(root, STATE, {});
  const save = patch => production.writeState(root, STATE, { ...state(), ...patch });
  let session = null;
  let syncing = null;

  async function call(url, { method = 'GET', body, form } = {}) {
    const response = await fetchImpl(url, {
      method, signal: AbortSignal.timeout(TIMEOUT),
      headers: form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : body ? { 'Content-Type': 'application/json' } : {},
      body: form ? new URLSearchParams(form).toString() : body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
    if (!response.ok) {
      const code = String(data?.error?.message || data?.error || '').split(/[ :]/)[0];
      if (response.status === 401 || /permission denied/i.test(String(data?.error))) {
        throw Error('Firebase rechazó el acceso. Pega en Realtime Database → Reglas las reglas que muestra Studio.');
      }
      if (/^404/.test(String(response.status)) && /firebaseio|firebasedatabase/.test(url)) throw Error('No se encontró la Realtime Database del proyecto');
      throw Error(AUTH_ERRORS[code] || 'Firebase respondió ' + response.status + (code ? ' · ' + code : ''));
    }
    return data;
  }

  function storeSecret(refreshToken) {
    if (!vault.isEncryptionAvailable()) throw Error('El sistema no ofrece cifrado seguro para guardar la sesión');
    production.writeState(root, SECRET, { cipher: vault.encryptString(refreshToken).toString('base64') });
  }

  function readSecret() {
    const saved = production.readState(root, SECRET, null);
    if (!saved?.cipher) throw Error('Conecta Firebase en Estadísticas → Conexiones');
    try { return vault.decryptString(Buffer.from(saved.cipher, 'base64')); }
    catch { throw Error('La sesión de Firebase está cifrada para otro equipo. Vuelve a iniciar sesión.'); }
  }

  async function token() {
    const current = state();
    if (!current.uid) throw Error('Conecta Firebase en Estadísticas → Conexiones');
    if (session && session.expires - Date.now() > 120000) return session.idToken;
    const data = await call('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(current.apiKey),
      { method: 'POST', form: { grant_type: 'refresh_token', refresh_token: readSecret() } });
    if (data.user_id !== current.uid) throw Error('La sesión de Firebase pertenece a otro usuario');
    if (data.refresh_token) storeSecret(data.refresh_token);
    session = { idToken: data.id_token, expires: Date.now() + Number(data.expires_in || 3600) * 1000 };
    return session.idToken;
  }

  async function write(path, value, method = 'PATCH') {
    const { databaseURL, uid } = state();
    const url = databaseURL + '/users/' + encodeURIComponent(uid) + (path ? '/' + path : '') + '.json?auth=' + encodeURIComponent(await token());
    return call(url, { method, body: value });
  }

  async function connect({ config, email, password, create }) {
    const parsed = parseConfig(config);
    email = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('Escribe un correo válido');
    if (String(password || '').length < 6) throw Error('La contraseña debe tener al menos 6 caracteres');
    const endpoint = create ? 'accounts:signUp' : 'accounts:signInWithPassword';
    const data = await call('https://identitytoolkit.googleapis.com/v1/' + endpoint + '?key=' + encodeURIComponent(parsed.apiKey),
      { method: 'POST', body: { email, password, returnSecureToken: true } });
    storeSecret(data.refreshToken);
    production.writeState(root, STATE, { ...parsed, email: data.email || email, uid: data.localId, connectedAt: new Date().toISOString(),
      lastSyncAt: null, lastError: '' });
    session = { idToken: data.idToken, expires: Date.now() + Number(data.expiresIn || 3600) * 1000 };
    // Comprueba en el momento que las reglas permiten escribir en la carpeta del usuario.
    try {
      await write('perfil', { app: '11 Récords Studio', email: data.email || email, conectado: new Date().toISOString() });
    } catch (error) {
      disconnect();
      throw error;
    }
    return status();
  }

  function disconnect() {
    session = null;
    production.writeState(root, SECRET, null);
    production.writeState(root, STATE, {});
    return status();
  }

  function status() {
    const { email, projectId, databaseURL, lastSyncAt, lastError, lastCount, connectedAt } = state();
    return { connected: Boolean(email && databaseURL && production.readState(root, SECRET, null)?.cipher),
      email: email || '', projectId: projectId || '', databaseURL: databaseURL || '', lastSyncAt: lastSyncAt || null,
      lastError: lastError || '', lastCount: lastCount || 0, connectedAt: connectedAt || null, syncing: Boolean(syncing), rules: RULES };
  }

  /** Construye la actualización: videos (última cifra), mediciones nuevas, cuentas y crecimiento. */
  function updates({ rows, growth, accounts }, since) {
    const out = {};
    for (const row of rows) {
      if (!row.network || row.externalId == null) continue;
      const key = safeKey(row.network + '_' + row.externalId);
      out['videos/' + key] = clean({ network: row.network, externalId: String(row.externalId), title: row.title || '',
        url: row.url || null, publishedAt: row.publishedAt || null, format: row.format || null, duration: row.duration ?? null,
        metrics: row.metrics || {}, metricsAt: row.metricsAt || null, source: row.metricsSource || null,
        tags: row.tags || null, record: row.target?.id || null });
      for (const point of row.history || []) {
        if (!point.at || (since && point.at <= since)) continue;
        out['mediciones/' + key + '/' + stamp(point.at)] = clean({ at: point.at, source: point.source || null, metrics: point.metrics || {} });
      }
    }
    for (const [network, list] of Object.entries(growth || {})) {
      for (const entry of list || []) if (!since || entry.at > since || entry.day >= since.slice(0, 10)) {
        out['crecimiento/' + safeKey(network) + '/' + safeKey(entry.day)] = clean(entry);
      }
    }
    for (const [network, identity] of Object.entries(accounts || {})) {
      if (identity) out['cuentas/' + safeKey(network)] = clean({ label: identity.label || '', followers: identity.followers ?? null });
    }
    out['perfil/ultimaSincronizacion'] = new Date().toISOString();
    return out;
  }

  async function sync(data) {
    if (!status().connected) return { skipped: true };
    if (syncing) return syncing;
    syncing = (async () => {
      const since = state().lastSyncAt;
      const startedAt = new Date().toISOString();
      try {
        const entries = Object.entries(updates(data, since));
        for (let i = 0; i < entries.length; i += BATCH) await write('', Object.fromEntries(entries.slice(i, i + BATCH)));
        save({ lastSyncAt: startedAt, lastError: '', lastCount: entries.length });
        return { count: entries.length };
      } catch (error) {
        save({ lastError: String(error.message).slice(0, 300) });
        throw error;
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  }

  return { connect, disconnect, status, sync, rules: () => RULES };
}

module.exports = { createCloud, parseConfig, safeKey, RULES };
