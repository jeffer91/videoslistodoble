'use strict';
/** Pruebas del apartado «Videos largos directos» (backend y lógica compartida). */
process.env.RECORDS_DEEPFILTER = ''; // sin descargas: limpieza de voz con filtros clásicos
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const store = require('../backend/store.cjs');
const media = require('../backend/media.cjs');
const scripts = require('../backend/direct-script.cjs');
const directStore = require('../backend/direct-store.cjs');
const intel = require('../backend/direct-intel.cjs');
const captions = require('../backend/direct-captions.cjs');
const render = require('../backend/direct-render.cjs');
const { createYouTube } = require('../backend/direct-youtube.cjs');
const Layout = require('../renderer/direct-layout.js');

const ONCE = [
  'Hola, esto es Once Records.',
  '',
  '━━━━━━━━━━━━━━━━━━',
  'SECCIÓN 01 · EL COMIENZO',
  '━━━━━━━━━━━━━━━━━━',
  '',
  'Durante años, Harry Kane fue el goleador del Tottenham.',
  '',
  'Marcó 280 goles con el club.',
  '',
  '━━━━━━━━━━━━━━━━━━',
  'SECCIÓN 02 · EL ASCENSO',
  '━━━━━━━━━━━━━━━━━━',
  '',
  'Su camino hacia la élite no fue...',
  '',
  '━━━━━━━━━━━━━━━━━━',
  'SECCIÓN 03 · EL PUNTO DE INFLEXIÓN',
  '━━━━━━━━━━━━━━━━━━',
  '',
  'Pero entonces llegó una decisión del Bayern Múnich...'
].join('\n');

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-long-'));
  store.ensureRoot(root);
  return root;
}

// ── Utilidades de prueba: .docx y .pdf mínimos ─────────────────────────────
const CRC = Array.from({ length: 256 }, (_v, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buffer => { let c = 0xffffffff; for (const b of buffer) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content), packed = zlib.deflateRawSync(data), nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

function docx(lines) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = lines.map(line => '<w:p><w:r><w:t xml:space="preserve">' + esc(line) + '</w:t></w:r></w:p>').join('');
  return zip({ '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>' });
}

function pdf(lines) {
  // PDF 1.4 con Helvetica en WinAnsi (las tildes van como octal).
  const encode = s => s.replace(/[\\()]/g, m => '\\' + m).replace(/[^\x20-\x7e]/g, c => '\\' + c.charCodeAt(0).toString(8).padStart(3, '0'));
  const content = 'BT /F1 12 Tf 50 800 Td 16 TL ' + lines.map(l => '(' + encode(l) + ') Tj T*').join(' ') + ' ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + Buffer.byteLength(content, 'latin1') + ' >>\nstream\n' + content + '\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

async function makeTake(file, seconds = 4) {
  await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x480:r=30:d=' + seconds,
    '-f', 'lavfi', '-i', 'sine=f=220:d=' + seconds, '-c:v', 'libvpx', '-b:v', '600k', '-c:a', 'libopus', file]);
}

async function addTake(root, id, sectionId, file) {
  const draft = directStore.beginTake(root, { id, sectionId });
  const data = fs.readFileSync(file);
  for (let i = 0, n = 0; i < data.length; i += 200000, n++) directStore.appendTake(root, { id, takeId: draft.id, sequence: n, data: data.subarray(i, i + 200000).toString('base64') });
  return draft;
}

// ── Guiones ────────────────────────────────────────────────────────────────
test('reconoce las secciones de Once Records sin pasar separadores ni encabezados al texto', () => {
  const sections = scripts.parseSections(ONCE);
  assert.deepEqual(sections.map(s => [s.number, s.title]), [[0, 'Introducción'], [1, 'EL COMIENZO'], [2, 'EL ASCENSO'], [3, 'EL PUNTO DE INFLEXIÓN']]);
  assert.equal(sections[1].text, 'Durante años, Harry Kane fue el goleador del Tottenham.\n\nMarcó 280 goles con el club.');
  for (const s of sections) assert.ok(!/━|SECCIÓN/.test(s.text));
  assert.equal(scripts.chapterTitle('EL PUNTO DE INFLEXIÓN'), 'El punto de inflexión');
  assert.equal(scripts.chapterTitle('EL ASCENSO DE KANE', 'Harry Kane'), 'El ascenso de Kane');
  // Variantes habituales: Markdown, guiones como separador, «SECCION» sin tilde.
  const md = scripts.parseSections('# Guion\n\n## SECCION 1 - Inicio\nTexto uno.\n\n----------\n## SECCIÓN 02: Final\nTexto dos.');
  assert.deepEqual(md.map(s => s.title), ['Introducción', 'Inicio', 'Final']);
  // Un fragmento sin encabezados se convierte en una sección.
  assert.equal(scripts.parseSections('Solo un párrafo suelto.')[0].text, 'Solo un párrafo suelto.');
});

