'use strict';
/** Pruebas de la automatización: marcas, cortes, llamados a la acción, biblioteca y piloto automático. */
process.env.RECORDS_DEEPFILTER = '';
process.env.RECORDS_PIPER ??= 'off'; // el narrador (Piper) se prueba aparte: sin descargas
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../backend/store.cjs');
const media = require('../backend/media.cjs');
const directStore = require('../backend/direct-store.cjs');
const auto = require('../backend/direct-auto.cjs');
const library = require('../backend/direct-library.cjs');
const Layout = require('../renderer/direct-layout.js');
const { createYouTube } = require('../backend/direct-youtube.cjs');

const tempRoot = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-auto-')); store.ensureRoot(root); return root; };
const words = (text, from = 0, step = 0.4) => text.split(' ').map((w, i) => ({ text: w, start: from + i * step, end: from + i * step + 0.35 }));

test('las marcas del guion no llegan al teleprompter y se sitúan en la voz', () => {
  const text = '[MÚSICA: épica] Durante años [IMAGEN: Harry Kane Tottenham] Harry Kane marcó [DATO: 280 goles] muchísimos goles. [PREGUNTA: ¿Ganará la Champions?] [pausa]';
  const parsed = Layout.marks(text);
  assert.equal(parsed.clean.includes('['), true, 'Los corchetes que no son marcas se conservan');
  assert.ok(!parsed.clean.includes('IMAGEN') && !parsed.clean.includes('MÚSICA'));
  assert.deepEqual(parsed.marks.map(m => [m.type, m.word]), [['musica', 0], ['imagen', 2], ['dato', 5], ['pregunta', 7]]);
  assert.deepEqual(Layout.tokens(text).map(t => t.word).slice(0, 3), ['durante', 'anos', 'harry']);
  const section = { text, take: { id: 't', duration: 6 }, transcript: { takeId: 't', words: words('Durante años Harry Kane marcó muchísimos goles.', 1) } };
  const timed = auto.timedMarks(section);
  assert.equal(timed.find(m => m.type === 'imagen').time, 1.8, 'La imagen aparece cuando dice «Harry»');
  assert.deepEqual(auto.sectionDirectives(section), { mood: 'epica' });
  assert.equal(auto.question({ sections: [section] }), '¿Ganará la Champions?');
});

test('corte automático: silencios, muletillas y frase repetida (se conserva el último intento)', () => {
  const spoken = [...words('Durante años Harry', 1.0), ...words('eh', 2.4), ...words('Durante años Harry Kane fue el goleador del Tottenham.', 3.0), ...words('Su camino fue duro.', 9.0)];
  const section = { text: 'Durante años, Harry Kane fue el goleador del Tottenham. Su camino fue duro.', take: { id: 't', duration: 13 }, transcript: { takeId: 't', words: spoken } };
  const cuts = auto.autocut(section);
  const retry = cuts.find(c => /repetida/.test(c.reason));
  assert.ok(retry && retry.start <= 1.0 && retry.end >= 2.7 && retry.end < 3.0, 'Quita el primer intento y la muletilla: ' + JSON.stringify(cuts));
  assert.ok(cuts.some(c => /Silencio de/.test(c.reason) && c.start > 6.5 && c.end < 9.0));
  assert.ok(cuts.some(c => /final/.test(c.reason)));
  const kept = Layout.kept(cuts, 13);
  assert.ok(kept.some(r => r.start <= 3.0 && r.end >= 6.5), 'El intento bueno se conserva entero');
  // Un corte desactivado vuelve a mostrarse.
  const restored = Layout.keptDuration(cuts.map(c => c === retry ? { ...c, enabled: false } : c), 13);
  assert.ok(restored > Layout.keptDuration(cuts, 13));
});

