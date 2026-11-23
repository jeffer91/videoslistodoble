'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../shorts/core.js');

const SR = 48000;
function tone(seconds, amplitude = 0.3, frequency = 220) {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / SR);
  return out;
}
function noise(seconds, amplitude = 0.001) {
  const out = new Float32Array(Math.round(seconds * SR));
  let seed = 7;
  for (let i = 0; i < out.length; i++) { seed = (seed * 16807) % 2147483647; out[i] = amplitude * (seed / 2147483647 * 2 - 1); }
  return out;
}
function concat(...parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

test('shorts: el guion con encabezados se reparte en sus tres escenas', () => {
  const script = core.parseScript('GANCHO: ¿Sabías que Kane marcó 44?\n\n## Desarrollo\nPrimera frase.\nSegunda frase.\n\n**Cierre**\nSíguenos para más récords.');
  assert.equal(script.hook, '¿Sabías que Kane marcó 44?');
  assert.equal(script.body, 'Primera frase.\nSegunda frase.');
  assert.equal(script.closing, 'Síguenos para más récords.');
});

test('shorts: sin encabezados usa el primer y el último párrafo', () => {
  const script = core.parseScript('Gancho fuerte.\n\nDato uno.\n\nDato dos.\n\nCierre final.');
  assert.deepEqual(script, { hook: 'Gancho fuerte.', body: 'Dato uno.\n\nDato dos.', closing: 'Cierre final.' });
  assert.equal(core.parseScript('Solo un texto').body, 'Solo un texto');
});

test('shorts: detecta la voz y elimina los silencios largos con margen', () => {
  const samples = concat(noise(1), tone(1.5), noise(1.2), tone(1), noise(0.2), tone(0.8), noise(1.5));
  const { ranges, speech } = core.detectSpeech(samples, SR);
  assert.equal(speech, true);
  assert.equal(ranges.length, 2, JSON.stringify(ranges));
  assert.ok(Math.abs(ranges[0].start - 0.88) < 0.05, 'empieza poco antes de la voz');
  assert.ok(Math.abs(ranges[0].end - 2.62) < 0.05);
  // La pausa corta (0,2 s) se conserva dentro del segundo tramo.
  assert.ok(Math.abs(ranges[1].start - 3.58) < 0.05);
  assert.ok(Math.abs(ranges[1].end - 5.82) < 0.05);
  const kept = core.totalLength(ranges);
  assert.ok(kept < samples.length / SR - 3, 'se recortan más de 3 s de silencio');
});

test('shorts: una toma sin contraste de voz se conserva completa', () => {
  const { ranges, speech } = core.detectSpeech(noise(3, 0.0005), SR);
  assert.equal(speech, false);
  assert.deepEqual(ranges, [{ start: 0, end: 3 }]);
});

test('shorts: unir tramos respeta la duración exacta y suaviza los bordes', () => {
  const samples = tone(2, 0.5);
  const joined = core.joinRanges([{ samples, ranges: [{ start: 0, end: 0.5 }, { start: 1, end: 1.25 }] }], SR);
  assert.equal(joined.length, Math.round(0.75 * SR));
  assert.equal(joined[0], 0);
  assert.ok(Math.abs(joined[Math.round(0.5 * SR) - 1]) < 1e-6);
});

test('shorts: la sonoridad final queda en −14 LUFS y el pico bajo −1 dBFS', () => {
  const quiet = concat(tone(2, 0.02, 300), noise(0.5), tone(2, 0.03, 450));
  const result = core.normalizeVoice(quiet, SR);
  assert.ok(Math.abs(result.after - core.TARGET_LUFS) < 1, 'LUFS final ' + result.after);
  assert.ok(core.peak(result.samples) <= core.dbToGain(-1) + 1e-6);
  const loud = core.normalizeVoice(tone(3, 0.98, 1000), SR);
  assert.ok(Math.abs(loud.after - core.TARGET_LUFS) < 1, 'reduce una voz demasiado fuerte: ' + loud.after);
});

test('shorts: el medidor coincide con la referencia BS.1770 para un tono de 1 kHz', () => {
  // Un seno de 1 kHz a −20 dBFS de pico en los dos canales mide unos −20 LUFS (−23,01 + 3,01).
  const value = core.loudness(tone(5, core.dbToGain(-20), 997), SR, true);
  assert.ok(Math.abs(value - (-20)) < 0.3, String(value));
});

test('shorts: el limitador nunca supera el techo', () => {
  const hot = tone(1, 1.6, 120);
  const out = core.limit(hot, SR, -1);
  assert.ok(core.peak(out) <= core.dbToGain(-1) + 1e-6);
});

test('shorts: la línea de tiempo enlaza escenas, cortes y el sello final', () => {
  const timeline = core.buildTimeline([
    { key: 'hook', ranges: [{ start: 0.5, end: 2 }] },
    { key: 'body', ranges: [{ start: 1, end: 3 }, { start: 4, end: 5 }] },
    { key: 'closing', ranges: [{ start: 0, end: 1 }] }
  ]);
  assert.equal(timeline.content, 5.5);
  assert.equal(timeline.duration, 5.5 + core.STAMP_SECONDS);
  let at = core.locate(timeline, 0);
  assert.equal(at.segment.scene, 'hook'); assert.equal(at.srcTime, 0.5);
  at = core.locate(timeline, 3.6);
  assert.equal(at.segment.scene, 'body'); assert.equal(at.segment.index, 1); assert.ok(Math.abs(at.srcTime - 4.1) < 1e-9);
  at = core.locate(timeline, 6);
  assert.equal(at.segment.scene, 'closing'); assert.ok(at.stamp > 0);
  assert.equal(core.buildTimeline([{ key: 'hook', ranges: [{ start: 0, end: 1 }] }], { stamp: false }).duration, 1);
});

test('shorts: composición, logo y textos', () => {
  const crop = core.coverCrop(1920, 1080, 930, 1160);
  assert.ok(Math.abs(crop.sw / crop.sh - 930 / 1160) < 1e-9);
  assert.ok(crop.sx > 0 && crop.sy === 0);
  for (const key of core.SCENES) {
    const r = core.presenterRect(key);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= core.WIDTH && r.y + r.h <= core.HEIGHT, key);
  }
  assert.deepEqual(core.logoPosition(0, 1080, 1920, 58, 58), { x: 0, y: 0 });
  assert.deepEqual(core.logoPosition(9, 1080, 1920, 58, 58), { x: 1022, y: 931 });
  const measure = s => s.length * 10;
  const lines = core.wrapLines('El gol más rápido de toda la historia de la Champions League', 200, measure, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines.every(l => measure(l) <= 200));
  assert.ok(lines[1].endsWith('…'));
  assert.deepEqual(core.wrapLines('Gol de Kane', 200, measure), ['Gol de Kane']);
  assert.equal(core.fileName('¡Récord de Kane! 44 goles', 'mp4'), 'record-de-kane-44-goles.mp4');
  assert.equal(core.stampDrop(0), -1);
  assert.ok(Math.abs(core.stampDrop(2)) < 0.001);
});
