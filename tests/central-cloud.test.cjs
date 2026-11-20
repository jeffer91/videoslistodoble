'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { buildCentral, recordKey, momentum } = require('../backend/insights.cjs');
const { createCloud, parseConfig, safeKey, rulesFor, OPEN_RULES } = require('../backend/cloud-sync.cjs');
const { createPublishing } = require('../backend/publishing.cjs');
const store = require('../backend/store.cjs');

const DAY = 86400000, NOW = Date.parse('2026-11-19T20:00:00Z');
const vault = { isEncryptionAvailable: () => true, encryptString: v => Buffer.from('enc:' + v), decryptString: v => v.toString().slice(4) };

function sample() {
  const rows = [];
  const base = { youtube: 5000, tiktok: 15000, instagram: 6000, facebook: 2000 };
  const titles = ['Messi y su récord imposible en el Mundial', 'Pelé y los mil goles de su carrera', 'El portero que marcó goles de tiro libre'];
  for (const network of Object.keys(base)) for (let k = 0; k < 6; k++) {
    const views = base[network] * (k === 0 ? 4 : 1);
    rows.push({ id: network + k, network, title: titles[k % 3] + (k > 2 ? ' parte dos' : ''), format: k % 2 ? 'short' : 'long',
      publishedAt: new Date(NOW - (k + 3) * DAY).toISOString(), metrics: { views, likes: views / 20, comments: 5, shares: 2 },
      tags: { tipos: [k % 2 ? 'Goles' : 'Porteros'] },
      history: [{ at: new Date(NOW - 2 * DAY).toISOString(), metrics: { views: views - 1000 } }, { at: new Date(NOW - DAY).toISOString(), metrics: { views } }] });
  }
  return rows;
}

const tempRoot = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'central-')); store.ensureRoot(root); return root; };

test('la central compara redes, junta el mismo récord y saca conclusiones', () => {
  const growth = { instagram: [{ day: '2026-10-15', followers: 9000 }, { day: '2026-11-19', followers: 9300 }] };
  const central = buildCentral(sample(), growth, NOW);
  const tiktok = central.networks.find(n => n.network === 'tiktok');
  assert.equal(tiktok.videos, 6);
  assert.equal(tiktok.median, 15000);
  assert.equal(central.networks.find(n => n.network === 'instagram').followers30.change, 300);
  assert.ok(central.crossPosts.length >= 3);
  assert.equal(central.crossPosts[0].winner, 'tiktok');
  assert.equal(Object.keys(central.crossPosts[0].networks).length, 4);
  assert.ok(central.outliers.every(o => o.ratio >= 2.5));
  const titles = central.insights.map(i => i.title);
  assert.ok(titles.includes('TikTok es tu red más fuerte'));
  assert.ok(titles.includes('Instagram está creciendo'));
  assert.ok(titles.some(t => t.startsWith('Con el mismo récord, gana TikTok')));
});

test('la clave del récord ignora hashtags, acentos y signos', () => {
  assert.equal(recordKey({ title: '¡Pelé y los MIL goles de su carrera! #futbol #records' }), recordKey({ title: 'Pele y los mil goles de su carrera' }));
  assert.equal(recordKey({ title: 'Gol' }), null);
  assert.equal(recordKey({ title: 'x', target: { id: 'abc' } }), 'p:abc');
});

test('un video sube cuando gana vistas entre las dos últimas lecturas', () => {
  const move = momentum({ history: [{ at: '2026-11-17T00:00:00Z', metrics: { views: 100 } }, { at: '2026-11-19T00:00:00Z', metrics: { views: 500 } }] });
  assert.equal(move.gained, 400);
  assert.equal(move.perDay, 200);
  assert.equal(momentum({ history: [{ at: '2026-11-19T00:00:00Z', metrics: { views: 5 } }] }), null);
});

