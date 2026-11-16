'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const store = require('../backend/store.cjs');
const catalog = require('../backend/catalog.cjs');
const production = require('../backend/production.cjs');
const editing = require('../backend/editing.cjs');
const delivery = require('../backend/delivery.cjs');
const reviews = require('../backend/review.cjs');
const media = require('../backend/media.cjs');
const { createPublishing } = require('../backend/publishing.cjs');
const { NetworkError } = require('../backend/network-clients.cjs');

function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'records-studio-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'biblioteca');
  store.ensureRoot(root);
  return { root, dir };
}

async function sample(file, duration = 2, shape = '160x160', codec = 'libx264') {
  await media.command(media.toolPath('ffmpeg'), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x265236:s=' + shape + ':r=30:d=' + duration,
    '-f', 'lavfi', '-i', 'sine=f=440:sample_rate=48000:duration=' + duration,
    '-c:v', codec, '-pix_fmt', 'yuv420p', '-c:a', codec === 'libx264' ? 'aac' : 'libopus', '-shortest', file
  ]);
  return file;
}

test('ideas aprobadas crean una sola ficha, calendario y filtro de fechas', t => {
  const { root } = folder(t);
  const [idea] = production.addIdeas(root, {
    title: 'El más joven', source: 'Acta oficial', date: '2026-11-12', fromClaude: true, tags: { jugadores: 'Lamine Yamal' }
  });
  const result = production.decideIdea(root, { id: idea.id, decision: 'aprobada', plannedDate: '2026-11-16' });
  assert.equal(production.decideIdea(root, { id: idea.id, decision: 'aprobada' }).projectId, result.projectId);
  const [project] = store.listProjects(root);
  assert.equal(project.plannedDate, '2026-11-16');
  assert.equal(project.withClaude, true);
  assert.equal(project.tags.jugadores[0], 'Lamine Yamal');
  assert.equal(catalog.matches(project, { from: '2026-11-15', to: '2026-11-16' }), true);
  assert.equal(catalog.matches(project, { to: '2026-11-15' }), false);
  assert.throws(() => catalog.normalizeDate('2026-11-31'), /Fecha/);
});

test('recupera una toma desde fragmentos confirmados y conserva el original al cuadrar un video', async t => {
  const { root, dir } = folder(t);
  const source = await sample(path.join(dir, 'interrumpida.webm'), 1.25, '160x90', 'libvpx-vp9');
  const bytes = fs.readFileSync(source);
  const project = store.createProject(root, { title: 'Toma recuperada' });
  const draft = production.beginTake(root, { projectId: project.id, scene: 'hook' });
  const slices = [bytes.subarray(0, 1000), bytes.subarray(1000)];
  assert.throws(() => production.appendTake(root, { id: draft.id, sequence: 1, data: slices[1].toString('base64') }), /Fragmento/);
  slices.forEach((buf, sequence) => production.appendTake(root, { id: draft.id, sequence, data: buf.toString('base64') }));
  assert.equal(production.appendTake(root, { id: draft.id, sequence: 1, data: slices[1].toString('base64') }), 2);
  assert.equal(production.listTakes(root, project.id)[0].id, draft.id);
  const saved = await production.keepTake(root, draft.id);
  assert.equal(store.getProject(root, project.id).scenes.hook.video, saved.assetId);
  assert.deepEqual(fs.readFileSync(store.resolveAsset(root, project.id, saved.assetId)), bytes);
  const square = await production.squareClip(root, { projectId: project.id, assetId: saved.assetId });
  const info = await media.probe(store.resolveAsset(root, project.id, square.id));
  assert.deepEqual([info.width, info.height, info.hasAudio], [1080, 1080, true]);
  assert.deepEqual(fs.readFileSync(store.resolveAsset(root, project.id, saved.assetId)), bytes);
  assert.deepEqual(production.listTakes(root, project.id), []);
});

test('respalda biblioteca y excluye accesos cifrados o archivos temporales', async t => {
  const { root, dir } = folder(t);
  const target = path.join(dir, 'copias');
  fs.mkdirSync(target);
  const p = store.createProject(root, { title: 'Biblioteca' });
  production.writeState(root, 'cuentas-cifradas', { test: 'cifrado simulado' });
  assert.throws(() => production.setBackup(root, { directory: path.join(root, 'Respaldos') }), /otra carpeta/);
  production.setBackup(root, { directory: target, hours: 6 });
  assert.equal(production.shouldBackup(root), true);
  const copy = await production.runBackup(root);
  assert.equal(store.getProject(copy.lastPath, p.id).title, p.title);
  assert.equal(fs.existsSync(path.join(copy.lastPath, 'Configuracion', 'cuentas-cifradas.json')), false);
  assert.equal(production.shouldBackup(root), false);
});