test('llamados a la acción: por la voz, por marcas, manuales, recordatorios y desactivables', () => {
  const s1 = { id: 's1', title: 'Uno', text: 'Texto largo [PREGUNTA: ¿Quién es mejor, Kane o Haaland?] y más.', take: { id: 'a', duration: 100 }, ctas: [], ctaOff: [],
    transcript: { takeId: 'a', words: [...words('Texto largo y más.', 0), ...words('Suscríbete al canal y dale like', 60)] } };
  const s2 = { id: 's2', title: 'Dos', text: 'Cierre.', take: { id: 'b', duration: 60 }, ctas: [{ id: 'manual-x', type: 'like', start: 5 }], ctaOff: [], transcript: null };
  const project = { settings: { cta: { enabled: true, reminders: true } }, sections: [s1, s2] };
  const plan = auto.plannedCtas(project, { s1: 4, s2: 110 });
  const types = list => list.map(c => c.type + ':' + c.source);
  assert.ok(types(plan.s1).includes('suscribir:voz') && types(plan.s1).includes('like:voz'));
  assert.ok(types(plan.s1).includes('comentar:guion'));
  assert.ok(types(plan.s2).includes('like:manual'));
  assert.ok(plan.s2.some(c => c.source === 'automático' && c.type === 'comentar' && /Haaland/.test(c.text)), 'Recordatorio final con la pregunta');
  assert.ok(!plan.s1.some(c => c.source === 'automático' && c.type === 'suscribir'), 'No repite «Suscríbete» si ya se dijo cerca del minuto 1:30');
  s1.ctaOff = [plan.s1.find(c => c.type === 'like').id];
  assert.ok(!auto.plannedCtas(project, { s1: 4, s2: 110 }).s1.some(c => c.type === 'like'));
  project.settings.cta.enabled = false;
  assert.deepEqual(auto.plannedCtas(project, {}), {});
});

