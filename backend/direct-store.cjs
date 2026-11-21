'use strict';
/**
 * Videos largos directos · almacenamiento local.
 * Cada proyecto vive en <biblioteca>/Directos/<id>/ con su JSON, sus tomas,
 * imágenes, audio y exportaciones. El JSON se escribe de forma atómica y
 * una toma nueva solo sustituye a la anterior después de verificarse en disco.
 */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const store = require('./store.cjs');
const scripts = require('./direct-script.cjs');

const DIR = 'Directos';
const LAYOUTS = ['A', 'B', 'C', 'D', 'E'];
const CORNERS = ['tl', 'tr', 'bl', 'br'];
const SIDES = ['left', 'right'];
const BACKGROUNDS = ['estadio', 'tunel', 'cesped', 'luces', 'grafico', 'movimiento'];
const TRANSITION_STYLES = ['auto', ...BACKGROUNDS];
const MOODS = ['epica', 'emotiva', 'tension', 'ambiental'];
const SOUNDS = ['ninguno', 'estadio', 'multitud', 'impacto', 'whoosh', 'cinematico', 'musica'];
const SUB_STYLES = ['impacto', 'clasico', 'karaoke', 'minimal'];
const FRAME = 1 / 30;
const MIN_FREE = 600 * 1024 * 1024;
const LOW_FREE = 3 * 1024 * 1024 * 1024;

const uid = () => randomUUID();
const now = () => new Date().toISOString();
const frame = value => Math.round(Math.max(0, Number(value) || 0) / FRAME) * FRAME;
const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const pick = (value, list, fallback) => list.includes(value) ? value : fallback;
const text = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').slice(0, max);

function validId(id, label = 'proyecto') {
  if (!store.safeId(id)) throw Error('Identificador de ' + label + ' inválido');
  return id;
}

