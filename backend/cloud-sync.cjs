'use strict';
/**
 * Copia en la nube de las estadísticas: Firebase Realtime Database, sin cuentas
 * ni inicio de sesión.
 *
 * - Basta con pegar la configuración del proyecto.
 * - Studio genera una clave de datos secreta y guarda todo en estudios/<clave>.
 * - Las reglas recomendadas solo abren esa ruta: quien no conozca la clave no
 *   puede leer ni borrar nada. Se puede usar la misma clave en otro equipo.
 * - Los datos locales siguen siendo la fuente principal: la nube es copia.
 */
const { randomBytes } = require('node:crypto');
const production = require('./production.cjs');

const STATE = 'nube';
const SECRET = 'nube-secreto';
const TIMEOUT = 30000;
const BATCH = 1500;
const KEY = /^[A-Za-z0-9_-]{24,64}$/;

/** Reglas que solo abren la carpeta de esta clave; el resto queda cerrado. */
function rulesFor(key) {
  return JSON.stringify({ rules: { estudios: { [key || 'TU_CLAVE']: { '.read': true, '.write': true } } } }, null, 2);
}
const OPEN_RULES = JSON.stringify({ rules: { '.read': true, '.write': true } }, null, 2);

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
  const state = () => production.readState(root, STATE, {}) || {};
  const save = patch => production.writeState(root, STATE, { ...state(), ...patch });
  let syncing = null;

  async function call(url, { method = 'GET', body } = {}) {
    const response = await fetchImpl(url, {
      method, signal: AbortSignal.timeout(TIMEOUT),
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || /permission denied/i.test(String(data?.error))) {
        throw Error('Firebase rechazó el acceso: pega en Realtime Database → Reglas las reglas que muestra Studio y pulsa Publicar.');
      }
      if (response.status === 404) throw Error('No se encontró la Realtime Database del proyecto. Revisa databaseURL.');
      throw Error('Firebase respondió ' + response.status + (data?.error ? ' · ' + String(data.error).slice(0, 120) : ''));
    }
    return data;
  }

  function storeKey(key) {
    const cipher = vault.isEncryptionAvailable() ? vault.encryptString(key).toString('base64') : null;
    production.writeState(root, SECRET, cipher ? { cipher } : { plain: key });
  }

  function dataKey() {
    const saved = production.readState(root, SECRET, null);
    if (!saved) throw Error('Conecta Firebase en Estadísticas → Conexiones');
    if (saved.plain) return saved.plain;
    try { return vault.decryptString(Buffer.from(saved.cipher, 'base64')); }
    catch { throw Error('La clave de Firebase está cifrada para otro equipo. Conéctalo de nuevo con tu clave de datos.'); }
  }

  async function write(path, value, method = 'PATCH') {
    const { databaseURL } = state();
    return call(databaseURL + '/estudios/' + dataKey() + (path ? '/' + path : '') + '.json', { method, body: value });
  }

  /** Conecta con la configuración pegada. Sin cuentas: la clave identifica tus datos. */
  async function connect({ config, key }) {
    const parsed = parseConfig(config);
    key = String(key || '').trim();
    if (key && !KEY.test(key)) throw Error('La clave de datos debe tener entre 24 y 64 letras, números, - o _');
    const previous = state();
    let reuse = '';
    try { reuse = previous.databaseURL === parsed.databaseURL ? dataKey() : ''; } catch { reuse = ''; }
    const chosen = key || reuse || randomBytes(24).toString('base64url');
    storeKey(chosen);
    production.writeState(root, STATE, { ...parsed, connectedAt: new Date().toISOString(), lastSyncAt: null, lastError: '' });
    try {
      // Comprueba en el momento que las reglas permiten escribir en la carpeta.
      await write('perfil', { app: '11 Récords Studio', conectado: new Date().toISOString() });
    } catch (error) {
      save({ lastError: String(error.message).slice(0, 300) });
      throw error;
    }
    return status();
  }

  function disconnect() {
    production.writeState(root, SECRET, null);
    production.writeState(root, STATE, {});
    return status();
  }

  function status() {
    const { projectId, databaseURL, lastSyncAt, lastError, lastCount, connectedAt } = state();
    let key = '';
    try { key = databaseURL ? dataKey() : ''; } catch { key = ''; }
    return { connected: Boolean(databaseURL && key), projectId: projectId || '', databaseURL: databaseURL || '', key,
      lastSyncAt: lastSyncAt || null, lastError: lastError || '', lastCount: lastCount || 0, connectedAt: connectedAt || null,
      syncing: Boolean(syncing), rules: rulesFor(key), openRules: OPEN_RULES };
  }

  /** Construye la actualización: videos (última cifra), mediciones nuevas, cuentas y crecimiento. */
  function updates({ rows, growth, accounts, group }, since) {
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
    if (group?.latest) {
      out['grupo/actual'] = clean(group.latest);
      for (const point of group.history || []) if (!since || point.day >= since.slice(0, 10)) out['grupo/historial/' + safeKey(point.day)] = clean(point);
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

  return { connect, disconnect, status, sync };
}

module.exports = { createCloud, parseConfig, safeKey, rulesFor, OPEN_RULES };
