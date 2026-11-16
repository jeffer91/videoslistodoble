'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mobile = require('../backend/mobile-recording.cjs');
const store = require('../backend/store.cjs');
const media = require('../backend/media.cjs');

test('la recepción móvil recupera los bytes confirmados y asigna una sola toma a la escena elegida', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'records-mobile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  store.ensureRoot(root);
  const project = store.createProject(root, { title: 'Toma desde el celular' });
  const other = store.createProject(root, { title: 'Otro récord' });
  const draft = mobile.begin(root, { projectId: project.id, scene: 'body' });
  const source = path.join(root, 'synthetic.mp4');
  await media.command(media.toolPath('ffmpeg'), [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=1.2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1.2',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source
  ]);
  const bytes = fs.readFileSync(source);
  const request = { id: draft.id, size: bytes.length, format: 'mp4' };
  assert.deepEqual(mobile.open(root, request), { offset: 0 });
  const split = Math.floor(bytes.length / 2);
  mobile.append(root, { id: draft.id, offset: 0, data: bytes.subarray(0, split) });
  await assert.rejects(mobile.finish(root, draft.id), /faltan fragmentos/);
  assert.throws(() => mobile.append(root, { id: draft.id, offset: 0, data: bytes }), /fragmento/);
  assert.throws(() => mobile.open(root, { ...request, size: bytes.length + 1 }), /cambió/);
  assert.deepEqual(mobile.open(root, request), { offset: split });
  mobile.append(root, { id: draft.id, offset: split, data: bytes.subarray(split) });

  const saved = await mobile.finish(root, draft.id);
  assert.deepEqual(mobile.open(root, request), { saved });
  assert.deepEqual(await mobile.finish(root, draft.id), saved);
  const result = store.getProject(root, project.id);
  assert.equal(result.scenes.body.video, saved.assetId);
  assert.equal(result.scenes.hook.video, null);
  assert.equal(store.getProject(root, other.id).scenes.body.video, null);
  assert.equal(result.assets.length, 2);
  const original = store.resolveAsset(root, project.id, saved.assetId + '-original');
  const square = await media.probe(store.resolveAsset(root, project.id, saved.assetId));
  assert.deepEqual(fs.readFileSync(original), bytes);
  assert.deepEqual([square.width, square.height, square.hasAudio], [1080, 1080, true]);
  assert.ok(square.duration >= 1);
});