test('Whisper JSON importado y plan comparten tiempos de las tomas y descartan cortes de otra toma', t => {
  const words = editing.parseWhisper({ transcription: [{ offsets: { from: 0, to: 1600 },
    text: 'El récord', tokens: [{ text: '[BEG]' }, { text: ' El', offsets: { from: 100, to: 350 } },
      { text: ' ré', offsets: { from: 350, to: 600 } }, { text: 'cord', offsets: { from: 600, to: 850 } }] }] });
  assert.deepEqual(words.map(word => word.text), ['El', 'récord']);
  assert.equal(words[1].end, .85);
  assert.deepEqual(editing.clipsOnOutput(words, [{ start: .35, end: 1 }], 2), [
    { start: 0, end: .25, text: 'récord' }
  ]);
  const { root, dir } = folder(t);
  const file = path.join(dir, 'take.mp4');
  fs.writeFileSync(file, 'Fixture de IDs');
  let p = store.createProject(root, { title: 'Edición' });
  const first = store.importAsset(root, p.id, file);
  const second = store.importAsset(root, p.id, file);
  p = store.getProject(root, p.id);
  p.scenes.body.video = first.id;
  store.saveProject(root, p);
  editing.setTranscript(root, { id: p.id, scene: 'body', assetId: first.id, words });
  p = editing.applyPlan(root, p.id, { version: 1, source: 'claude',
    scenes: { body: { cuts: [{ start: 0, end: .5, mode: 'both' }] } } });
  assert.equal(p.withClaude, true);
  assert.equal(editing.effectiveScene(p, 'body').cuts.length, 1);
  assert.equal(editing.effectiveScene(p, 'body').captions.length, 2);
  p.scenes.body.video = second.id;
  assert.equal(editing.effectiveScene(p, 'body').cuts.length, 0);
  assert.equal(editing.effectiveScene(p, 'body').captions.length, 0);
});

test('renderiza una revisión real, subtítulos y meme, chequea y crea 3 miniaturas', { timeout: 90000 }, async t => {
  const { root, dir } = folder(t);
  process.env.RECORDS_RENDER_TEST_MODE = '1';
  t.after(() => delete process.env.RECORDS_RENDER_TEST_MODE);
  const source = await sample(path.join(dir, 'narracion.mp4'), 2);
  const stickerPath = path.join(dir, 'meme.png');
  await sharp({ create: { width: 250, height: 160, channels: 3, background: '#ee4642' } }).png().toFile(stickerPath);
  let p = store.createProject(root, { title: '100 % de efectividad' });
  const voice = store.importAsset(root, p.id, source);
  const meme = store.importAsset(root, p.id, stickerPath);
  p = store.getProject(root, p.id);
  for (const scene of Object.values(p.scenes)) scene.video = voice.id;
  p.transitions = { hookBody: 'cut', bodyClosing: 'cut', duration: .2 };
  p.effects.sceneTransitionsAuto = false;
  store.saveProject(root, p);
  editing.setTranscript(root, { id: p.id, scene: 'body', assetId: voice.id, words: [
    { start: .22, end: .5, text: 'Récord' }, { start: .52, end: .88, text: 'histórico' }
  ] });
  const plan = { version: 1, voice: 'limpia', scenes: { body: {
    texts: [{ start: 0, end: 1, text: 'Marca histórica' }],
    graphics: [{ start: .45, end: 1.4, text: '100 %' }],
    memes: [{ at: 1, duration: .6, assetId: meme.id }]
  } } };
  p = editing.applyPlan(root, p.id, plan);
  const initial = await reviews.inspect(root, 'short', p.id);
  assert.equal(initial.canExport, false);
  const preview = await reviews.exportApproved(root, 'short', p.id, initial.hash, undefined, undefined, { preview: true });
  assert.equal((await media.probe(preview.file)).hasAudio, true);
  assert.equal(store.getProject(root, p.id).exports.length, 0);
  for (const scene of Object.values(p.scenes)) scene.approved = true;
  store.saveProject(root, p);
  const snapshot = await reviews.inspect(root, 'short', p.id);
  const result = await reviews.exportApproved(root, 'short', p.id, snapshot.hash);
  assert.ok(Math.abs(result.duration - 6.6) < .5, 'duración con la pausa del meme: ' + result.duration);
  assert.equal(result.quality.ok, true, JSON.stringify(result.quality.checks));
  assert.equal(delivery.entryFor(root, result.target).quality.ok, true);
  const thumbnails = await delivery.thumbnails(root, result.target, { time: .5 });
  assert.equal(thumbnails.thumbnails.length, 3);
  for (let choice = 1; choice <= 3; choice++) {
    const image = await sharp(delivery.thumbnailPath(root, result.target, choice)).metadata();
    assert.deepEqual([image.width, image.height], [1280, 720]);
  }
});