test('importa guiones desde .txt, .md, .docx y .pdf como texto editable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-guion-'));
  try {
    fs.writeFileSync(path.join(dir, 'guion.txt'), '﻿' + ONCE);
    fs.writeFileSync(path.join(dir, 'guion.md'), ONCE);
    fs.writeFileSync(path.join(dir, 'guion.docx'), docx(ONCE.split('\n')));
    const pdfLines = ONCE.replace(/━+/g, '==================').split('\n');
    fs.writeFileSync(path.join(dir, 'guion.pdf'), pdf(pdfLines));
    for (const name of ['guion.txt', 'guion.md', 'guion.docx', 'guion.pdf']) {
      const result = await scripts.readScriptFile(path.join(dir, name));
      const sections = scripts.parseSections(result.text);
      assert.equal(sections.length, 4, name);
      assert.equal(sections[3].title, 'EL PUNTO DE INFLEXIÓN', name);
      assert.match(sections[1].text, /Harry Kane fue el goleador del Tottenham\./, name);
      assert.match(sections[1].text, /280 goles/, name);
    }
    fs.writeFileSync(path.join(dir, 'imagen.png'), 'x');
    await assert.rejects(scripts.readScriptFile(path.join(dir, 'imagen.png')), /Formato no admitido/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── Proyectos y tomas ──────────────────────────────────────────────────────
test('gestiona proyectos locales: crear, renombrar, secciones y eliminar con confirmación', () => {
  const root = tempRoot();
  try {
    const p = directStore.createProject(root, { title: 'Kane' });
    assert.throws(() => directStore.createProject(root, { title: '  ' }), /título/);
    let project = directStore.importScript(root, { id: p.id, text: ONCE });
    assert.equal(project.sections.length, 4);
    assert.equal(project.sections[3].title, 'El punto de inflexión');
    project = directStore.importScript(root, { id: p.id, text: 'Un párrafo extra.', mode: 'append-text', at: project.sections[2].id });
    assert.match(project.sections[2].text, /Un párrafo extra\.$/);
    project = directStore.addSection(root, { id: p.id, title: 'Cierre', text: 'Gracias.' });
    project = directStore.moveSection(root, { id: p.id, sectionId: project.sections.at(-1).id, delta: -1 });
    assert.equal(project.sections.at(-2).title, 'Cierre');
    assert.deepEqual(project.sections.map(s => s.number), [0, 1, 2, 3, 4]);
    directStore.renameProject(root, { id: p.id, title: 'Harry Kane' });
    assert.equal(directStore.listProjects(root)[0].title, 'Harry Kane');
    assert.throws(() => directStore.deleteProject(root, { id: p.id, confirm: 'otro' }), /confirmar/);
    directStore.deleteProject(root, { id: p.id, confirm: 'Harry Kane' });
    assert.equal(directStore.listProjects(root).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('una sola toma activa por sección: la anterior se conserva hasta verificar la nueva', { timeout: 120000 }, async () => {
  const root = tempRoot();
  try {
    const file = path.join(root, 'toma.webm');
    await makeTake(file, 3);
    const p = directStore.createProject(root, { title: 'Tomas' });
    const project = directStore.importScript(root, { id: p.id, text: ONCE });
    const sectionId = project.sections[1].id;
    const first = await addTake(root, p.id, sectionId, file);
    const committed = await directStore.commitTake(root, { id: p.id, takeId: first.id });
    const firstFile = directStore.resolveFile(root, p.id, committed.take.original);
    assert.ok(fs.existsSync(firstFile));
    assert.ok(committed.take.duration > 2.5);
    // Una toma dañada no sustituye a la buena.
    const broken = directStore.beginTake(root, { id: p.id, sectionId });
    directStore.appendTake(root, { id: p.id, takeId: broken.id, sequence: 0, data: Buffer.alloc(4096, 7).toString('base64') });
    await assert.rejects(directStore.commitTake(root, { id: p.id, takeId: broken.id }));
    assert.equal(directStore.read(root, p.id).sections[1].take.id, first.id);
    assert.ok(fs.existsSync(firstFile), 'La toma activa sigue intacta');
    assert.equal(directStore.pendingTakes(root, p.id).length, 1, 'La toma fallida queda recuperable/descartable');
    directStore.discardTake(root, { id: p.id, takeId: broken.id });
    // La nueva toma válida reemplaza a la anterior y la anterior se elimina después.
    const second = await addTake(root, p.id, sectionId, file);
    await directStore.commitTake(root, { id: p.id, takeId: second.id });
    const latest = directStore.read(root, p.id).sections[1];
    assert.equal(latest.take.id, second.id);
    assert.ok(!fs.existsSync(firstFile));
    assert.equal(fs.readdirSync(path.dirname(firstFile)).filter(f => f.endsWith('.webm')).length, 1);
    // Copia MP4 indexada para editar y exportar; la original no se toca.
    const before = fs.statSync(directStore.resolveFile(root, p.id, latest.take.original)).size;
    const take = await directStore.prepareMaster(root, { id: p.id, sectionId });
    const info = await media.probe(directStore.resolveFile(root, p.id, take.master));
    assert.equal(info.width, 1080); assert.equal(info.height, 1080); assert.ok(info.hasAudio);
    assert.equal(fs.statSync(directStore.resolveFile(root, p.id, latest.take.original)).size, before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('copia de seguridad con grabaciones: exportar e importar', { timeout: 120000 }, async () => {
  const root = tempRoot();
  const other = tempRoot();
  try {
    const file = path.join(root, 'toma.webm');
    await makeTake(file, 2);
    const p = directStore.createProject(root, { title: 'Respaldo' });
    const project = directStore.importScript(root, { id: p.id, text: ONCE });
    const draft = await addTake(root, p.id, project.sections[1].id, file);
    await directStore.commitTake(root, { id: p.id, takeId: draft.id });
    const { image } = await directStore.saveImage(root, p.id, await require('sharp')({ create: { width: 1600, height: 900, channels: 3, background: '#2a6' } }).png().toBuffer(), { name: 'foto' });
    const backup = path.join(root, 'copia.tar');
    const result = directStore.exportBackup(root, { id: p.id, destination: backup });
    assert.ok(result.bytes > 1000);
    const restored = directStore.importBackup(other, { file: backup });
    const copy = directStore.read(other, restored.id);
    assert.equal(copy.title, 'Respaldo');
    assert.equal(copy.sections.length, 4);
    assert.ok(fs.existsSync(directStore.resolveFile(other, copy.id, copy.sections[1].take.original)));
    assert.ok(copy.images.some(i => i.id === image.id));
    fs.writeFileSync(path.join(root, 'falsa.tar'), Buffer.alloc(2048));
    assert.throws(() => directStore.importBackup(other, { file: path.join(root, 'falsa.tar') }), /no contiene el proyecto/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true }); }
});

// ── Funciones inteligentes ─────────────────────────────────────────────────
test('cartela de transición: foto automática, elegida o solo gráfico', { timeout: 120000 }, async () => {
  const root = tempRoot();
  try {
    const sharp = require('sharp');
    const p = directStore.createProject(root, { title: 'Formato Mundial sub 17' });
    let project = directStore.importScript(root, { id: p.id, text: ONCE });
    const s1 = project.sections[1];
    assert.equal(s1.transition.image, 'auto');
    assert.equal(render.transitionImage(root, project, s1), null, 'Sin fotos: fondo gráfico');
    const stat = await directStore.saveImage(root, p.id, await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#123' } }).png().toBuffer(), { name: 'Gráfico · 44 goles', source: { provider: 'Once Records', stat: '44|goles' } });
    const kane = await directStore.saveImage(root, p.id, await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#c33' } }).jpeg().toBuffer(), { name: 'Kane' });
    const stadium = await directStore.saveImage(root, p.id, await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#3c3' } }).jpeg().toBuffer(), { name: 'Estadio' });
    project = directStore.updateSection(root, { id: p.id, sectionId: s1.id, patch: { imageIds: [stat.image.id, kane.image.id, stadium.image.id] } });
    assert.equal(render.transitionImage(root, project, project.sections[1]).id, kane.image.id, 'Automático: primera foto, sin contar gráficos de datos');
    project = directStore.updateSection(root, { id: p.id, sectionId: s1.id, patch: { transition: { image: stadium.image.id } } });
    assert.equal(render.transitionImage(root, project, project.sections[1]).id, stadium.image.id, 'Foto elegida');
    project = directStore.updateSection(root, { id: p.id, sectionId: s1.id, patch: { transition: { image: 'no-existe' } } });
    assert.equal(project.sections[1].transition.image, 'auto', 'Un id desconocido vuelve a automático');
    project = directStore.updateSection(root, { id: p.id, sectionId: s1.id, patch: { transition: { image: 'none' } } });
    assert.equal(render.transitionImage(root, project, project.sections[1]), null, 'Solo gráfico');
    project = directStore.updateSection(root, { id: p.id, sectionId: s1.id, patch: { transition: { image: kane.image.id, title: 'Otro título' } } });
    assert.equal(project.sections[1].transition.image, kane.image.id, 'Cambiar otro campo conserva la foto');
    project = directStore.removeImage(root, { id: p.id, imageId: kane.image.id });
    assert.equal(project.sections[1].transition.image, 'auto', 'Borrar la foto elegida vuelve a automático');

    // La cartela renderizada usa la foto: el fondo verde del «estadio» domina la imagen.
    const bg = await render.transitionBackground(root, project, project.sections[1], 'estadio');
    assert.equal(bg.image.id, stadium.image.id);
    const out = path.join(root, 'cartela.mp4');
    await render.renderTransition({ root, media, project, quality: 'draft', signal: new AbortController().signal }, { kind: 'transition', section: project.sections[1], style: 'estadio', duration: 2 }, out);
    const frame = path.join(root, 'cartela.png');
    await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1.2', '-i', out, '-frames:v', '1', frame]);
    const { channels } = await sharp(frame).extract({ left: 0, top: 0, width: 1920, height: 220 }).stats();
    assert.ok(channels[1].mean > channels[0].mean * 1.5 && channels[1].mean > channels[2].mean * 1.5, 'El fondo de la cartela es la foto (' + channels.map(c => c.mean.toFixed(0)).join('/') + ')');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('detecta jugadores, clubes, estadios y propone composiciones editables', () => {
  const names = intel.entities('Cristiano Ronaldo marcó en el Santiago Bernabéu ante el Atlético de Madrid en la Champions League con Ancelotti.');
  const types = Object.fromEntries(names.map(e => [e.name, e.type]));
  assert.equal(types['Cristiano Ronaldo'], 'jugador');
  assert.equal(types['Santiago Bernabéu'], 'estadio');
  assert.equal(types['Atlético de Madrid'], 'club');
  assert.equal(types['Champions League'], 'competicion');
  assert.equal(types['Ancelotti'], 'entrenador');
  const section = { id: 's', title: 'Kane', text: '', take: { id: 't', duration: 30 }, imageIds: [], transition: { style: 'auto' },
    transcript: { takeId: 't', words: [] } };
  const say = (text, start) => text.split(' ').map((w, i) => ({ text: w, start: start + i * 0.4, end: start + i * 0.4 + 0.35 }));
  section.transcript.words = [...say('Hoy es oficial: Kane deja el club.', 0), ...say('Harry Kane marcó 280 goles con el Tottenham.', 4),
    ...say('Creo que nadie lo valoró como merecía.', 9), ...say('Durante muchos años fue avanzando paso a paso desde las categorías inferiores hasta convertirse en la gran referencia del equipo.', 13),
    ...say('Suscríbete y comenta qué opinas.', 25)];
  const project = { images: [{ id: 'kane', name: 'Harry Kane 2023.jpg', tags: ['Harry Kane'] }], sections: [section] };
  const result = intel.propose(project, section, { statImages: { '280|goles': 'stat' } });
  const layouts = result.layouts;
  assert.equal(layouts[0].start, 0);
  assert.equal(layouts.at(-1).end, 30);
  assert.equal(layouts[0].layout, 'A');
  assert.ok(layouts.some(l => l.imageId === 'stat' && l.layout === 'B'), 'Estadística con gráfico');
  assert.ok(layouts.some(l => l.layout === 'A' && l.scale > 1), 'Opinión con presentador ampliado');
  assert.equal(layouts.at(-1).layout, 'A', 'Llamado a la acción en primer plano');
  for (let i = 1; i < layouts.length; i++) assert.ok(Math.abs(layouts[i].start - layouts[i - 1].end) < 0.05);
  assert.ok(layouts.every(l => l.source === 'auto' && l.reason));
  assert.deepEqual(intel.statistics(section).map(s => s.value + ' ' + s.label), ['280 goles']);
});

test('interpreta resultados de Wikimedia Commons y descarta licencias no libres', async () => {
  const page = (id, title, license, width, extra = {}) => ({ pageid: id, title: 'File:' + title, index: id, imageinfo: [{ url: 'https://upload.wikimedia.org/' + title, thumburl: 'https://upload.wikimedia.org/thumb/' + title,
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:' + title, width, height: Math.round(width * 9 / 16), mime: 'image/jpeg', timestamp: '2024-05-01T00:00:00Z',
    extmetadata: { LicenseShortName: { value: license }, Artist: { value: '<a href="x">Fotógrafo</a>' }, DateTimeOriginal: { value: '2024-04-20' }, ...extra } }] });
  const data = { query: { pages: { 1: page(1, 'Kane 2024.jpg', 'CC BY-SA 4.0', 3000), 2: page(2, 'Logo.jpg', 'Fair use', 3000, { NonFree: { value: 'true' } }), 3: page(3, 'Pequeña.jpg', 'CC0', 400) } } };
  const calls = [];
  const fetcher = async url => { calls.push(String(url)); return { ok: true, json: async () => data }; };
  const result = await intel.searchImages('Harry Kane Bayern', { fetcher });
  assert.deepEqual(result.results.map(r => r.title), ['Kane 2024.jpg']);
  assert.equal(result.results[0].author, 'Fotógrafo');
  assert.equal(result.results[0].year, 2024);
  assert.ok(calls.some(u => u.includes('gsrsort=create_timestamp_desc')), 'También busca por fecha reciente');
  assert.match(intel.attribution(result.results[0]), /Fotógrafo · CC BY-SA 4.0 · Wikimedia Commons/);
});

test('teleprompter por voz: alinea lo reconocido con el guion, también al repetir una frase', () => {
  const tokens = Layout.tokens('Durante años, Harry Kane fue el goleador del Tottenham. Su camino hacia la élite no fue sencillo, pero nunca dejó de trabajar.');
  assert.equal(Layout.align(tokens, 'harry kane fue el goleador', 0), 7);
  assert.equal(Layout.align(tokens, 'su camino hacia la elite', 8), 14);
  // Repite el comienzo: la posición vuelve atrás.
  assert.equal(Layout.align(tokens, 'durante años harry kane', 14), 4);
  assert.equal(Layout.align(tokens, 'algo que no está en el guion', 4), -1);
});

test('geometría compartida: tramos completos y fotogramas exactos', () => {
  const filled = Layout.fill([{ layout: 'B', start: 2, end: 5 }], 8);
  assert.deepEqual(filled.map(s => [s.layout, s.start, s.end]), [['A', 0, 2], ['B', 2, 5], ['A', 5, 8]]);
  const frames = Layout.frames(filled, 8.01);
  assert.equal(frames.reduce((n, s) => n + s.frames, 0), Math.round(8.01 * 30));
  const b = Layout.boxes({ layout: 'B', side: 'right', scale: 1 }, true);
  assert.ok(b.presenter.x > b.image.x && b.image.w > 600);
  assert.equal(Layout.boxes({ layout: 'D' }, false).layout, 'A', 'Sin imagen la composición D no deja la pantalla vacía');
  assert.equal(Layout.boxes({ layout: 'C', corner: 'tl', scale: 1 }, true).presenter.x, 56);
});

test('subtítulos SRT y ASS con resaltado de palabra', () => {
  const words = 'Harry Kane marcó un gol histórico. Nadie lo esperaba.'.split(' ').map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.45 }));
  const srt = captions.srt([{ offset: 10, words }]);
  assert.match(srt, /^1\r\n00:00:10,000 --> /);
  assert.match(srt, /Nadie lo esperaba\./);
  const ass = captions.ass(words, { style: 'impacto', size: 60, position: 'bottom', highlight: true });
  assert.match(ass, /Style: Sub,Arial Black,60/);
  assert.match(ass, /\{\\c&H005FB1D4&/);
  const part = captions.ass(words, { style: 'clasico' }, 1920, 1080, { from: 2, to: 4 });
  const times = [...part.matchAll(/Dialogue: 0,([\d:.]+),([\d:.]+)/g)].map(m => m.slice(1).map(t => t.split(':').reduce((a, b) => a * 60 + Number(b), 0)));
  assert.ok(times.length >= 2 && times.every(([a, b]) => a >= 0 && b <= 2.001 && b > a), 'Tiempos recortados al tramo');
});

// ── Exportación ────────────────────────────────────────────────────────────
test('exporta un MP4 1920×1080 con transiciones, composiciones, imágenes, música, efectos, subtítulos y capítulos', { timeout: 600000 }, async () => {
  const root = tempRoot();
  try {
    const file = path.join(root, 'toma.webm');
    await makeTake(file, 5);
    const p = directStore.createProject(root, { title: 'Exportación completa' });
    let project = directStore.importScript(root, { id: p.id, text: ONCE });
    for (const section of project.sections.slice(0, 3)) {
      const draft = await addTake(root, p.id, section.id, file);
      await directStore.commitTake(root, { id: p.id, takeId: draft.id });
    }
    const photo = await require('sharp')({ create: { width: 1920, height: 1080, channels: 3, background: '#a33' } }).jpeg().toBuffer();
    const { image } = await directStore.saveImage(root, p.id, photo, { name: 'Kane', source: { provider: 'Wikimedia Commons', title: 'Kane.jpg', author: 'Autora', license: 'CC BY 4.0', attribution: 'Kane · Autora · CC BY 4.0 · Wikimedia Commons', pageUrl: 'https://commons.wikimedia.org/wiki/File:Kane.jpg' } });
    project = directStore.read(root, p.id);
    const s1 = project.sections[1];
    directStore.updateSection(root, { id: p.id, sectionId: s1.id, patch: { layouts: [
      { start: 0, end: 1.5, layout: 'A' }, { start: 1.5, end: 2.5, layout: 'B', imageId: image.id, side: 'right' },
      { start: 2.5, end: 3.5, layout: 'C', imageId: image.id, corner: 'tl' }, { start: 3.5, end: 4.2, layout: 'D', imageId: image.id }, { start: 4.2, end: 5, layout: 'E' }] } });
    project = directStore.read(root, p.id);
    const words = 'Durante años Harry Kane fue el goleador del Tottenham.'.split(' ').map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4 }));
    directStore.updateSection(root, { id: p.id, sectionId: s1.id, patch: { transcript: { takeId: project.sections[1].take.id, words } } });
    directStore.updateSection(root, { id: p.id, sectionId: project.sections[2].id, patch: { transition: { duration: 3, sound: 'whoosh', style: 'tunel' }, audio: { mood: 'tension' } } });
    directStore.saveSettings(root, { id: p.id, settings: { subtitles: { burn: true, style: 'impacto' }, transitions: { duration: 3 }, cta: { endscreenDuration: 5 } } });
    // Corte no destructivo de medio segundo y un llamado a la acción manual.
    directStore.updateSection(root, { id: p.id, sectionId: s1.id, patch: { cuts: [{ start: 3.6, end: 4.1, reason: 'Silencio' }] } });
    directStore.updateSection(root, { id: p.id, sectionId: project.sections[2].id, patch: { ctas: [{ type: 'suscribir', start: 0.4 }] } });
    const events = [];
    const entry = await render.exportProject(root, p.id, { quality: 'final', send: e => events.push(e) });
    const output = directStore.resolveFile(root, p.id, entry.file);
    const info = await media.probe(output);
    assert.equal(info.width, 1920);
    assert.equal(info.height, 1080);
    assert.ok(info.hasAudio);
    // 3 transiciones (4, 4 y 3 s) + 3 tomas de 5 s (una con 0,5 s cortado) + pantalla final de 5 s.
    const expected = 4 + 5 + 4 + 4.5 + 3 + 5 + 5;
    assert.ok(Math.abs(info.duration - expected) < 0.3, 'Duración ' + info.duration);
    assert.deepEqual(entry.chapters.map(c => [c.start, c.title]), [[0, 'Introducción'], [9, 'El comienzo'], [17.5, 'El ascenso']]);
    assert.ok(entry.ctas >= 1, 'Llamado a la acción en pantalla');
    assert.equal(entry.pieces.at(-1).kind, 'endscreen');
    assert.ok(entry.review.items.length > 3, 'Revisión final');
    assert.equal(entry.chaptersText.split('\n')[0], '00:00 Introducción');
    assert.deepEqual(entry.missing, ['El punto de inflexión']);
    const srt = fs.readFileSync(directStore.resolveFile(root, p.id, entry.srt), 'utf8').replace(/^\ufeff/, '');
    assert.match(srt, /^1\r\n00:00:13,000 --> /, 'Los subtítulos empiezan tras la transición de su sección');
    assert.ok(events.some(e => e.stage === 'audio') && events.at(-1).percent === 100);
    // La mezcla tiene sonido durante las transiciones (efectos y música) y en las secciones (voz).
    const level = async (start) => {
      const r = await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-ss', String(start), '-t', '1', '-i', output, '-af', 'volumedetect', '-f', 'null', '-']);
      return Number(/mean_volume: (-?[\d.]+)/.exec(r.stderr)[1]);
    };
    assert.ok(await level(0.5) > -50, 'Transición con sonido');
    assert.ok(await level(6) > -35, 'Voz presente');
    // Los créditos de las imágenes con licencia van a la descripción de YouTube.
    const yt = createYouTube(root, { accounts: () => ({}) });
    assert.match(yt.description(directStore.read(root, p.id), entry), /Créditos de imágenes:\n• Kane · Autora · CC BY 4.0/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('publica en YouTube con subida reanudable, capítulos y aviso de privacidad', async () => {
  const root = tempRoot();
  try {
    const p = directStore.createProject(root, { title: 'Subida' });
    const project = directStore.importScript(root, { id: p.id, text: ONCE });
    const rel = 'Exportaciones/video.mp4';
    const size = 20 * 1024 * 1024 + 123;
    fs.writeFileSync(directStore.resolveFile(root, p.id, rel), Buffer.alloc(size, 1));
    project.exports = [{ file: rel, quality: 'final', chaptersText: '00:00 Introducción\n01:30 El comienzo\n04:20 El ascenso', chaptersValid: true }];
    project.youtube.privacy = 'public';
    directStore.write(root, project);
    let received = 0, initBody = null, failOnce = true;
    const fetcher = async (url, options) => {
      const u = String(url);
      if (u.includes('uploadType=resumable')) { initBody = JSON.parse(options.body); return { ok: true, status: 200, headers: new Map([['location', 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc']]) }; }
      if (u.includes('upload_id=abc')) {
        const range = options.headers['Content-Range'];
        if (range.startsWith('bytes */')) return { ok: false, status: 308, headers: new Map(received ? [['range', 'bytes=0-' + (received - 1)]] : []), json: async () => ({}) };
        if (failOnce && received > 0) { failOnce = false; throw Error('corte de red'); }
        received += options.body.length;
        if (received < size) return { ok: false, status: 308, headers: new Map([['range', 'bytes=0-' + (received - 1)]]) };
        return { ok: true, status: 200, json: async () => ({ id: 'abcdefghijk', status: { privacyStatus: 'private' } }) };
      }
      throw Error('URL inesperada ' + u);
    };
    const publishing = { accounts: () => ({ youtube: { id: 'canal', label: 'Once Records' } }), accountFor: async () => ({ accessToken: 'token' }) };
    const yt = createYouTube(root, publishing, { fetcher });
    assert.equal(yt.status().connected, true);
    const progress = [];
    const result = await yt.upload({ id: p.id }, e => progress.push(e.percent));
    assert.equal(received, size);
    assert.equal(result.url, 'https://www.youtube.com/watch?v=abcdefghijk');
    assert.equal(initBody.status.privacyStatus, 'public');
    assert.equal(initBody.snippet.categoryId, '17');
    assert.match(initBody.snippet.description, /00:00 Introducción\n01:30 El comienzo/);
    assert.match(result.warnings[0], /privado|private/);
    assert.ok(progress.includes(0) && progress.at(-1) === 100);
    assert.equal(directStore.read(root, p.id).youtube.session, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
