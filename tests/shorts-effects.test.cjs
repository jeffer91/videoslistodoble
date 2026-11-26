'use strict';
/** Pruebas del núcleo de efectos de «Shorts web» (marcas, tiempos, zoom, sonidos). */
const test = require('node:test');
const assert = require('node:assert/strict');
const FX = require('../shorts/effects.js');
const C = require('../shorts/core.js');

const SCRIPT = {
  hook: '[REC] ¿Sabías que [DATO: 44 goles] Harry Kane marcó cuarenta y cuatro goles?',
  body: '[PASO: El fichaje] [IMAGEN: Allianz Arena] Llegó al Bayern en 2023. [JUGADOR: Harry Kane | Bayern | Inglaterra | 32 años] Y [VS: Kane 44 goles | Lewandowski 41 goles] superó a Lewandowski. [FLECHA: aquí] [ZOOM] Increíble.',
  closing: '[TITULAR: El récord de Kane] [TEXTO: ¿Lo viste | venir?] [MAPA: Alemania] [MARCADOR: Bayern 8-0 Schalke | Bundesliga 2023] [TEMBLOR] Síguenos.'
};

test('separa las marcas del texto narrable y cuenta su posición', () => {
  const r = FX.parseMarks(SCRIPT.hook);
  assert.equal(r.clean, '¿Sabías que Harry Kane marcó cuarenta y cuatro goles?');
  assert.deepEqual(r.marks.map(m => [m.type, m.word]), [['rec', 0], ['dato', 2]]);
  assert.equal(r.marks[1].value, '44 goles');
  assert.equal(FX.stripMarks('Hola [desconocida] y [FOTO: x] adiós'), 'Hola [desconocida] y adiós');
  assert.equal(FX.parseMarks(SCRIPT.closing).marks.length, 5);
});

test('interpreta cifras, comparaciones y marcadores', () => {
  assert.deepEqual(FX.splitStat('Kane 44 goles'), { name: 'Kane', stat: '44 goles' });
  assert.deepEqual(FX.splitStat('Messi'), { name: 'Messi', stat: '' });
  const n = FX.parseNumber('+1.234 millones');
  assert.equal(n.number, 1234); assert.equal(n.prefix, '+'); assert.equal(n.suffix, ' millones');
  assert.equal(FX.parseNumber('3,5 goles por partido').number, 3.5);
  assert.equal(FX.formatNumber(1234, 0), '1234');
  assert.equal(FX.formatNumber(81044, 0), '81.044');
  assert.equal(FX.formatNumber(3.5, 1, ','), '3,5');
  assert.deepEqual(FX.parseScore('México 2-1 Brasil | Final 2005'), { home: 'México', homeScore: '2', awayScore: '1', away: 'Brasil', note: 'Final 2005' });
});

test('fotos necesarias, titular y valores por defecto', () => {
  assert.deepEqual(FX.photoQueries(SCRIPT), ['Allianz Arena', 'Harry Kane', 'Kane', 'Lewandowski']);
  assert.equal(FX.headline({ title: 'Kane', script: SCRIPT }), 'El récord de Kane');
  assert.equal(FX.headline({ title: 'Kane', script: { hook: 'x' } }), 'Kane');
  assert.equal(FX.settings({ zoom: false }).zoom, false);
  assert.equal(FX.settings({}).captionStyle, 'limpio');
});

test('programa los efectos con los tiempos de los subtítulos', () => {
  const timeline = C.buildTimeline([{ key: 'hook', ranges: [{ start: 0, end: 5 }] }, { key: 'body', ranges: [{ start: 0, end: 10 }] }, { key: 'closing', ranges: [{ start: 0, end: 6 }] }]);
  const words = [];
  for (const [key, from, to] of [['hook', 0, 5], ['body', 5, 15], ['closing', 15, 21]]) {
    const text = FX.stripMarks(SCRIPT[key]).split(/\s+/);
    text.forEach((w, i) => words.push({ text: w, start: from + (to - from) * i / text.length, end: from + (to - from) * (i + 0.9) / text.length }));
  }
  const { events, steps } = FX.schedule({ script: SCRIPT, options: {} }, timeline, words);
  const dato = events.find(e => e.type === 'dato');
  assert.ok(Math.abs(dato.start - words[2].start) < 1e-9, 'el contador empieza en la palabra marcada');
  assert.equal(steps, 1);
  const panels = events.filter(e => FX.PANEL.has(e.type));
  for (let i = 1; i < panels.length; i++) assert.ok(panels[i - 1].end <= panels[i].start + 1e-9, 'paneles sin solaparse');
  const rec = events.find(e => e.type === 'rec');
  assert.equal(rec.start, 0); assert.equal(rec.end, 5, 'REC hasta el final de la escena');
  assert.ok(events.every(e => e.end <= timeline.content + 1e-9));
  const sceneEnd = { hook: 5, body: 15, closing: 21 };
  assert.ok(events.filter(e => e.type !== 'paso').every(e => e.end <= sceneEnd[e.scene] + 1e-9), 'cada efecto termina dentro de su escena');
  assert.equal(events.find(e => e.type === 'flecha').onPanel, true);
  // Sin subtítulos: reparto proporcional dentro de la escena.
  const blind = FX.schedule({ script: SCRIPT, options: {} }, timeline, null).events.find(e => e.type === 'dato');
  assert.ok(blind.start > 0 && blind.start < 5);
});

test('zoom de énfasis, sacudida, palabras clave y animación pop', () => {
  const timeline = { content: 30, segments: [{}] };
  const zooms = FX.emphasisZooms(timeline, [], [{ type: 'imagen', start: 6, end: 9 }, { type: 'zoom', start: 20, end: 21.8 }]);
  assert.ok(zooms.length >= 4);
  assert.ok(zooms.every(z => !(z.start >= 5.8 && z.start < 9.2)), 'no hay zoom con panel en pantalla');
  assert.ok(zooms.some(z => z.forced && z.strength === 1.3));
  assert.equal(FX.zoomAt(zooms, 0.5), 1);
  const z = zooms.find(x => !x.forced);
  assert.ok(Math.abs(FX.zoomAt(zooms, z.start + 1) - z.strength) < 1e-9);
  assert.equal(FX.emphasisZooms(timeline, [], [], false).length, 0);
  const s = FX.shakeAt([{ type: 'temblor', start: 2, end: 2.4 }], 2.05);
  assert.ok(Math.abs(s.x) + Math.abs(s.y) > 1);
  const words = 'El gol de Kane en 2023 fue Increíble. Lewandowski'.split(' ').map(text => ({ text }));
  assert.deepEqual(words.map((_, i) => FX.isKeyword(words, i)), [false, false, false, true, false, true, false, true, false]);
  assert.ok(FX.popScale(0.13) > 1.05); assert.equal(FX.popScale(1), 1);
});

test('sonidos sintetizados y lista sin amontonar', () => {
  for (const make of [FX.popSound, FX.whooshSound, FX.hitSound]) {
    const s = make(48000);
    assert.ok(s.length > 1000);
    assert.ok(s.every(v => Number.isFinite(v) && Math.abs(v) <= 1.5));
  }
  const cues = FX.soundCues([{ type: 'imagen', start: 2, end: 5 }, { type: 'dato', start: 6, end: 8 }, { type: 'texto', start: 6, end: 7 }], [{ start: 2.05, end: 3 }]);
  assert.ok(cues.some(c => c.kind === 'hit' && Math.abs(c.at - 6.95) < 1e-9));
  assert.equal(cues.filter(c => c.kind === 'whoosh').length, 2, 'el whoosh del zoom pegado al del panel no se repite');
});