test('el aviso usa duración de desarrollo y cortes, con capítulos en orden', async t => {
  const { root, dir } = folder(t);
  const source = path.join(dir, 'largo.mp4');
  await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=green:s=24x24:r=1:d=61', '-c:v', 'libx264', source]);
  const projects = Array.from({ length: 8 }, (_, index) => {
    const p = store.createProject(root, { title: 'Récord ' + index, tags: { clubes: 'Quito' } });
    const item = store.importAsset(root, p.id, source);
    const updated = store.getProject(root, p.id);
    updated.scenes.body.video = item.id;
    updated.scenes.body.end = 23;
    updated.status = 'exported';
    updated.exports = [{ mode: 'short', file: 'ejemplo.mp4' }];
    store.atomic(store.projectFile(root, p.id), updated);
    return updated;
  });
  assert.equal((await production.compilationReadiness(root)).categories.length, 0, 'ocho clips breves no activan el aviso');
  for (const item of projects) {
    item.scenes.body.end = 61;
    store.atomic(store.projectFile(root, item.id), item);
  }
  const ready = await production.compilationReadiness(root);
  assert.equal(ready.weekly, 495);
  assert.equal(ready.categories[0].seconds, 495);
  assert.equal(production.chapterText([{ label: 'Intro', start: 0, duration: 1.2 },
    { label: 'Capítulo 1', start: 65, duration: 60 }, { transition: true, duration: 1 }]), '00:00 Intro\n01:05 Capítulo 1\n');
});

test('la cola conserva autorización, cuenta y huella, y puede registrar métricas sin conexión', async t => {
  const { root } = folder(t);
  const p = store.createProject(root, { title: 'Récord para publicar' });
  const file = p.id + '-4.mp4';
  const destination = path.join(root, 'Exportaciones', 'Shorts', file);
  fs.writeFileSync(destination, 'simulación de render');
  p.exports.push({ file: destination });
  store.atomic(store.projectFile(root, p.id), p);
  const target = { id: p.id, kind: 'short', file };
  const storeCipher = { isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value).reverse(),
    decryptString: buffer => Buffer.from(buffer).reverse().toString() };
  let sends = 0;
  const client = {
    NetworkError,
    verifyAccount: async () => ({ id: 'canal', label: 'Canal de prueba' }),
    publish: { youtube: async ({ checkpoint }) => {
      sends++;
      checkpoint({ id: 'example_123' });
      return { id: 'example_123', url: 'https://www.youtube.com/watch?v=example_123' };
    } }
  };
  const queue = createPublishing(root, storeCipher, client);
  await queue.connect('youtube', { accessToken: 'token-de-prueba-local' });
  const vault = fs.readFileSync(path.join(root, 'Configuracion', 'cuentas-cifradas.json'), 'utf8');
  assert.doesNotMatch(vault, /token-de-prueba-local/);
  assert.equal(queue.accounts().youtube.label, 'Canal de prueba');
  await assert.rejects(queue.enqueue({ target, network: 'youtube', confirmed: true }), /aprueba el MP4/);
  delivery.updateEntry(root, target, { quality: { ok: true }, approval: { sha256: await delivery.fingerprint(destination) } });
  delivery.saveNetwork(root, target, 'youtube', { title: p.title, privacy: 'private', tags: ['fútbol'] });
  await assert.rejects(queue.enqueue({ target, network: 'youtube', confirmed: false }), /confirma/);
  const future = await queue.enqueue({ target, network: 'youtube', confirmed: true, dueAt: '2035-01-01' });
  await queue.tick();
  assert.equal(sends, 0);
  queue.changeJob({ id: future.id, action: 'cancelar' });
  const immediate = await queue.enqueue({ target, network: 'youtube', confirmed: true });
  await queue.tick();
  assert.equal(sends, 1);
  assert.equal(queue.jobsFor(target)[0].status, 'publicado');
  queue.manualStats({ id: immediate.id, values: { views: 1200, retention: 55.5 } });
  assert.equal(queue.stats()[0].metrics.retention, 55.5);
  assert.equal(fs.existsSync(queue.exportStats()), true);
});

test('TikTok conserva todos los dígitos del enlace de publicación devuelto como int64', async t => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  global.fetch = async url => {
    assert.equal(url.pathname, '/v2/post/publish/status/fetch/');
    return new Response('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7293497837799632921]}}');
  };
  const { publish } = require('../backend/network-clients.cjs');
  const result = await publish.tiktok({ account: {}, token: 'simulado', remote: { publishId: 'pendiente', username: 'records' } });
  assert.equal(result.id, '7293497837799632921');
  assert.equal(result.url, 'https://www.tiktok.com/@records/video/7293497837799632921');
});
