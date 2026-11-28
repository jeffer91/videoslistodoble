'use strict';
/** Pruebas del apartado «Videos largos directos» (backend y lógica compartida). */
process.env.RECORDS_DEEPFILTER = '';
process.env.RECORDS_PIPER ??= 'off'; // el narrador (Piper) se prueba aparte: sin descargas // sin descargas: limpieza de voz con filtros clásicos
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
const directAudio = require('../backend/direct-audio.cjs');
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

test('el corte «bueno hasta aquí» se ajusta a la pausa de voz más cercana', () => {
  const pauses = [{ start: 2.8, end: 3.4 }, { start: 9, end: 9.5 }];
  assert.equal(directStore.snapToPause(3.6, pauses), 2.8 + directStore.SPLICE_FADE, 'Retrocede a la pausa anterior');
  assert.equal(directStore.snapToPause(3.3, pauses), 3.3, 'Dentro de la pausa se respeta el punto elegido');
  assert.equal(directStore.snapToPause(2.9, pauses), 2.8 + directStore.SPLICE_FADE, 'Deja un respiro al principio de la pausa');
  assert.equal(directStore.snapToPause(1.5, pauses), 1.5, 'Sin pausa anterior se usa el punto elegido');
});

test('continuar una toma desde un punto: se conserva lo bueno y se une la continuación con fundido', { timeout: 180000 }, async () => {
  const root = tempRoot();
  try {
    const good = path.join(root, 'buena.webm'), more = path.join(root, 'continuacion.webm');
    // Toma de 6 s con una pausa de voz entre 2,8 s y 3,4 s.
    await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x480:r=30:d=6',
      '-f', 'lavfi', '-i', 'sine=f=220:d=6,volume=enable=between(t\\,2.8\\,3.4):volume=0', '-c:v', 'libvpx', '-b:v', '600k', '-c:a', 'libopus', good]);
    await makeTake(more, 3);
    const p = directStore.createProject(root, { title: 'Continuar' });
    const project = directStore.importScript(root, { id: p.id, text: ONCE });
    const sectionId = project.sections[1].id;

    // 1) Sobre un borrador en revisión (todavía sin guardar).
    const draft = await addTake(root, p.id, sectionId, good);
    assert.equal(await directStore.indexTake(root, { id: p.id, takeId: draft.id }), true, 'El borrador se indexa para poder adelantarlo');
    assert.ok((await directStore.inspectTake(root, { id: p.id, takeId: draft.id })).duration > 5.5);
    const source = { kind: 'draft', takeId: draft.id };
    const point = await directStore.resumePoint(root, { id: p.id, source, at: 3.7 });
    assert.ok(point.snapped && point.cut >= 2.8 && point.cut <= 3.2, 'Corte en la pausa: ' + point.cut);
    const cont = await addTake(root, p.id, sectionId, more);
    const joined = await directStore.joinTake(root, { id: p.id, source, cut: point.cut, takeId: cont.id });
    assert.ok(Math.abs(joined.duration - (point.cut + 3 - directStore.SPLICE_FADE)) < 0.25, 'Duración unida: ' + joined.duration);
    const info = await directStore.inspectTake(root, { id: p.id, takeId: joined.id });
    assert.ok(info.ok && info.width === 640 && info.height === 480);
    const ids = directStore.pendingTakes(root, p.id).map(t => t.id);
    assert.ok(ids.includes(draft.id), 'La parte buena no se borra hasta guardar');
    assert.ok(!ids.includes(cont.id), 'La continuación ya está dentro de la unión');
    await directStore.commitTake(root, { id: p.id, takeId: joined.id });
    assert.equal(directStore.read(root, p.id).sections[1].take.id, joined.id);

    // 2) Sobre la toma activa: no cambia hasta guardar la nueva unión.
    const active = directStore.read(root, p.id).sections[1].take;
    const again = await addTake(root, p.id, sectionId, more);
    const second = await directStore.joinTake(root, { id: p.id, source: { kind: 'active', sectionId }, cut: 2, takeId: again.id });
    assert.equal(directStore.read(root, p.id).sections[1].take.id, active.id, 'La toma activa sigue intacta');
    assert.ok(Math.abs(second.duration - (2 + 3 - directStore.SPLICE_FADE)) < 0.25);
    await directStore.commitTake(root, { id: p.id, takeId: second.id });
    assert.ok(!fs.existsSync(directStore.resolveFile(root, p.id, active.original)), 'La anterior se borra solo después de guardar');

    // Una continuación dañada no toca nada y queda recuperable.
    const broken = directStore.beginTake(root, { id: p.id, sectionId });
    directStore.appendTake(root, { id: p.id, takeId: broken.id, sequence: 0, data: Buffer.alloc(4096, 7).toString('base64') });
    await assert.rejects(directStore.joinTake(root, { id: p.id, source: { kind: 'active', sectionId }, cut: 2, takeId: broken.id }));
    assert.ok(directStore.pendingTakes(root, p.id).some(t => t.id === broken.id));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── Subsecciones en cadena ─────────────────────────────────────────────────
const ROONEY = ['Gancho.', '', '━━━━━━━━━━━━━━━━━━', 'SECCIÓN 01 · LA HISTORIA DE WAYNE ROONEY', '━━━━━━━━━━━━━━━━━━', '',
  '[MÚSICA: emotiva] [TRANSICIÓN: estadio]', '', '▸ SUBSECCIÓN 1.1 · PAPÁ Y MAMÁ', 'Su padre era boxeador. [IMAGEN: Wayne Rooney niño]', '',
  '▸ SUBSECCIÓN 1.2 · LOS HERMANOS', 'Tenía dos hermanos menores.', '', '**Subsección 1.3: Croxteth**', 'Creció en Croxteth.', '',
  '━━━━━━━━━━━━━━━━━━', 'SECCIÓN 02 · EVERTON', '━━━━━━━━━━━━━━━━━━', '', 'Debutó a los 16 años.'].join('\n');

test('reconoce subsecciones 1.1, 1.2… que guían la grabación sin leerse ni salir en el video', async () => {
  const sections = scripts.parseSections(ROONEY);
  assert.deepEqual(sections.map(s => s.title), ['Introducción', 'LA HISTORIA DE WAYNE ROONEY', 'EVERTON'], 'SUBSECCIÓN no abre una sección nueva');
  const parts = Layout.subsections(sections[1].text);
  assert.deepEqual(parts.map(p => [p.label, p.title]), [['1.1', 'PAPÁ Y MAMÁ'], ['1.2', 'LOS HERMANOS'], ['1.3', 'Croxteth']]);
  assert.match(parts[0].text, /^\[MÚSICA: emotiva\]/, 'Las marcas previas van con la primera subsección');
  assert.match(parts[0].text, /\[IMAGEN: Wayne Rooney niño\]/);
  assert.equal(parts[1].text, 'Tenía dos hermanos menores.');
  assert.deepEqual(parts.map(p => p.word), [0, 4, 8], 'Primera palabra de cada subsección dentro de la sección');
  const clean = Layout.stripMarks(sections[1].text);
  assert.ok(!/SUBSECCI|Subsecci|PAPÁ|Croxteth\*/.test(clean), 'El encabezado no pasa al teleprompter: ' + clean);
  assert.match(clean, /Creció en Croxteth\./);
  const marks = Layout.marks(sections[1].text).marks;
  assert.deepEqual(marks.filter(m => m.type === 'imagen').map(m => m.word), [4], 'Las demás marcas mantienen su posición');
  assert.equal(Layout.subsections(sections[2].text).length, 0);
  assert.equal(Layout.subsections('▸ subseccion 2,1 - inicio\nHola.')[0].label, '2.1', 'Acepta minúsculas, sin tilde y coma');
  // En un PDF las líneas de subsección no se pegan al párrafo anterior (el PDF de prueba solo admite Latin-1: «-» en vez de «▸»).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-sub-'));
  try {
    fs.writeFileSync(path.join(dir, 'guion.pdf'), pdf(ROONEY.replace(/━+/g, '==================').replace(/▸/g, '-').split('\n')));
    const fromPdf = scripts.parseSections((await scripts.readScriptFile(path.join(dir, 'guion.pdf'))).text);
    assert.deepEqual(Layout.subsections(fromPdf[1].text).map(p => p.label), ['1.1', '1.2', '1.3']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('progreso de la cadena: cuántas subsecciones tiene la toma y cuál sigue', () => {
  const text = scripts.parseSections(ROONEY)[1].text;
  let c = Layout.chainProgress({ text, take: null });
  assert.equal(c.done, 0); assert.equal(c.next.label, '1.1'); assert.equal(c.complete, false);
  c = Layout.chainProgress({ text, take: { chain: [{ label: '1.1', start: 0 }, { label: '1.2', start: 20 }] } });
  assert.equal(c.done, 2); assert.equal(c.next.label, '1.3');
  c = Layout.chainProgress({ text, take: { chain: [{ label: '1.1', start: 0 }, { label: '1.2', start: 20 }, { label: '1.3', start: 41 }] } });
  assert.equal(c.complete, true); assert.equal(c.next, null);
  assert.equal(Layout.chainProgress({ text, take: { duration: 90 } }).complete, true, 'Una toma antigua sin cadena cuenta como completa');
  assert.equal(Layout.chainProgress({ text: 'Sin subsecciones.', take: { duration: 9 } }).complete, true);
  assert.equal(Layout.chainProgress({ text: 'Sin subsecciones.', take: null }).complete, false);
  // El corte de «siguiente subsección» deja un respiro en el silencio final.
  assert.equal(directStore.endOfVoice(30, [{ start: 27.5, end: 30 }]), 27.9);
  assert.equal(directStore.endOfVoice(30, [{ start: 10, end: 11 }]), 30, 'Sin silencio al final se usa toda la toma');
  assert.deepEqual(directStore.normalizeChain([{ label: '1.1', start: 0 }, { label: 'x', start: 3 }, { label: '1.2', start: 0 }, { label: '1.3', start: 12 }], 10), [{ label: '1.1', start: 0 }]);
});

test('grabación en cadena: cada subsección sigue la toma y se puede repetir desde una', { timeout: 180000 }, async () => {
  const root = tempRoot();
  try {
    const part = path.join(root, 'parte.webm'), quiet = path.join(root, 'parte-silencio.webm');
    await makeTake(part, 3);
    // 3 s de voz y 2 s de silencio al final (como tras la parada automática).
    await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x480:r=30:d=5',
      '-f', 'lavfi', '-i', 'sine=f=220:d=5,volume=enable=gt(t\\,3):volume=0', '-c:v', 'libvpx', '-b:v', '600k', '-c:a', 'libopus', quiet]);
    const p = directStore.createProject(root, { title: 'Rooney' });
    let project = directStore.importScript(root, { id: p.id, text: ROONEY });
    const sectionId = project.sections[1].id;
    const add = async (file, label) => {
      const draft = directStore.beginTake(root, { id: p.id, sectionId, part: label });
      const data = fs.readFileSync(file);
      directStore.appendTake(root, { id: p.id, takeId: draft.id, sequence: 0, data: data.toString('base64') });
      return draft;
    };
    // 1.1
    const first = await add(quiet, '1.1');
    await directStore.commitTake(root, { id: p.id, takeId: first.id });
    let take = directStore.read(root, p.id).sections[1].take;
    assert.deepEqual(take.chain, [{ label: '1.1', start: 0 }]);
    assert.equal(directStore.progress(directStore.read(root, p.id)).recorded, 0, 'Con subsecciones pendientes la sección no cuenta como grabada');
    // 1.2 a continuación: se corta en el silencio final, no en el último fotograma.
    const active = { kind: 'active', sectionId };
    const tail = await directStore.tailPoint(root, { id: p.id, source: active });
    assert.ok(tail.cut > 3 && tail.cut < 3.6, 'Corte tras la voz: ' + tail.cut);
    const second = await add(part);
    const joined = await directStore.joinTake(root, { id: p.id, source: active, cut: tail.cut, takeId: second.id, part: '1.2' });
    assert.deepEqual(joined.chain.map(x => x.label), ['1.1', '1.2']);
    assert.ok(Math.abs(joined.chain[1].start - (tail.cut - directStore.SPLICE_FADE)) < 0.05);
    await directStore.commitTake(root, { id: p.id, takeId: joined.id });
    // 1.3
    const third = await add(part);
    const tail2 = await directStore.tailPoint(root, { id: p.id, source: active });
    const joined3 = await directStore.joinTake(root, { id: p.id, source: active, cut: tail2.cut, takeId: third.id, part: '1.3' });
    await directStore.commitTake(root, { id: p.id, takeId: joined3.id });
    project = directStore.read(root, p.id);
    take = project.sections[1].take;
    assert.deepEqual(take.chain.map(x => x.label), ['1.1', '1.2', '1.3']);
    assert.ok(Layout.chainProgress(project.sections[1]).complete);
    assert.equal(directStore.progress(project).recorded, 1);
    // Repetir 1.2: se conserva 1.1 entera y la cadena vuelve a quedar en 1.2.
    const start12 = take.chain[1].start;
    const redo = await add(part);
    const again = await directStore.joinTake(root, { id: p.id, source: active, cut: start12, takeId: redo.id, part: '1.2' });
    assert.deepEqual(again.chain.map(x => x.label), ['1.1', '1.2']);
    assert.ok(Math.abs(again.duration - (start12 + 3 - directStore.SPLICE_FADE)) < 0.25, 'Duración: ' + again.duration);
    // «Bueno hasta aquí» dentro de 1.2 no añade otra subsección.
    await directStore.commitTake(root, { id: p.id, takeId: again.id });
    const fix = await add(part);
    const fixed = await directStore.joinTake(root, { id: p.id, source: active, cut: start12 + 1.5, takeId: fix.id, part: '1.2' });
    assert.deepEqual(fixed.chain.map(x => x.label), ['1.1', '1.2']);
    // Sin `part` (sección sin subsecciones) la toma no lleva cadena.
    const plain = directStore.beginTake(root, { id: p.id, sectionId: project.sections[2].id });
    assert.equal(plain.chain, undefined);
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

// ── Narrador de las transiciones ───────────────────────────────────────────
const narrator = require('../backend/direct-narrator.cjs');

test('narrador: solo el título, nunca en la intro, y la transición se alarga para que quepa la voz', () => {
  const root = tempRoot();
  try {
    const p = directStore.createProject(root, { title: 'Próceres' });
    let project = directStore.importScript(root, { id: p.id, text: 'Gancho.\n\nSECCIÓN 01 · PADRES DE LA PATRIA\n\nTexto.\n\nSECCIÓN 02 · La Independencia\n\nMás texto.' });
    const [intro, s1, s2] = project.sections;
    assert.equal(s1.transition.narrator, true, 'Narrador activado por defecto');
    assert.equal(s1.transition.music, 'trailer');
    assert.equal(narrator.narratorText(s1), 'Padres de la patria', 'Solo el título, sin gritar en mayúsculas');
    assert.equal(narrator.narratorText(s2), 'La Independencia');
    assert.equal(narrator.wants(project, intro), false, 'La introducción no lleva narrador');
    assert.equal(narrator.wants(project, s1), true);
    // El título propio de la transición manda.
    project = directStore.updateSection(root, { id: p.id, sectionId: s1.id, patch: { transition: { title: 'Los próceres', duration: 9.5, music: 'ninguna' } } });
    const t = project.sections[1].transition;
    assert.equal(narrator.narratorText(project.sections[1]), 'Los próceres');
    assert.equal(t.duration, 9.5, 'La duración admite hasta 10 s');
    assert.equal(t.music, 'ninguna');
    // Tiempos: entra a 0,7 s y deja 1 s al final; nunca más de 10 s.
    assert.equal(narrator.transitionLength(4, { duration: 1.6 }), 4);
    assert.equal(narrator.transitionLength(2, { duration: 1.6 }), 3.3);
    assert.equal(narrator.transitionLength(3, { duration: 30 }), 10);
    assert.equal(narrator.transitionLength(3, null), 3);
    // Una locución guardada solo vale para el mismo texto.
    const hash = narrator.hashOf('Los próceres');
    project = directStore.setNarration(root, { id: p.id, sectionId: s1.id, narration: { text: 'Los próceres', hash, voice: 'x', duration: 2.4 } });
    assert.equal(narrator.current(null, project, project.sections[1]).duration, 2.4);
    project = directStore.updateSection(root, { id: p.id, sectionId: s1.id, patch: { transition: { title: 'Otro título', duration: 2 } } });
    assert.equal(project.sections[1].transition.narration.text, 'Los próceres', 'Cambiar otros campos no borra la locución');
    assert.equal(narrator.current(null, project, project.sections[1]), null, 'Con otro título hay que generarla de nuevo');
    project = directStore.updateSection(root, { id: p.id, sectionId: s1.id, patch: { transition: { narrator: false } } });
    assert.equal(narrator.wants(project, project.sections[1]), false);
    // Proyectos antiguos sin los campos nuevos.
    const file = path.join(root, 'Directos', p.id, 'proyecto.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const sec of raw.sections) { delete sec.transition.narrator; delete sec.transition.music; delete sec.transition.narration; }
    fs.writeFileSync(file, JSON.stringify(raw));
    const old = directStore.read(root, p.id);
    assert.equal(old.sections[2].transition.narrator, true);
    assert.equal(old.sections[2].transition.music, 'trailer');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('música de tráiler gratis creada en el equipo: golpe al entrar, base bajo la voz y golpe final', { timeout: 120000 }, async () => {
  const root = tempRoot();
  try {
    const file = await directAudio.sting(root, 5, media);
    assert.equal(file, directAudio.stingFile(root, 5.04), 'Se reutiliza por décimas de segundo');
    const info = await media.probe(file);
    assert.ok(info.duration > 5 && info.duration < 7.5, 'Duración ' + info.duration);
    const level = async (start) => {
      const r = await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-ss', String(start), '-t', '0.4', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
      return Number(/mean_volume: (-?[\d.]+)/.exec(r.stderr)[1]);
    };
    const [hit, bed, last] = [await level(0), await level(2), await level(4.1)];
    assert.ok(hit > bed + 2 && last > bed + 2, 'Golpes por encima de la base: ' + [hit, bed, last].join(' / '));
    assert.ok(bed > -40, 'La base suena bajo la voz: ' + bed);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Con RECORDS_TEST_PIPER y RECORDS_TEST_PIPER_MODEL (un piper y una voz .onnx) se prueba la voz real.
test('narrador real: Piper dice el título en la transición, que se alarga para la voz', { timeout: 600000, skip: !process.env.RECORDS_TEST_PIPER && 'sin Piper de prueba' }, async () => {
  const root = tempRoot();
  const saved = [process.env.RECORDS_PIPER, process.env.RECORDS_PIPER_MODEL];
  process.env.RECORDS_PIPER = process.env.RECORDS_TEST_PIPER;
  process.env.RECORDS_PIPER_MODEL = process.env.RECORDS_TEST_PIPER_MODEL;
  try {
    const file = path.join(root, 'toma.webm');
    await makeTake(file, 5);
    const p = directStore.createProject(root, { title: 'Próceres' });
    let project = directStore.importScript(root, { id: p.id, text: 'Gancho inicial.\n\nSECCIÓN 01 · PADRES DE LA PATRIA\n\nTexto narrable.' });
    for (const section of project.sections) {
      const draft = await addTake(root, p.id, section.id, file);
      await directStore.commitTake(root, { id: p.id, takeId: draft.id });
    }
    directStore.saveSettings(root, { id: p.id, settings: { transitions: { duration: 2 }, cta: { endscreen: false, enabled: false } } });
    for (const s of directStore.read(root, p.id).sections) directStore.updateSection(root, { id: p.id, sectionId: s.id, patch: { transition: { duration: 2 } } });
    const spoken = await narrator.speak(root, 'Padres de la patria', {}, media);
    assert.ok(spoken.duration > 0.6 && spoken.duration < 6, 'Voz de ' + spoken.duration + ' s');
    const events = [];
    const entry = await render.exportProject(root, p.id, { quality: 'draft', send: e => events.push(e) });
    project = directStore.read(root, p.id);
    const n = project.sections[1].transition.narration;
    assert.equal(n.text, 'Padres de la patria');
    assert.equal(project.sections[0].transition.narration, null, 'La intro no lleva narrador');
    const length = narrator.transitionLength(2, n);
    assert.ok(length > 2, 'La transición se alarga para la voz: ' + length);
    const output = directStore.resolveFile(root, p.id, entry.file);
    const info = await media.probe(output);
    assert.ok(Math.abs(info.duration - (2 + 5 + length + 5)) < 0.3, 'Duración ' + info.duration);
    assert.deepEqual(entry.chapters.map(c => c.start), [0, 7]);
    // Volumen medio en una ventana del video final.
    const level = async (start, length = 0.5) => {
      const r = await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-ss', String(start), '-t', String(length), '-i', output, '-af', 'highpass=f=300,lowpass=f=3400,volumedetect', '-f', 'null', '-']);
      return Number(/mean_volume: (-?[\d.]+)/.exec(r.stderr)[1]);
    };
    const voice = await level(7 + narrator.START + 0.1, Math.min(0.8, n.duration - 0.2));
    const before = await level(7 + 0.15, 0.4);
    assert.ok(voice > -32, 'Se oye al narrador: ' + voice);
    assert.ok(voice > before + 3, 'La voz entra tras el golpe inicial: ' + before + ' → ' + voice);
    // Mismo texto: la locución se reutiliza, no se genera otra.
    const again = await narrator.prepare(root, p.id, {}, media);
    assert.equal(again.warning, null);
    assert.equal(fs.readdirSync(path.join(root, 'Recursos', 'Directos', 'Narrador')).filter(f => f.endsWith('.m4a')).length, 1);
  } finally {
    [process.env.RECORDS_PIPER, process.env.RECORDS_PIPER_MODEL] = saved;
    if (saved[0] === undefined) delete process.env.RECORDS_PIPER;
    if (saved[1] === undefined) delete process.env.RECORDS_PIPER_MODEL;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sin narrador disponible se exporta igual y se avisa', async () => {
  const root = tempRoot();
  try {
    const p = directStore.createProject(root, { title: 'Sin red' });
    const project = directStore.importScript(root, { id: p.id, text: 'Gancho.\n\nSECCIÓN 01 · PADRES DE LA PATRIA\n\nTexto.' });
    const file = path.join(root, 'Directos', p.id, 'proyecto.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.sections[1].take = { id: 'x', original: 'x', duration: 5 };
    fs.writeFileSync(file, JSON.stringify(raw));
    const result = await narrator.prepare(root, p.id, {}, media);
    assert.match(result.warning, /Narrador no disponible/);
    const plan = render.plan(result.project);
    assert.equal(plan.pieces.find(x => x.kind === 'transition' && x.section.id === project.sections[1].id).duration, 4, 'Sin voz, la duración configurada');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