test('metadatos de YouTube y biblioteca de fotos que aprende', async () => {
  const root = tempRoot();
  try {
    const project = { title: 'Harry Kane: la historia', sections: [{ text: '¿Por qué nadie vio venir a Harry Kane? Durante años fue el goleador del Tottenham. [PREGUNTA: ¿Kane es el mejor 9?]' }] };
    const meta = auto.suggestMetadata(project);
    assert.match(meta.description, /^¿Por qué nadie vio venir a Harry Kane\?/);
    assert.match(meta.description, /#HarryKane/);
    assert.ok(meta.tags.includes('Harry Kane') && meta.tags.includes('Tottenham'));
    assert.equal(meta.comment, '¿Kane es el mejor 9?');
    const photo = await require('sharp')({ create: { width: 1600, height: 900, channels: 3, background: '#334' } }).png().toBuffer();
    const item = await library.add(root, photo, { name: 'Kane', tags: 'Harry Kane, Bayern' });
    assert.deepEqual(item.tags, ['Harry Kane', 'Bayern']);
    assert.equal(library.find(root, 'harry kane')[0].id, item.id);
    assert.equal(library.find(root, 'Kane').length, 1);
    assert.equal(library.find(root, 'Messi').length, 0);
    library.retag(root, { id: item.id, tags: ['Harry Kane', 'Inglaterra'] });
    assert.equal(library.find(root, 'Inglaterra')[0].id, item.id);
    library.remove(root, { id: item.id });
    assert.equal(library.list(root).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('YouTube: publicación programada y primer comentario', async () => {
  const root = tempRoot();
  try {
    const p = directStore.createProject(root, { title: 'Programado' });
    const rel = 'Exportaciones/v.mp4';
    fs.writeFileSync(directStore.resolveFile(root, p.id, rel), Buffer.alloc(1000, 1));
    const project = directStore.read(root, p.id);
    project.exports = [{ file: rel, quality: 'final', chaptersText: '', chaptersValid: false }];
    directStore.write(root, project);
    assert.throws(() => directStore.saveSettings(root, { id: p.id, youtube: { publishAt: new Date(Date.now() + 60000).toISOString() } }), /15 minutos/);
    const when = new Date(Date.now() + 2 * 86400000).toISOString();
    directStore.saveSettings(root, { id: p.id, youtube: { publishAt: when, comment: '¿Kane o Haaland?', privacy: 'public' } });
    let init, comments = 0, status = 'private';
    const fetcher = async (url, options) => {
      const u = String(url);
      if (u.includes('uploadType=resumable')) { init = JSON.parse(options.body); return { ok: true, status: 200, headers: new Map([['location', 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=z']]) }; }
      if (u.includes('upload_id=z')) {
        if (options.headers['Content-Range'].startsWith('bytes */')) return { ok: false, status: 308, headers: new Map() };
        return { ok: true, status: 200, json: async () => ({ id: 'abcdefghijk', status: { privacyStatus: 'private', publishAt: when } }) };
      }
      if (u.includes('/commentThreads')) { comments++; assert.equal(JSON.parse(options.body).snippet.topLevelComment.snippet.textOriginal, '¿Kane o Haaland?'); return { ok: true, status: 200, json: async () => ({ id: 'c1' }) }; }
      if (u.includes('/videos?part=status')) return { ok: true, status: 200, json: async () => ({ items: [{ status: { uploadStatus: 'processed', privacyStatus: status } }] }) };
      throw Error('URL inesperada ' + u);
    };
    const yt = createYouTube(root, { accounts: () => ({ youtube: { id: 'c' } }), accountFor: async () => ({ accessToken: 't' }) }, { fetcher });
    const result = await yt.upload({ id: p.id });
    assert.equal(init.status.privacyStatus, 'private');
    assert.equal(init.status.publishAt, when);
    assert.equal(comments, 0, 'Sin comentario mientras el video no es público');
    assert.equal(result.pendingComment, '¿Kane o Haaland?');
    status = 'public';
    const checked = await yt.check({ id: p.id });
    assert.equal(comments, 1);
    assert.equal(checked.pendingComment, '');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('piloto automático: al guardar las tomas compone la sección y exporta el video solo', { timeout: 600000 }, async () => {
  const root = tempRoot();
  try {
    const take = path.join(root, 'toma.webm');
    await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x480:r=30:d=4', '-f', 'lavfi', '-i', 'sine=f=220:d=4',
      '-c:v', 'libvpx', '-b:v', '500k', '-c:a', 'libopus', take]);
    const photo = await require('sharp')({ create: { width: 1920, height: 1080, channels: 3, background: '#a33' } }).png().toBuffer();
    // Fotos ya conocidas: el piloto no necesita internet.
    for (const tag of ['Harry Kane', 'Tottenham', 'Bayern Múnich']) await library.add(root, photo, { name: tag, tags: [tag] });
    const handlers = {};
    const events = [];
    const { install } = require('../backend/direct-long.cjs');
    install({ app: {}, root, register: (name, fn) => { handlers[name] = fn; }, dialog: {}, shell: {}, clipboard: {}, safeStorage: { isEncryptionAvailable: () => false },
      window: () => ({ isDestroyed: () => false, webContents: { send: (_c, detail) => events.push(detail) } }) });
    const callDirect = (action, data) => handlers['direct:call']({ action, data });
    const p = await callDirect('create', { title: 'Piloto' });
    await callDirect('settings.save', { id: p.id, settings: { cta: { endscreenDuration: 5 }, transitions: { duration: 2 } } });
    const project = await callDirect('script.apply', { id: p.id, mode: 'replace',
      text: 'SECCIÓN 01 · EL COMIENZO\n[MÚSICA: tensión] Harry Kane brilló en el Tottenham. [DATO: 280 goles]\n\nSECCIÓN 02 · EL SALTO\n[TRANSICIÓN: túnel] Llegó al Bayern Múnich. [CTA: suscribir]' });
    const data = fs.readFileSync(take);
    for (const section of project.sections) {
      const draft = await callDirect('take.begin', { id: p.id, sectionId: section.id });
      await callDirect('take.append', { id: p.id, takeId: draft.id, sequence: 0, data: data.toString('base64') });
      await callDirect('take.commit', { id: p.id, takeId: draft.id });
    }
    const deadline = Date.now() + 540000;
    while (!events.some(e => e.kind === 'auto' && (e.state === 'terminado' || (e.state === 'error' && !e.sectionId))) && Date.now() < deadline) await new Promise(r => setTimeout(r, 500));
    const final = directStore.read(root, p.id);
    assert.ok(events.some(e => e.state === 'terminado'), 'El piloto terminó: ' + JSON.stringify(events.filter(e => e.state === 'error')));
    assert.ok(final.sections.every(s => s.auto?.state === 'listo'));
    assert.ok(final.sections.every(s => s.layouts.length > 0), 'Composición aplicada');
    assert.ok(final.sections[0].imageIds.length >= 2, 'Fotos de la biblioteca y gráfico del dato');
    assert.ok(final.images.some(i => i.source?.stat === '280|goles'));
    assert.equal(final.sections[0].audio.mood, 'tension');
    assert.equal(final.sections[1].transition.style, 'tunel');
    const exported = final.exports.at(-1);
    assert.equal(exported.quality, 'final');
    assert.equal(exported.width, 1920);
    assert.ok(exported.review.items.length > 0);
    assert.ok(exported.ctas >= 1, 'Llamado de la marca [CTA]');
    assert.ok(final.youtube.tags.includes('Harry Kane'), 'Etiquetas de YouTube rellenadas');
    assert.ok(library.list(root).some(i => i.uses > 0), 'La biblioteca registra el uso');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
