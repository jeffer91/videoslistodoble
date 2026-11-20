'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const store = require('../backend/store.cjs');
const delivery = require('../backend/delivery.cjs');
const { createPublishing } = require('../backend/publishing.cjs');
const { createAutopublish, REQUIREMENTS, tagWord } = require('../backend/autopublish.cjs');

const vault = { isEncryptionAvailable: () => true, encryptString: v => Buffer.from(v), decryptString: v => v.toString() };

/** Crea un Short exportado, revisado y aprobado, como lo deja la app. */
function approvedShort(root, title, { duration = 45, width = 1080, height = 1920, tags } = {}) {
  const project = store.createProject(root, { title });
  const dir = path.join(root, 'Exportaciones', 'Shorts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, project.id + '-short.mp4');
  fs.writeFileSync(file, 'video ' + title + crypto.randomUUID());
  const saved = store.getProject(root, project.id);
  saved.exports.push({ at: new Date().toISOString(), mode: 'short', file });
  if (tags) saved.tags = tags;
  store.atomic(store.projectFile(root, project.id), saved);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const target = { kind: 'short', id: project.id, file: path.basename(file) };
  delivery.updateEntry(root, target, { quality: { ok: true, checks: [], duration, width, height, hasAudio: true },
    approval: { at: new Date().toISOString(), sha256: sha } });
  return { project, target, sha };
}

async function setup(platformExtras = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-'));
  store.ensureRoot(root);
  const platform = { verifyAccount: async network => ({ id: network + '-cuenta', label: network }), ...platformExtras };
  const publishing = createPublishing(root, vault, platform);
  for (const network of ['instagram', 'facebook', 'youtube', 'tiktok']) await publishing.connect(network, { accessToken: 'token-' + network, profileId: '123' });
  // Un día fijo a las 08:00 para que los horarios sean predecibles.
  const start = new Date(2026, 10, 20, 8, 0, 0).getTime();
  const auto = createAutopublish(root, publishing, () => start);
  return { root, publishing, auto, start };
}

test('cada red recibe un texto adaptado: #Shorts en YouTube, su cierre propio y límites de hashtags', async () => {
  const { root, auto } = await setup();
  try {
    approvedShort(root, 'El portero que marcó 131 goles', { tags: { jugadores: ['Rogério Ceni'], tipos: ['Porteros'] } });
    const [item] = auto.candidates();
    const cfg = auto.config();
    const yt = auto.adapt(item, 'youtube', cfg), ig = auto.adapt(item, 'instagram', cfg), fb = auto.adapt(item, 'facebook', cfg);
    assert.equal(yt.tags[0], 'Shorts');
    assert.ok(yt.tags.includes('RogerioCeni'));
    assert.ok(ig.tags.includes('Reels'));
    assert.ok(fb.tags.length <= REQUIREMENTS.facebook.hashtags);
    assert.notEqual(yt.description, ig.description, 'no se repite el mismo texto en todas las redes');
    assert.equal(auto.adapt(item, 'tiktok', cfg).mode, 'inbox');
    assert.equal(tagWord('Liga Pro Ecuador'), 'LigaProEcuador');
    // Todos los textos pasan la validación real de cada red.
    for (const network of ['youtube', 'tiktok', 'instagram', 'facebook']) delivery.normalizeNetwork(network, auto.adapt(item, network, cfg));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('no se activa sin autorización y respeta YouTube y TikTok sin auditar', async () => {
  const { root, auto } = await setup();
  try {
    assert.throws(() => auto.saveConfig({ enabled: true }), /autorización/);
    auto.saveConfig({ authorized: true, enabled: true });
    assert.equal(auto.readiness('youtube').ok, false);
    assert.match(auto.readiness('youtube').reason, /auditor/);
    assert.equal(auto.readiness('tiktok').ok, true, 'el modo borrador no necesita auditoría');
    auto.saveConfig({ networks: { tiktok: { mode: 'direct' } } });
    assert.equal(auto.readiness('tiktok').ok, false);
    assert.throws(() => auto.saveConfig({ networks: { instagram: { hours: '25:00' } } }), /12:30/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('programa los videos aprobados en los horarios libres y nunca repite contenido', async () => {
  const { root, auto, publishing, start } = await setup();
  try {
    const a = approvedShort(root, 'Messi y su récord imposible');
    const b = approvedShort(root, 'Pelé y los mil goles');
    approvedShort(root, 'Short de dos minutos', { duration: 120 });
    auto.saveConfig({ authorized: true, enabled: true, networks: {
      instagram: { enabled: true, hours: '12:00, 19:00' }, facebook: { enabled: true, hours: '12:15' } } });
    const first = await auto.plan();
    assert.deepEqual(first.errors, []);
    const jobs = publishing.jobsRaw();
    const ig = jobs.filter(job => job.network === 'instagram');
    // Dos días de horizonte × 2 horarios, pero solo hay 3 videos distintos: cada uno una sola vez.
    assert.equal(ig.length, 3);
    assert.equal(new Set(ig.map(job => job.sha256)).size, 3);
    assert.ok(ig.every(job => job.auto && Date.parse(job.dueAt) > start));
    assert.equal(new Date(ig[0].dueAt).getHours(), 12);
    // Facebook: el mismo video puede ir a otra red, pero también una sola vez allí.
    const fb = jobs.filter(job => job.network === 'facebook');
    assert.equal(fb.length, 3);
    assert.ok(fb.some(job => job.sha256 === a.sha) && fb.some(job => job.sha256 === b.sha));
    // Segunda pasada: no hay nada nuevo que publicar.
    const second = await auto.plan();
    assert.equal(second.created.length, 0);
    assert.equal(publishing.jobsRaw().length, 6);
    // La cola rechaza un envío manual del mismo video a la misma cuenta.
    await assert.rejects(publishing.enqueue({ target: a.target, network: 'instagram', confirmed: true }), /ya está publicado o en la cola/);
    const view = auto.overview();
    assert.equal(view.rows.length, 3);
    assert.ok(view.rows.every(row => row.networks.instagram.state === 'programado'));
    assert.equal(view.rows[0].networks.youtube.state, 'en-espera');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('no publica lo que ya está en la red según las estadísticas ni lo que no cumple sus requisitos', async () => {
  const { root, auto, publishing } = await setup({
    async *catalogPages(network) {
      if (network === 'instagram') yield { videos: [{ externalId: '99', title: 'Messi y su récord imposible #futbol', metrics: { views: 10 } }] };
    }
  });
  try {
    approvedShort(root, 'Messi y su récord imposible');
    approvedShort(root, 'Video horizontal', { width: 1920, height: 1080 });
    await publishing.refreshStats();
    auto.saveConfig({ authorized: true, enabled: true, networks: { instagram: { enabled: true }, youtube: { audited: true, enabled: true } } });
    const view = auto.overview();
    const messi = view.rows.find(row => row.title.startsWith('Messi'));
    assert.equal(messi.networks.instagram.state, 'repetido');
    const horizontal = view.rows.find(row => row.title === 'Video horizontal');
    assert.equal(horizontal.networks.youtube.state, 'no-apto');
    assert.match(horizontal.networks.youtube.reason, /vertical/);
    await auto.plan();
    const jobs = publishing.jobsRaw();
    assert.ok(!jobs.some(job => job.network === 'instagram' && job.metadata.title.startsWith('Messi')));
    assert.ok(!jobs.some(job => job.network === 'youtube' && job.metadata.title === 'Video horizontal'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Facebook publica un Short de hasta 90 s como Reel de la página en tres fases', async () => {
  const clients = require('../backend/network-clients.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-'));
  const file = path.join(dir, 'reel.mp4');
  fs.writeFileSync(file, Buffer.alloc(2048, 1));
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    const href = String(url);
    calls.push({ href, method: options.method, body: options.body instanceof URLSearchParams ? Object.fromEntries(options.body) : null });
    const json = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (href.startsWith('https://rupload.facebook.com/')) { for await (const _ of options.body) { /* consume */ } return json({ success: true }); }
    if (href.includes('/video_reels') && calls.at(-1).body?.upload_phase === 'start') return json({ video_id: '555', upload_url: 'https://rupload.facebook.com/video-upload/v24.0/555' });
    if (href.includes('/video_reels')) return json({ success: true });
    if (href.includes('/555?')) return json({ status: { video_status: 'ready' }, permalink_url: '/reel/555' });
    return json({});
  };
  try {
    const remote = {};
    const context = { account: { identity: { id: '100' } }, token: 'page', file, remote,
      metadata: { title: 'Récord', description: 'Texto', tags: ['Futbol'] }, quality: { duration: 40, width: 1080, height: 1920 },
      checkpoint: fields => Object.assign(remote, fields) };
    assert.deepEqual(await clients.publish.facebook(context), { processing: true });
    assert.equal(calls[0].body.upload_phase, 'start');
    assert.ok(calls[1].href.startsWith('https://rupload.facebook.com/'));
    assert.equal(calls[2].body.upload_phase, 'finish');
    assert.equal(calls[2].body.video_state, 'PUBLISHED');
    assert.match(calls[2].body.description, /#Futbol/);
    const done = await clients.publish.facebook(context);
    assert.equal(done.id, '555');
    assert.equal(done.url, 'https://www.facebook.com/reel/555');
  } finally {
    global.fetch = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