function base(root) {
  const dir = path.join(root, DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function projectDir(root, id) { return path.join(base(root), validId(id)); }
function projectFile(root, id) { return path.join(projectDir(root, id), 'proyecto.json'); }

/** Ruta absoluta de un archivo del proyecto, siempre dentro de su carpeta. */
function resolveFile(root, id, relative) {
  const dir = projectDir(root, id);
  const file = path.resolve(dir, String(relative || ''));
  if (!relative || !file.startsWith(path.resolve(dir) + path.sep)) throw Error('Ruta fuera del proyecto');
  return file;
}

function defaultTransition(title) {
  return { enabled: true, style: 'auto', duration: 4, title: title || '', sound: 'impacto', volume: 0.8 };
}

function newSection(input = {}, index = 0) {
  const title = text(input.title, 140).trim() || 'Sección ' + String(index + 1).padStart(2, '0');
  return {
    id: uid(), number: Number.isFinite(Number(input.number)) ? Number(input.number) : index + 1,
    title, text: text(input.text, 200000), intro: input.intro === true,
    take: null, transcript: null, layouts: [], imageIds: [], cuts: [], ctas: [], ctaOff: [], auto: null,
    transition: defaultTransition(),
    audio: { musicId: null, mood: 'auto', volume: null }
  };
}

function defaults() {
  return {
    background: { style: 'estadio', imageId: null },
    subtitles: { enabled: true, burn: false, style: 'impacto', size: 58, position: 'bottom', highlight: true },
    music: { enabled: true, volume: 0.22, ducking: true, defaultMood: 'epica' },
    transitions: { enabled: true, duration: 4 },
    voice: { gain: 1, profile: 'natural' },
    autopilot: { enabled: true, export: true, publish: false, images: true, cuts: true },
    cta: { enabled: true, reminders: true, endscreen: true, endscreenDuration: 20 },
    recording: { continuous: true, autoStop: true }
  };
}

function read(root, id) {
  const project = store.readJSON(projectFile(root, id));
  project.settings = mergeSettings(defaults(), project.settings || {});
  for (const section of project.sections || []) {
    section.cuts ||= []; section.ctas ||= []; section.ctaOff ||= [];
    if (section.auto === undefined) section.auto = null;
  }
  return project;
}

function write(root, project) {
  project.updatedAt = now();
  store.atomic(projectFile(root, project.id), project);
  return project;
}

function mergeSettings(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object') target[key] = { ...target[key], ...value };
  }
  return target;
}

function progress(project) {
  const total = project.sections.length;
  const recorded = project.sections.filter(s => s.take).length;
  const transcribed = project.sections.filter(s => s.take && s.transcript?.takeId === s.take.id).length;
  const edited = project.sections.filter(s => s.take && s.layouts.length).length;
  const exported = (project.exports || []).length > 0;
  const steps = [total > 0, total > 0 && recorded === total, transcribed === total && total > 0, edited === total && total > 0, exported];
  return { total, recorded, transcribed, edited, exported, percent: Math.round(100 * steps.filter(Boolean).length / steps.length),
    duration: project.sections.reduce((sum, s) => sum + (s.take?.duration || 0), 0) };
}

function summary(project) {
  return { id: project.id, title: project.title, createdAt: project.createdAt, updatedAt: project.updatedAt, progress: progress(project),
    lastExport: (project.exports || []).at(-1) || null, youtube: project.youtube?.lastUpload || null };
}

function listProjects(root) {
  return fs.readdirSync(base(root), { withFileTypes: true }).filter(e => e.isDirectory() && store.safeId(e.name)).flatMap(e => {
    try { return [summary(read(root, e.name))]; } catch { return []; }
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function createProject(root, { title } = {}) {
  const clean = text(title, 120).trim();
  if (!clean) throw Error('Escribe un título para el proyecto');
  const id = uid();
  const project = { schema: 1, kind: 'direct-long', id, title: clean, createdAt: now(), updatedAt: now(), script: null,
    sections: [], settings: defaults(), images: [], audio: [], exports: [], youtube: { title: clean, description: '', privacy: 'private', tags: [], madeForKids: false } };
  for (const sub of ['Tomas', 'Imagenes', 'Audio', 'Exportaciones', 'Temporales']) fs.mkdirSync(path.join(projectDir(root, id), sub), { recursive: true });
  return write(root, project);
}

function getProject(root, id) { return read(root, id); }

function renameProject(root, { id, title }) {
  const project = read(root, id);
  const clean = text(title, 120).trim();
  if (!clean) throw Error('El título no puede quedar vacío');
  project.title = clean;
  if (!project.youtube.title || project.youtube.title === project.title) project.youtube.title = clean;
  return write(root, project);
}

function deleteProject(root, { id, confirm }) {
  const project = read(root, id);
  if (confirm !== project.title) throw Error('Escribe el título exacto del proyecto para confirmar');
  fs.rmSync(projectDir(root, id), { recursive: true, force: true });
  return true;
}

// ── Guion y secciones ───────────────────────────────────────────────────────
function importScript(root, { id, text: input, source, mode = 'replace', at }) {
  const project = read(root, id);
  const parsed = scripts.parseSections(input);
  if (!parsed.length) throw Error('El texto está vacío');
  const created = parsed.map((item, index) => newSection({ ...item, title: scripts.chapterTitle(item.title, input) }, index));
  if (mode === 'replace') {
    if (project.sections.some(s => s.take)) throw Error('Hay secciones grabadas. Usa «Añadir al final» o elimina antes las grabaciones');
    project.sections = created;
    project.script = { source: source || null, importedAt: now() };
  } else if (mode === 'append-text' && at) {
    const section = project.sections.find(s => s.id === at);
    if (!section) throw Error('Sección no encontrada');
    section.text = [section.text, parsed.map(p => p.text).join('\n\n')].filter(Boolean).join('\n\n');
  } else {
    project.sections.push(...created);
  }
  renumber(project);
  return write(root, project);
}

function renumber(project) {
  let n = 1;
  for (const section of project.sections) section.number = section.intro ? 0 : n++;
}

function section(project, sectionId) {
  const found = project.sections.find(s => s.id === sectionId);
  if (!found) throw Error('Sección no encontrada');
  return found;
}

function normalizeLayouts(list, duration) {
  if (!Array.isArray(list)) throw Error('Composición inválida');
  const end = duration || Infinity;
  const items = list.slice(0, 600).map(item => ({
    id: store.safeId(item.id) ? item.id : uid(),
    start: frame(item.start), end: frame(Math.min(Number(item.end) || 0, end)),
    layout: pick(item.layout, LAYOUTS, 'A'), side: pick(item.side, SIDES, 'left'), corner: pick(item.corner, CORNERS, 'br'),
    scale: clamp(item.scale, 0.3, 1.25, 1), offsetX: clamp(item.offsetX, -0.5, 0.5, 0), offsetY: clamp(item.offsetY, -0.5, 0.5, 0),
    imageId: store.safeId(item.imageId) ? item.imageId : null, background: pick(item.background, ['', ...BACKGROUNDS], ''),
    zoom: item.zoom === false ? false : true, source: item.source === 'auto' ? 'auto' : 'manual', reason: text(item.reason, 160)
  })).filter(item => item.end - item.start >= FRAME * 15).sort((a, b) => a.start - b.start);
  for (let i = 1; i < items.length; i++) if (items[i].start < items[i - 1].end) items[i].start = items[i - 1].end;
  return items.filter(item => item.end - item.start >= FRAME * 15);
}

function updateSection(root, { id, sectionId, patch = {} }) {
  const project = read(root, id);
  const s = section(project, sectionId);
  if (patch.title !== undefined) s.title = text(patch.title, 140).trim() || s.title;
  if (patch.text !== undefined) s.text = text(patch.text, 200000);
  if (patch.layouts !== undefined) s.layouts = normalizeLayouts(patch.layouts, s.take?.duration);
  if (patch.imageIds !== undefined) s.imageIds = [...new Set((patch.imageIds || []).filter(x => project.images.some(i => i.id === x)))];
  if (patch.transition) {
    const t = { ...s.transition, ...patch.transition };
    s.transition = { enabled: t.enabled !== false, style: pick(t.style, TRANSITION_STYLES, 'auto'), duration: clamp(t.duration, 2, 8, 4),
      title: text(t.title, 140), sound: pick(t.sound, SOUNDS, 'impacto'), volume: clamp(t.volume, 0, 1.5, 0.8) };
  }
  if (patch.audio) {
    const a = { ...s.audio, ...patch.audio };
    s.audio = { musicId: a.musicId && project.audio.some(x => x.id === a.musicId) ? a.musicId : null,
      mood: pick(a.mood, ['auto', 'ninguna', ...MOODS], 'auto'), volume: a.volume === null || a.volume === '' ? null : clamp(a.volume, 0, 1, null) };
  }
  if (patch.cuts !== undefined) {
    if (!Array.isArray(patch.cuts)) throw Error('Cortes inválidos');
    const end = s.take?.duration || 0;
    s.cuts = patch.cuts.slice(0, 2000).map(c => ({ id: store.safeId(c.id) ? c.id : uid(), start: frame(Math.min(end, c.start)), end: frame(Math.min(end, c.end)),
      reason: text(c.reason, 160), enabled: c.enabled !== false, auto: c.auto === true })).filter(c => c.end - c.start >= FRAME * 3).sort((a, b) => a.start - b.start);
  }
  if (patch.ctas !== undefined) {
    if (!Array.isArray(patch.ctas)) throw Error('Llamados inválidos');
    s.ctas = patch.ctas.slice(0, 50).map(c => ({ id: store.safeId(c.id) ? c.id : 'manual-' + uid(), type: pick(c.type, ['suscribir', 'like', 'comentar'], 'suscribir'),
      start: clamp(c.start, 0, s.take?.duration || 7200, 0), text: text(c.text, 140) }));
  }
  if (patch.ctaOff !== undefined) s.ctaOff = (Array.isArray(patch.ctaOff) ? patch.ctaOff : []).map(x => text(x, 120)).slice(0, 200);
  if (patch.transcript !== undefined) {
    if (!s.take || patch.transcript?.takeId !== s.take.id) throw Error('La toma cambió. Vuelve a transcribir.');
    s.transcript = { takeId: s.take.id, words: normalizeWords(patch.transcript.words, s.take.duration), edited: true, engine: s.transcript?.engine || 'manual' };
  }
  return write(root, project);
}

function normalizeWords(words, duration = 7200) {
  if (!Array.isArray(words)) throw Error('Transcripción inválida');
  return words.slice(0, 40000).map(w => ({ start: clamp(w.start, 0, duration, 0), end: clamp(w.end, 0, duration, 0), text: text(w.text, 80).trim() }))
    .filter(w => w.text && w.end > w.start).sort((a, b) => a.start - b.start);
}

function addSection(root, { id, after, title, text: body }) {
  const project = read(root, id);
  const created = newSection({ title, text: body }, project.sections.length);
  const index = after ? project.sections.findIndex(s => s.id === after) + 1 : project.sections.length;
  project.sections.splice(index > 0 ? index : project.sections.length, 0, created);
  renumber(project);
  return write(root, project);
}

function removeSection(root, { id, sectionId, confirm }) {
  const project = read(root, id);
  const s = section(project, sectionId);
  if (s.take && confirm !== true) throw Error('La sección tiene una grabación. Confirma para eliminarla');
  project.sections = project.sections.filter(x => x.id !== sectionId);
  renumber(project);
  write(root, project);
  if (s.take) removeTakeFiles(root, project.id, s.take);
  return project;
}

function moveSection(root, { id, sectionId, delta }) {
  const project = read(root, id);
  const from = project.sections.findIndex(s => s.id === sectionId);
  const to = from + Math.sign(Number(delta) || 0);
  if (from < 0 || to < 0 || to >= project.sections.length) return project;
  const [item] = project.sections.splice(from, 1);
  project.sections.splice(to, 0, item);
  renumber(project);
  return write(root, project);
}

function saveSettings(root, { id, settings = {}, youtube }) {
  const project = read(root, id);
  const s = project.settings;
  if (settings.background) s.background = { style: pick(settings.background.style, BACKGROUNDS, s.background.style),
    imageId: settings.background.imageId && project.images.some(i => i.id === settings.background.imageId) ? settings.background.imageId : null };
  if (settings.subtitles) {
    const x = { ...s.subtitles, ...settings.subtitles };
    s.subtitles = { enabled: x.enabled !== false, burn: x.burn === true, style: pick(x.style, SUB_STYLES, 'impacto'), size: clamp(x.size, 30, 96, 58),
      position: pick(x.position, ['bottom', 'middle', 'top'], 'bottom'), highlight: x.highlight !== false };
  }
  if (settings.music) {
    const x = { ...s.music, ...settings.music };
    s.music = { enabled: x.enabled !== false, volume: clamp(x.volume, 0, 1, 0.22), ducking: x.ducking !== false, defaultMood: pick(x.defaultMood, MOODS, 'epica') };
  }
  if (settings.transitions) s.transitions = { enabled: settings.transitions.enabled !== false, duration: clamp(settings.transitions.duration, 2, 8, 4) };
  if (settings.voice) { const x = { ...s.voice, ...settings.voice }; s.voice = { gain: clamp(x.gain, 0.3, 3, 1), profile: pick(x.profile, ['original', 'natural', 'locutor', 'limpia', 'podcast', 'exterior'], 'natural') }; }
  if (settings.autopilot) { const x = { ...s.autopilot, ...settings.autopilot }; s.autopilot = { enabled: x.enabled !== false, export: x.export !== false, publish: x.publish === true, images: x.images !== false, cuts: x.cuts !== false }; }
  if (settings.cta) { const x = { ...s.cta, ...settings.cta }; s.cta = { enabled: x.enabled !== false, reminders: x.reminders !== false, endscreen: x.endscreen !== false, endscreenDuration: clamp(x.endscreenDuration, 5, 20, 20) }; }
  if (settings.recording) { const x = { ...s.recording, ...settings.recording }; s.recording = { continuous: x.continuous !== false, autoStop: x.autoStop !== false }; }
  if (youtube) {
    project.youtube = { ...project.youtube, title: text(youtube.title ?? project.youtube.title, 100).trim(),
      description: text(youtube.description ?? project.youtube.description, 5000).replace(/[<>]/g, ''),
      privacy: pick(youtube.privacy, ['private', 'unlisted', 'public'], project.youtube.privacy || 'private'),
      tags: Array.isArray(youtube.tags) ? youtube.tags.map(t => text(t, 60).trim()).filter(Boolean).slice(0, 30) : project.youtube.tags,
      madeForKids: youtube.madeForKids === true, thumbnail: youtube.thumbnail === null ? null : project.youtube.thumbnail || null,
      comment: youtube.comment !== undefined ? text(youtube.comment, 500).trim() : project.youtube.comment || '',
      publishAt: youtube.publishAt !== undefined ? futureDate(youtube.publishAt) : project.youtube.publishAt || null };
  }
  return write(root, project);
}

function futureDate(value) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw Error('Fecha de publicación inválida');
  if (time < Date.now() + 15 * 60000) throw Error('Programa la publicación al menos 15 minutos en el futuro');
  return new Date(time).toISOString();
}

// ── Espacio en disco ────────────────────────────────────────────────────────
function storageInfo(root) {
  let free = null, total = null;
  try {
    const stat = fs.statfsSync(base(root));
    free = stat.bavail * stat.bsize;
    total = stat.blocks * stat.bsize;
  } catch { /* sistema sin statfs */ }
  return { root: base(root), free, total, low: free !== null && free < LOW_FREE, critical: free !== null && free < MIN_FREE };
}

function ensureSpace(root, needed = MIN_FREE) {
  const info = storageInfo(root);
  if (info.free !== null && info.free < needed) {
    throw Error('Queda poco espacio en el disco (' + Math.round(info.free / 1048576) + ' MB). Libera espacio antes de continuar.');
  }
  return info;
}

// ── Tomas: una sola toma activa por sección ─────────────────────────────────
function tempDir(root, id, takeId) { return path.join(projectDir(root, id), 'Temporales', validId(takeId, 'toma')); }
function draftOf(root, id, takeId) { return store.readJSON(path.join(tempDir(root, id, takeId), 'toma.json')); }

function beginTake(root, { id, sectionId }) {
  const project = read(root, id);
  section(project, sectionId);
  ensureSpace(root);
  const takeId = uid();
  const draft = { id: takeId, projectId: id, sectionId, at: now(), chunks: 0, bytes: 0 };
  store.atomic(path.join(tempDir(root, id, takeId), 'toma.json'), draft);
  return draft;
}

function appendTake(root, { id, takeId, sequence, data }) {
  const dir = tempDir(root, id, takeId);
  const draft = draftOf(root, id, takeId);
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw Error('Fragmento inválido');
  if (sequence < draft.chunks) return draft.chunks;
  if (sequence !== draft.chunks || typeof data !== 'string' || data.length > 40 * 1024 * 1024) throw Error('Fragmento inválido');
  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length) throw Error('Fragmento vacío');
  const file = path.join(dir, 'toma.webm');
  const handle = fs.openSync(file, fs.existsSync(file) ? 'r+' : 'w');
  try {
    let written = 0;
    while (written < buffer.length) written += fs.writeSync(handle, buffer, written, buffer.length - written, draft.bytes + written);
    fs.ftruncateSync(handle, draft.bytes + buffer.length);
    fs.fsyncSync(handle);
  } finally { fs.closeSync(handle); }
  draft.bytes += buffer.length;
  draft.chunks++;
  store.atomic(path.join(dir, 'toma.json'), draft);
  return draft.chunks;
}

function pendingTakes(root, id) {
  const dir = path.join(projectDir(root, id), 'Temporales');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (!e.isDirectory() || !store.safeId(e.name)) return [];
    try {
      const draft = draftOf(root, id, e.name);
      const size = fs.statSync(path.join(dir, e.name, 'toma.webm')).size;
      return size >= 100 ? [{ ...draft, size }] : [];
    } catch { return []; }
  }).sort((a, b) => b.at.localeCompare(a.at));
}

