'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { classify, seconds, catalog } = require('../backend/video-statistics.cjs');
const { createPublishing } = require('../backend/publishing.cjs');
const store = require('../backend/store.cjs');

const vault = { isEncryptionAvailable: () => true, encryptString: v => Buffer.from(v), decryptString: v => v.toString() };

function withRoot(fn) {
  return async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-section-'));
    try { store.ensureRoot(root); await fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
  };
}

test('las duraciones de YouTube, TikTok y Facebook se leen en segundos', () => {
  assert.equal(seconds('PT59S'), 59);
  assert.equal(seconds('PT2M30S'), 150);
  assert.equal(seconds('PT1H2M'), 3720);
  assert.equal(seconds(45), 45);
  assert.equal(seconds('12.5'), 12.5);
  assert.equal(seconds('P0D'), null);
  assert.equal(seconds('desconocida'), null);
});

test('cada publicación se clasifica como Short o video largo', () => {
  assert.equal(classify({ target: { kind: 'short' }, duration: 'PT12M' }), 'short');
  assert.equal(classify({ target: { kind: 'week' }, duration: 'PT30S' }), 'long');
  assert.equal(classify({ url: 'https://www.youtube.com/shorts/abc' }), 'short');
  assert.equal(classify({ url: 'https://www.instagram.com/reel/abc/' }), 'short');
  assert.equal(classify({ format: 'REELS' }), 'short');
  assert.equal(classify({ format: 'video_reels', duration: 600 }), 'short');
  assert.equal(classify({ duration: 'PT3M' }), 'short');
  assert.equal(classify({ duration: 'PT3M1S' }), 'long');
  assert.equal(classify({ format: 'videos' }), 'long');
  assert.equal(classify({ title: 'Sin datos' }), null);
});

test('Instagram con inicio de sesión de Instagram consulta graph.instagram.com sin página de Facebook', async () => {
  const calls = [];
  const request = async url => {
    calls.push(url);
    if (url.endsWith('/media')) return { data: [{ id: '5', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://www.instagram.com/reel/x/' }] };
    return { data: [{ name: 'views', total_value: { value: 77 } }] };
  };
  const rows = [];
  for await (const page of catalog(request, 'https://graph.instagram.com/v24.0', 'instagram', { identity: { id: '1784' }, provider: 'instagram-login' })) rows.push(...page.videos);
  assert.ok(calls.every(url => url.startsWith('https://graph.instagram.com/')));
  assert.equal(rows[0].metrics.views, 77);
  assert.equal(classify(rows[0]), 'short');
});

test('la conexión de Instagram por token guarda vencimiento, se prueba y se renueva antes de caducar', withRoot(async root => {
  const seen = [];
  const platform = {
    verifyAccount: async (network, account) => { seen.push(account.provider); return { id: '1784', label: '@records', followers: 10 }; },
    refresh: async (network, account) => ({ ...account, accessToken: 'nuevo', expiresAt: new Date(Date.now() + 60 * 86400000).toISOString() }),
    async *catalogPages() { yield { videos: [{ externalId: '1', metrics: { views: 3 } }, { externalId: '2', metrics: { views: 4 } }] }; }
  };
  const p = createPublishing(root, vault, platform);
  await p.connect('instagram', { provider: 'instagram-login', accessToken: 'IGAA-token' });
  assert.deepEqual(seen, ['instagram-login']);
  const details = p.accountDetails();
  assert.equal(details.instagram.provider, 'instagram-login');
  assert.ok(Date.parse(details.instagram.expiresAt) > Date.now() + 50 * 86400000);
  assert.equal(details.youtube, null);
  const result = await p.testAccount('instagram');
  assert.equal(result.label, '@records');
  assert.equal(result.videos, 2);
  // A falta de seis días, Studio renueva el token sin esperar a que venza.
  await p.connect('instagram', { provider: 'instagram-login', accessToken: 'IGAA-viejo', expiresAt: new Date(Date.now() + 6 * 86400000).toISOString() });
  assert.equal((await p.accountFor('instagram')).accessToken, 'nuevo');
}));

test('si la renovación de Instagram falla, se sigue usando el token vigente', withRoot(async root => {
  const platform = {
    verifyAccount: async () => ({ id: '1784', label: '@records' }),
    refresh: async () => { throw Error('Token demasiado reciente'); }
  };
  const p = createPublishing(root, vault, platform);
  await p.connect('instagram', { provider: 'instagram-login', accessToken: 'vigente', expiresAt: new Date(Date.now() + 3 * 86400000).toISOString() });
  assert.equal((await p.accountFor('instagram')).accessToken, 'vigente');
}));

test('el inicio de sesión de Instagram no se acepta para otras redes', withRoot(async root => {
  const p = createPublishing(root, vault, { verifyAccount: async () => ({ id: '1', label: 'x' }) });
  await assert.rejects(p.connect('facebook', { provider: 'instagram-login', accessToken: 'x' }), /solo sirve para Instagram/);
}));

test('las estadísticas entregan el formato de cada video', withRoot(async root => {
  const platform = {
    verifyAccount: async () => ({ id: 'canal', label: 'Canal' }),
    async *catalogPages() {
      yield { videos: [
        { externalId: 'aaaaaaaaaaa', title: 'Short', duration: 'PT45S', metrics: { views: 10 } },
        { externalId: 'bbbbbbbbbbb', title: 'Compilación', duration: 'PT9M', metrics: { views: 20 } }
      ] };
    }
  };
  const p = createPublishing(root, vault, platform);
  await p.connect('youtube', { accessToken: 'token' });
  await p.refreshStats();
  const byTitle = Object.fromEntries(p.stats().map(row => [row.title, row.format]));
  assert.deepEqual(byTitle, { Short: 'short', Compilación: 'long' });
}));

test('la sección de Estadísticas está separada y enlazada en la interfaz', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /statistics\.css/);
  assert.ok(html.indexOf('statistics.js') > html.indexOf('studio-workflow.js'));
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'statistics.js'), 'utf8');
  for (const tab of ['Resumen', 'Videos', 'Conexiones', 'Lector de navegador']) assert.match(source, new RegExp("'" + tab + "'"));
  const workflow = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'studio-workflow.js'), 'utf8');
  assert.doesNotMatch(workflow, /statsPage|accountModal/);
});
