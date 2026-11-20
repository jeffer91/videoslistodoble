'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const media = require('../backend/media.cjs'), editing = require('../backend/editing.cjs');
const master = require('../backend/master-audio.cjs'), voice = require('../backend/voice-audio.cjs');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), '11r-voz-'));
function ff(file, args) {
  const result = spawnSync(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', ...args, file], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
  return file;
}
// «Voz» sintética: tonos con pausas, sobre ruido rosa y zumbido de 60 Hz.
function noisyTake(root, name = 'toma.mp4') {
  return ff(path.join(root, name), ['-f', 'lavfi', '-i', 'color=c=navy:s=160x120:r=15:d=6',
    '-f', 'lavfi', '-i', "aevalsrc='0.35*sin(2*PI*220*t)*sin(2*PI*1.3*t)*gt(sin(2*PI*0.4*t),-0.3)':s=48000:d=6",
    '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.06:r=48000:d=6', '-f', 'lavfi', '-i', 'sine=f=60:r=48000:d=6',
    '-filter_complex', '[1][2][3]amix=inputs=3:normalize=0[a]', '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
}
async function lufs(file) {
  const { stderr } = await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
  return master.readMeasure(stderr);
}

test('perfiles de voz: locutor por defecto, cadena completa y reductor clásico si falta la IA', () => {
  assert.equal(editing.effectiveScene({ scenes: { hook: { video: 'v' } } }, 'hook').voice, 'locutor');
  const chain = editing.voiceFilter('locutor');
  for (const part of ['highpass', 'deesser', 'acompressor', 'equalizer=f=4200', 'alimiter']) assert.match(chain, new RegExp(part));
  assert.doesNotMatch(chain, /afftdn/, 'con IA no se añade el reductor clásico');
  assert.match(editing.voiceFilter('locutor', true), /^,afftdn/);
  assert.equal(editing.voiceFilter('original', true), '');
  assert.equal(voice.attenuation('locutor', { level: 'alto' }) > voice.attenuation('locutor', { level: 'bajo' }), true);
  assert.ok(voice.attenuation('natural', { level: 'alto' }) < voice.attenuation('locutor', { level: 'alto' }));
  assert.throws(() => voice.samplePath('/tmp', '../x', 'hook', 'antes'), /desconocida/);
  assert.throws(() => voice.samplePath('/tmp', 'p1', 'hook', 'otro'), /desconocida/);
});

test('el análisis detecta ruido alto y la limpieza sin IA conserva la toma y avisa', { timeout: 60000 }, async () => {
  const root = dir();
  const previous = process.env.RECORDS_DEEPFILTER;
  process.env.RECORDS_DEEPFILTER = '';
  try {
    const take = noisyTake(root);
    const report = await voice.analyze(take);
    assert.equal(report.level, 'alto');
    assert.match(report.notes.join(' '), /Ruido de fondo alto/);
    const result = await voice.cleanVoice(root, take, 'locutor');
    assert.equal(result.file, take);
    assert.equal(result.fallback, true);
    assert.deepEqual(await voice.cleanVoice(root, take, 'original'), { file: take, fallback: false });
  } finally {
    if (previous === undefined) delete process.env.RECORDS_DEEPFILTER; else process.env.RECORDS_DEEPFILTER = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('el volumen final queda en −14 LUFS con y sin música', { timeout: 120000 }, async () => {
  const root = dir();
  try {
    const take = noisyTake(root);
    const song = ff(path.join(root, 'musica.wav'), ['-f', 'lavfi', '-i', 'sine=f=330:r=48000:d=3,volume=0.4']);
    for (const music of [null, song]) {
      const output = path.join(root, music ? 'con.mp4' : 'sin.mp4');
      await master.render(take, output, { speed: 1, musicLevel: 18 }, music);
      const measured = await lufs(output);
      assert.ok(Math.abs(measured + 14) <= 0.6, (music ? 'con música ' : 'sin música ') + measured + ' LUFS');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const DEEPFILTER = process.env.RECORDS_DEEPFILTER;
test('con DeepFilterNet la voz limpia baja mucho el ruido y se guarda en caché', { skip: DEEPFILTER ? false : 'Define RECORDS_DEEPFILTER para probar la IA', timeout: 120000 }, async () => {
  const root = dir();
  try {
    const take = noisyTake(root);
    const before = await voice.analyze(take);
    const result = await voice.cleanVoice(root, take, 'locutor');
    assert.equal(result.fallback, false, result.error);
    const after = await voice.analyze(result.file);
    assert.ok(after.noise < before.noise - 12, before.noise + ' → ' + after.noise);
    assert.equal((await voice.cleanVoice(root, take, 'locutor')).cached, true);
    assert.equal((await media.probe(result.file)).hasAudio, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