function takeFile(root, id, takeId) { return path.join(tempDir(root, id, takeId), 'toma.webm'); }

async function inspectTake(root, { id, takeId }, media = require('./media.cjs')) {
  const file = takeFile(root, id, takeId);
  if (!fs.existsSync(file)) throw Error('La toma no llegó al disco');
  const info = await media.probe(file);
  const ok = info.width > 0 && info.height > 0 && info.hasAudio && info.duration >= 0.5;
  return { ...info, ok, size: fs.statSync(file).size };
}

function discardTake(root, { id, takeId }) {
  fs.rmSync(tempDir(root, id, takeId), { recursive: true, force: true });
  return true;
}

function removeTakeFiles(root, id, take) {
  for (const rel of [take.original, take.master]) {
    if (!rel) continue;
    try { fs.rmSync(resolveFile(root, id, rel), { force: true }); } catch { /* ya no existe */ }
  }
}

/**
 * Sustituye la toma de la sección de forma segura:
 * 1) verifica la toma nueva, 2) la copia a su carpeta definitiva y comprueba el tamaño,
 * 3) actualiza el proyecto de forma atómica y 4) solo entonces borra la toma anterior.
 */
async function commitTake(root, { id, takeId }, media = require('./media.cjs')) {
  const draft = draftOf(root, id, takeId);
  const info = await inspectTake(root, { id, takeId }, media);
  if (!info.ok) throw Error('La toma no tiene suficiente imagen y sonido. Vuelve a grabarla');
  const source = takeFile(root, id, takeId);
  const relative = 'Tomas/' + validId(draft.sectionId, 'sección') + '/' + takeId + '.webm';
  const destination = resolveFile(root, id, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partial = destination + '.parcial';
  fs.copyFileSync(source, partial);
  const copied = fs.statSync(partial).size;
  if (copied !== fs.statSync(source).size) { fs.rmSync(partial, { force: true }); throw Error('La copia de la toma no se completó'); }
  fs.renameSync(partial, destination);
  const project = read(root, id);
  const target = section(project, draft.sectionId);
  const previous = target.take;
  target.take = { id: takeId, original: relative, master: null, duration: frame(info.duration), width: info.width, height: info.height,
    size: copied, recordedAt: draft.at };
  if (target.transcript?.takeId !== takeId) target.transcript = null;
  target.cuts = [];
  target.ctaOff = [];
  target.auto = null;
  target.layouts = target.layouts.length ? normalizeLayouts(target.layouts.map(l => ({ ...l })), target.take.duration) : [];
  if (target.layouts.length) target.layouts.at(-1).end = target.take.duration;
  write(root, project);
  if (previous && previous.id !== takeId) removeTakeFiles(root, id, previous);
  discardTake(root, { id, takeId });
  return { project, sectionId: draft.sectionId, take: target.take };
}

/** Copia MP4 indexada (H.264 CFR 30 FPS + AAC 48 kHz) para buscar con precisión y exportar. */
async function prepareMaster(root, { id, sectionId }, signal, media = require('./media.cjs')) {
  let project = read(root, id);
  let s = section(project, sectionId);
  if (!s.take) throw Error('La sección no tiene grabación');
  if (s.take.master && fs.existsSync(resolveFile(root, id, s.take.master))) return s.take;
  const takeId = s.take.id;
  const source = resolveFile(root, id, s.take.original);
  const relative = 'Tomas/' + sectionId + '/' + takeId + '.mp4';
  const destination = resolveFile(root, id, relative);
  const partial = destination.replace(/\.mp4$/, '.parcial.mp4');
  await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-i', source,
    '-vf', 'scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,setsar=1,fps=30', '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '18', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', partial], signal);
  const info = await media.probe(partial);
  if (!info.hasAudio || info.duration < 0.5) { fs.rmSync(partial, { force: true }); throw Error('No se pudo preparar la toma'); }
  fs.renameSync(partial, destination);
  project = read(root, id);
  s = section(project, sectionId);
  if (s.take?.id !== takeId) { fs.rmSync(destination, { force: true }); return null; }
  s.take.master = relative;
  s.take.duration = frame(info.duration);
  if (s.layouts.length) { s.layouts = normalizeLayouts(s.layouts, s.take.duration); if (s.layouts.length) s.layouts.at(-1).end = s.take.duration; }
  write(root, project);
  return s.take;
}