test('cada lectura deja una foto diaria con seguidores y vistas por red', async () => {
  const root = tempRoot();
  try {
    const platform = { verifyAccount: async () => ({ id: 'c', label: 'Canal', followers: 100 }),
      async *catalogPages() { yield { videos: [{ externalId: 'aaaaaaaaaaa', metrics: { views: 50, followers: 120 } }] }; } };
    const p = createPublishing(root, vault, platform);
    await p.connect('youtube', { accessToken: 't' });
    await p.refreshStats();
    p.accountReading('instagram', { followers: 900 });
    const growth = p.growth();
    assert.equal(growth.youtube.at(-1).followers, 120);
    assert.equal(growth.youtube.at(-1).views, 50);
    assert.equal(growth.instagram.at(-1).followers, 900);
    p.snapshotAccounts();
    assert.equal(p.growth().youtube.length, 1, 'una sola foto por día');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('la configuración de Firebase se lee del bloque pegado y rechaza direcciones ajenas', () => {
  const config = parseConfig(`const firebaseConfig = {
    apiKey: "AIzaSyB8zLRktgL_S8EduHcr3KPL_o64S9mTXJo",
    authDomain: "videos-f0371.firebaseapp.com",
    databaseURL: "https://videos-f0371-default-rtdb.firebaseio.com",
    projectId: "videos-f0371" };`);
  assert.equal(config.projectId, 'videos-f0371');
  assert.equal(config.databaseURL, 'https://videos-f0371-default-rtdb.firebaseio.com');
  assert.throws(() => parseConfig('apiKey: "AIzaSyB8zLRktgL_S8EduHcr3KPL_o64S9mTXJo", databaseURL: "https://evil.example.com", projectId: "x1234"'), /Firebase/);
  assert.throws(() => parseConfig('{}'), /apiKey/);
  assert.equal(safeKey('tiktok_a.b#c$d[e]f/g'), 'tiktok_a_b_c_d_e_f_g');
  const rules = JSON.parse(rulesFor('clave-secreta-de-prueba-1234'));
  assert.deepEqual(rules.rules.estudios['clave-secreta-de-prueba-1234'], { '.read': true, '.write': true });
  assert.equal(rules.rules['.read'], undefined, 'la raíz queda cerrada');
  assert.equal(JSON.parse(OPEN_RULES).rules['.write'], true);
});

const CONFIG = '{ apiKey: "AIzaSyB8zLRktgL_S8EduHcr3KPL_o64S9mTXJo", databaseURL: "https://videos-f0371-default-rtdb.firebaseio.com", projectId: "videos-f0371" }';
const DB = 'https://videos-f0371-default-rtdb.firebaseio.com';

test('Firebase sin inicio de sesión: genera una clave, la guarda cifrada y sube solo lo nuevo', async () => {
  const root = tempRoot();
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 200, text: async () => '{}' };
  };
  try {
    const cloud = createCloud(root, vault, fakeFetch);
    const status = await cloud.connect({ config: CONFIG });
    assert.equal(status.connected, true);
    assert.match(status.key, /^[A-Za-z0-9_-]{32}$/);
    assert.ok(!calls.some(c => /identitytoolkit|securetoken|auth=/.test(c.url)), 'no usa Authentication');
    assert.equal(calls[0].url, DB + '/estudios/' + status.key + '/perfil.json');
    assert.match(status.rules, new RegExp(status.key));
    const saved = fs.readFileSync(path.join(root, 'Configuracion', 'nube-secreto.json'), 'utf8');
    assert.ok(!saved.includes(status.key), 'la clave no se guarda en texto plano');

    const rows = [{ network: 'tiktok', externalId: '73', title: 'Récord', metrics: { views: 9 }, rawMetrics: { views: '9' },
      history: [{ at: '2026-11-18T10:00:00.000Z', metrics: { views: 5 } }, { at: '2026-11-19T10:00:00.000Z', metrics: { views: 9 } }] }];
    const result = await cloud.sync({ rows, growth: { tiktok: [{ day: '2026-11-19', at: '2026-11-19T10:00:00.000Z', followers: 10 }] }, accounts: {} });
    const sent = calls.at(-1);
    assert.equal(sent.method, 'PATCH');
    assert.equal(sent.url, DB + '/estudios/' + status.key + '.json');
    assert.equal(sent.body['videos/tiktok_73'].metrics.views, 9);
    assert.equal(sent.body['videos/tiktok_73'].rawMetrics, undefined);
    assert.ok(sent.body['mediciones/tiktok_73/2026-11-19T10-00-00-000Z']);
    assert.ok(sent.body['crecimiento/tiktok/2026-11-19']);
    assert.ok(result.count > 3);

    rows[0].history.push({ at: new Date(Date.now() + 1000).toISOString(), metrics: { views: 12 } });
    await cloud.sync({ rows, growth: {}, accounts: {} });
    assert.equal(Object.keys(calls.at(-1).body).filter(k => k.startsWith('mediciones/')).length, 1, 'no repite mediciones');

    // Reconectar al mismo proyecto conserva la clave; otro equipo puede usar la misma clave.
    assert.equal((await cloud.connect({ config: CONFIG })).key, status.key);
    const other = createCloud(tempRoot(), vault, fakeFetch);
    assert.equal((await other.connect({ config: CONFIG, key: status.key })).key, status.key);
    await assert.rejects(other.connect({ config: CONFIG, key: 'corta' }), /clave de datos/);
    cloud.disconnect();
    assert.equal(cloud.status().connected, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('si las reglas rechazan el acceso, Studio queda conectado y muestra qué reglas pegar', async () => {
  const root = tempRoot();
  try {
    const denied = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: 'Permission denied' }) });
    const cloud = createCloud(root, vault, denied);
    await assert.rejects(cloud.connect({ config: CONFIG }), /Reglas/);
    const status = cloud.status();
    assert.equal(status.connected, true);
    assert.match(status.lastError, /Reglas/);
    assert.match(status.rules, new RegExp(status.key));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('el grupo de Facebook guarda una foto por día con miembros y actividad, y sube a Firebase', async () => {
  const root = tempRoot();
  try {
    const p = createPublishing(root, vault, {});
    assert.equal(p.groupStats(), null);
    assert.throws(() => p.groupReading({ members: 'muchos' }), /cifras/);
    p.groupReading({ members: 20000, name: '11 records', url: 'https://www.facebook.com/groups/11contra11' }, new Date('2026-11-10T10:00:00Z'));
    p.groupReading({ members: 20300 }, new Date('2026-11-18T10:00:00Z'));
    p.groupReading({ members: 20400, newMembers: 312, posts: 48, reactions: 5300 }, new Date('2026-11-19T09:00:00Z'));
    p.groupReading({ members: 20410, newMembers: 315 }, new Date('2026-11-19T21:00:00Z'));
    const group = p.groupStats();
    assert.equal(group.history.length, 3, 'una foto por día');
    assert.equal(group.latest.members, 20410);
    assert.equal(group.latest.name, '11 records');
    assert.equal(group.change, 410);
    assert.equal(group.week, 110);
    const writes = [];
    const cloud = createCloud(root, vault, async (url, options) => { writes.push({ url, body: options.body && JSON.parse(options.body) }); return { ok: true, status: 200, text: async () => '{}' }; });
    await cloud.connect({ config: CONFIG });
    await cloud.sync({ rows: [], growth: {}, accounts: {}, group });
    const sent = Object.assign({}, ...writes.map(item => item.body || {}));
    assert.equal(sent['grupo/actual'].members, 20410);
    assert.equal(sent['grupo/historial/2026-11-19'].newMembers, 315);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