// ── Imágenes y audio ────────────────────────────────────────────────────────
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif', '.heic']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);

async function saveImage(root, id, input, { name, source } = {}) {
  const sharp = require('sharp');
  const project = read(root, id);
  const imageId = uid();
  const relative = 'Imagenes/' + imageId + '.jpg';
  const file = resolveFile(root, id, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const info = await sharp(input, { limitInputPixels: 120e6 }).rotate().resize({ width: 3840, height: 3840, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#000000' }).jpeg({ quality: 92, progressive: false, mozjpeg: false, chromaSubsampling: '4:2:0' }).toFile(file); // JPEG básico: FFmpeg no decodifica algunos JPEG progresivos de mozjpeg
  const latest = read(root, id);
  const image = { id: imageId, file: relative, name: text(name || 'Imagen', 160), width: info.width, height: info.height, addedAt: now(),
    source: source || { provider: 'propia', license: 'Imagen propia del usuario', attribution: '' } };
  latest.images.push(image);
  write(root, latest);
  return { image, project: latest, wasEmpty: !project.images.length };
}

async function importImageFile(root, id, file) {
  if (!IMAGE_EXT.has(path.extname(file).toLowerCase())) throw Error('Selecciona una imagen');
  return saveImage(root, id, file, { name: path.basename(file) });
}

function removeImage(root, { id, imageId }) {
  const project = read(root, id);
  const image = project.images.find(i => i.id === imageId);
  if (!image) return project;
  project.images = project.images.filter(i => i.id !== imageId);
  for (const s of project.sections) {
    s.imageIds = s.imageIds.filter(x => x !== imageId);
    for (const l of s.layouts) if (l.imageId === imageId) l.imageId = null;
  }
  if (project.settings.background.imageId === imageId) project.settings.background.imageId = null;
  write(root, project);
  try { fs.rmSync(resolveFile(root, id, image.file), { force: true }); } catch { /* sin archivo */ }
  return project;
}

async function importAudioFile(root, id, file, { kind = 'music', license = '' } = {}, media = require('./media.cjs')) {
  const ext = path.extname(file).toLowerCase();
  if (!AUDIO_EXT.has(ext)) throw Error('Selecciona un archivo de audio (mp3, wav, m4a, aac, ogg o flac)');
  const info = await media.probe(file);
  if (!info.hasAudio || info.duration < 1) throw Error('El archivo no contiene audio utilizable');
  const audioId = uid();
  const relative = 'Audio/' + audioId + ext;
  fs.copyFileSync(file, resolveFile(root, id, relative));
  const project = read(root, id);
  const item = { id: audioId, file: relative, name: path.basename(file).slice(0, 160), kind: kind === 'sfx' ? 'sfx' : 'music', duration: info.duration,
    origin: 'propia', license: text(license, 300) || 'Declarada por el usuario con derechos para YouTube' };
  project.audio.push(item);
  return { item, project: write(root, project) };
}

function removeAudio(root, { id, audioId }) {
  const project = read(root, id);
  const item = project.audio.find(a => a.id === audioId);
  if (!item) return project;
  project.audio = project.audio.filter(a => a.id !== audioId);
  for (const s of project.sections) if (s.audio.musicId === audioId) s.audio.musicId = null;
  write(root, project);
  try { fs.rmSync(resolveFile(root, id, item.file), { force: true }); } catch { /* sin archivo */ }
  return project;
}

// ── Copias de seguridad (.tar con proyecto, guion, tomas, imágenes y audio) ──
const TAR_SKIP = /^(Temporales|Exportaciones)\/|\.parcial|\.mp4$/;

function tarHeader(name, size, mtime) {
  const header = Buffer.alloc(512, 0);
  if (Buffer.byteLength(name) > 100) throw Error('Ruta demasiado larga para la copia: ' + name);
  if (size >= 8 ** 11) throw Error('Archivo demasiado grande para la copia');
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(size.toString(8).padStart(11, '0') + '\0', 124);
  header.write(Math.floor(mtime / 1000).toString(8).padStart(11, '0') + '\0', 136);
  header.write('        ', 148);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return header;
}

function walk(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const rel = prefix + e.name;
    if (e.isDirectory()) return walk(path.join(dir, e.name), rel + '/');
    return e.isFile() ? [rel] : [];
  });
}

function exportBackup(root, { id, destination }) {
  const project = read(root, id);
  const dir = projectDir(root, id);
  const files = walk(dir).filter(rel => !TAR_SKIP.test(rel));
  const partial = destination + '.parcial';
  const out = fs.openSync(partial, 'w');
  let bytes = 0;
  try {
    const write = buffer => { fs.writeSync(out, buffer); bytes += buffer.length; };
    for (const rel of ['proyecto.json', ...files.filter(f => f !== 'proyecto.json')]) {
      const file = path.join(dir, rel);
      const stat = fs.statSync(file);
      write(tarHeader('once-directo/' + rel, stat.size, stat.mtimeMs));
      const input = fs.openSync(file, 'r');
      try {
        const chunk = Buffer.alloc(4 * 1024 * 1024);
        let position = 0, read;
        while ((read = fs.readSync(input, chunk, 0, chunk.length, position)) > 0) { write(chunk.subarray(0, read)); position += read; }
      } finally { fs.closeSync(input); }
      const pad = (512 - stat.size % 512) % 512;
      if (pad) write(Buffer.alloc(pad));
    }
    write(Buffer.alloc(1024));
    fs.fsyncSync(out);
  } finally { fs.closeSync(out); }
  fs.renameSync(partial, destination);
  return { file: destination, bytes, title: project.title, sections: project.sections.length };
}

function importBackup(root, { file }) {
  const titles = new Set(listProjects(root).map(p => p.title));
  const input = fs.openSync(file, 'r');
  const id = uid();
  const dir = projectDir(root, id);
  const header = Buffer.alloc(512);
  let position = 0, foundProject = false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    while (fs.readSync(input, header, 0, 512, position) === 512) {
      position += 512;
      if (header.every(b => b === 0)) break;
      const name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '');
      const size = parseInt(header.toString('ascii', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8);
      const type = String.fromCharCode(header[156] || 48);
      if (!Number.isSafeInteger(size) || size < 0) throw Error('Copia de seguridad dañada');
      if (!name.startsWith('once-directo/')) throw Error('El archivo no es una copia de Videos largos directos');
      const rel = name.slice('once-directo/'.length);
      const valid = /^(proyecto\.json|(Tomas\/[a-zA-Z0-9_-]{5,90}\/[a-zA-Z0-9_-]{5,90}\.webm)|(Imagenes|Audio)\/[a-zA-Z0-9_-]{5,90}\.[a-z0-9]{2,5})$/.test(rel);
      if ((type === '0' || type === '\0') && valid) {
        const target = path.join(dir, ...rel.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const output = fs.openSync(target, 'w');
        try {
          const chunk = Buffer.alloc(4 * 1024 * 1024);
          let left = size, at = position;
          while (left > 0) {
            const read = fs.readSync(input, chunk, 0, Math.min(chunk.length, left), at);
            if (read <= 0) throw Error('Copia de seguridad incompleta');
            fs.writeSync(output, chunk, 0, read);
            left -= read; at += read;
          }
        } finally { fs.closeSync(output); }
        if (rel === 'proyecto.json') foundProject = true;
      }
      position += Math.ceil(size / 512) * 512;
    }
    if (!foundProject) throw Error('La copia no contiene el proyecto');
    const project = store.readJSON(path.join(dir, 'proyecto.json'));
    if (project.kind !== 'direct-long' || !Array.isArray(project.sections)) throw Error('La copia no es un proyecto de Videos largos directos');
    project.id = id;
    const exists = rel => { try { return fs.existsSync(resolveFile(root, id, rel)); } catch { return false; } };
    if (titles.has(project.title)) project.title = (project.title + ' (restaurado)').slice(0, 120);
    for (const s of project.sections) {
      if (s.take) {
        s.take.master = null;
        if (!exists(s.take.original)) { s.take = null; s.transcript = null; }
      }
    }
    project.images = (project.images || []).filter(i => exists(i.file));
    project.audio = (project.audio || []).filter(a => exists(a.file));
    project.exports = [];
    for (const sub of ['Tomas', 'Imagenes', 'Audio', 'Exportaciones', 'Temporales']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
    write(root, project);
    return summary(project);
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  } finally { fs.closeSync(input); }
}

module.exports = {
  DIR, LAYOUTS, BACKGROUNDS, MOODS, SOUNDS, SUB_STYLES, FRAME, frame,
  projectDir, resolveFile, listProjects, createProject, getProject, renameProject, deleteProject, write, read,
  importScript, updateSection, addSection, removeSection, moveSection, saveSettings, normalizeLayouts, normalizeWords, progress, summary,
  storageInfo, ensureSpace, beginTake, appendTake, pendingTakes, inspectTake, discardTake, commitTake, prepareMaster, takeFile,
  saveImage, importImageFile, removeImage, importAudioFile, removeAudio, exportBackup, importBackup
};
