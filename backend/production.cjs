'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const store = require('./store.cjs');
const catalog = require('./catalog.cjs');

const TAKE_DIR = ['Temporales', 'Tomas'];
const SCENES = ['hook', 'body', 'closing'];
const EIGHT_MINUTES = 480;
const HOUR = 60 * 60 * 1000;

function validId(id) {
  if (!store.safeId(id)) throw Error('Identificador inválido');
  return id;
}

function takeDir(root, id) {
  return path.join(root, ...TAKE_DIR, validId(id));
}

function take(root, id) {
  return store.readJSON(path.join(takeDir(root, id), 'toma.json'));
}

function beginTake(root, { projectId, scene }) {
  const project = store.getProject(root, projectId);
  if (!SCENES.includes(scene) || !project.scenes[scene]) throw Error('Escena inválida');
  const id = randomUUID();
  const draft = { id, projectId, scene, at: new Date().toISOString(), chunks: 0, bytes: 0 };
  store.atomic(path.join(takeDir(root, id), 'toma.json'), draft);
  return draft;
}

function appendTake(root, { id, sequence, data }) {
  const draft = take(root, id);
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw Error('Fragmento de la grabación inválido');
  if (sequence < draft.chunks) return draft.chunks;
  if (sequence !== draft.chunks || typeof data !== 'string' || data.length > 32 * 1024 * 1024) {
    throw Error('Fragmento de la grabación inválido');
  }
  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length) throw Error('Fragmento vacío');
  const file = path.join(takeDir(root, id), 'toma.webm');
  const handle = fs.openSync(file, fs.existsSync(file) ? 'r+' : 'w');
  try {
    let written = 0;
    while (written < buffer.length) {
      written += fs.writeSync(handle, buffer, written, buffer.length - written, draft.bytes + written);
    }
    fs.ftruncateSync(handle, draft.bytes + buffer.length);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  draft.bytes += buffer.length;
  draft.chunks++;
  store.atomic(path.join(takeDir(root, id), 'toma.json'), draft);
  return draft.chunks;
}

function listTakes(root, projectId) {
  const dir = path.join(root, ...TAKE_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (!entry.isDirectory() || !store.safeId(entry.name)) return [];
    try {
      const draft = take(root, entry.name);
      const size = fs.statSync(path.join(dir, entry.name, 'toma.webm')).size;
      return size >= 100 && (!projectId || draft.projectId === projectId) ? [draft] : [];
    } catch {
      return [];
    }
  }).sort((a, b) => b.at.localeCompare(a.at));
}

function discardTake(root, id) {
  fs.rmSync(takeDir(root, id), { recursive: true, force: true });
  return true;
}

async function keepTake(root, id) {
  const media = require('./media.cjs');
  const draft = take(root, id);
  const source = path.join(takeDir(root, id), 'toma.webm');
  const info = await media.probe(source);
  if (!info.width || !info.height || !info.hasAudio || info.duration < .1) {
    throw Error('La toma aún no tiene datos suficientes de cámara y micrófono');
  }
  const project = store.getProject(root, draft.projectId);
  if (project.assets.some(item => item.id === id)) {
    discardTake(root, id);
    return { projectId: project.id, scene: draft.scene, assetId: id };
  }
  const asset = {
    id, type: 'video', file: 'Originales/' + id + '.webm', size: fs.statSync(source).size,
    name: 'Grabación cuadrada ' + draft.at.slice(0, 16).replace('T', ' ') + '.webm'
  };
  const destination = path.join(root, 'Proyectos', project.id, asset.file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  project.assets.push(asset);
  Object.assign(project.scenes[draft.scene], {
    video: id, start: 0, end: Math.min(info.duration, 180), silences: [], cuts: [], approved: false
  });
  delete project.scenes[draft.scene].cutHistory;
  project.updatedAt = new Date().toISOString();
  store.atomic(store.projectFile(root, project.id), project);
  discardTake(root, id);
  return { projectId: project.id, scene: draft.scene, assetId: id };
}

async function squareClip(root, { projectId, assetId }, signal = new AbortController().signal) {
  const media = require('./media.cjs');
  const source = store.resolveAsset(root, projectId, assetId);
  const info = await media.probe(source);
  if (!info.width || !info.height) throw Error('Selecciona un video');
  const dir = media.temporary(root);
  const output = path.join(dir, 'cuadrado.mp4');
  const filter = '[0:v]split[bg][fg];' +
    '[bg]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,boxblur=24:2[b];' +
    '[fg]scale=1080:1080:force_original_aspect_ratio=decrease:force_divisible_by=2[f];' +
    '[b][f]overlay=(W-w)/2:(H-h)/2,setsar=1[v]';
  try {
    await media.command(media.toolPath('ffmpeg'), [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-filter_complex', filter,
      '-map', '[v]', '-map', '0:a:0?', '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output
    ], signal);
    const name = store.getProject(root, projectId).assets.find(asset => asset.id === assetId).name;
    return store.importAsset(root, projectId, output, 'Cuadrado - ' + path.parse(name).name + '.mp4');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readState(root, name, initial) {
  const file = path.join(root, 'Configuracion', name + '.json');
  return fs.existsSync(file) ? store.readJSON(file) : initial;
}

function writeState(root, name, value) {
  store.atomic(path.join(root, 'Configuracion', name + '.json'), value);
  return value;
}

function listIdeas(root) {
  return readState(root, 'ideas', []);
}

function addIdeas(root, input) {
  const list = Array.isArray(input) ? input : [input];
  if (!list.length || list.length > 100) throw Error('Importa entre 1 y 100 ideas');
  const existing = listIdeas(root);
  const date = new Date().toISOString().slice(0, 10);
  const entries = list.map(item => {
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    if (!title || title.length > 120) throw Error('Cada idea necesita un título de hasta 120 caracteres');
    const source = String(item.source ?? '').trim();
    if (!source || source.length > 1000) throw Error('Cada idea necesita una fuente');
    return {
      id: randomUUID(), title, source, date: catalog.normalizeDate(item.date) || date,
      tags: catalog.normalizeTags(item.tags), notes: catalog.normalizeNotes(item.notes),
      fromClaude: item.fromClaude === true, status: 'pendiente', projectId: null
    };
  });
  writeState(root, 'ideas', [...entries, ...existing]);
  return entries;
}

function decideIdea(root, { id, decision, plannedDate }) {
  const ideas = listIdeas(root);
  const item = ideas.find(idea => idea.id === id);
  if (!item) throw Error('La idea no existe');
  if (item.status === 'aprobada') return item;
  if (!['aprobada', 'descartada', 'pendiente'].includes(decision)) throw Error('Decisión inválida');
  if (decision === 'aprobada') {
    const existing = store.listProjects(root).find(project => project.ideaId === id);
    const project = existing || store.createProject(root, {
      title: item.title, tags: item.tags, notes: [item.source, item.notes].filter(Boolean).join('\n').slice(0, 4000),
      plannedDate: catalog.normalizeDate(plannedDate), ideaId: id, withClaude: item.fromClaude
    });
    item.projectId = project.id;
  }
  item.status = decision;
  writeState(root, 'ideas', ideas);
  return item;
}

function backupStatus(root) {
  return readState(root, 'respaldo', { directory: '', hours: 24, lastAt: null, lastPath: '', error: '' });
}

function isInside(parent, file) {
  const relative = path.relative(parent, file);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

function setBackup(root, { directory, hours }) {
  const current = backupStatus(root);
  const target = directory === undefined ? current.directory : directory;
  if (target) {
    const realTarget = fs.realpathSync(target);
    if (!fs.statSync(realTarget).isDirectory() || isInside(fs.realpathSync(root), realTarget)) {
      throw Error('El respaldo debe ir en otra carpeta o unidad fuera de la biblioteca');
    }
  }
  const interval = Number(hours ?? current.hours);
  if (!Number.isInteger(interval) || interval < 1 || interval > 168) throw Error('Intervalo de respaldo inválido');
  return writeState(root, 'respaldo', { ...current, directory: target, hours: interval, error: '' });
}

async function runBackup(root) {
  const settings = backupStatus(root);
  if (!settings.directory) throw Error('Elige una carpeta para los respaldos');
  const directory = fs.realpathSync(settings.directory);
  if (isInside(fs.realpathSync(root), directory)) throw Error('La carpeta de respaldo está dentro de la biblioteca');
  const now = new Date().toISOString();
  const target = path.join(directory, '11-Records-Studio-' + now.replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
  const partial = target + '.incompleto';
  const dirs = ['Proyectos', 'Compilaciones', 'Exportaciones', 'Recursos', 'Configuracion'];
  const omitted = new Set(['cuentas-cifradas.json', 'respaldo.json']);
  const allowed = base => !omitted.has(base) && !base.endsWith('.tmp') && base !== 'Previews';
  function signature(relative) {
    const file = path.join(root, relative);
    const stats = fs.lstatSync(file);
    if (stats.isSymbolicLink()) return [];
    if (!stats.isDirectory()) return [[relative, stats.size, stats.mtimeMs]];
    return fs.readdirSync(file).filter(allowed).sort().flatMap(base => signature(path.join(relative, base)));
  }
  const snapshot = () => JSON.stringify(dirs.flatMap(signature));
  await fs.promises.mkdir(partial);
  try {
    const before = snapshot();
    for (const name of dirs) {
      await fs.promises.cp(path.join(root, name), path.join(partial, name), {
        recursive: true, errorOnExist: true, force: false,
        filter: async source => {
          const base = path.basename(source);
          return allowed(base) && !(await fs.promises.lstat(source)).isSymbolicLink();
        }
      });
    }
    if (snapshot() !== before) throw Error('La biblioteca cambió durante la copia. Intenta de nuevo tras terminar de guardar.');
    await fs.promises.rename(partial, target);
    writeState(root, 'respaldo', { ...backupStatus(root), lastAt: now, lastPath: target, error: '' });
    return backupStatus(root);
  } catch (error) {
    await fs.promises.rm(partial, { recursive: true, force: true });
    writeState(root, 'respaldo', { ...backupStatus(root), error: 'No se pudo completar el respaldo: ' + error.message });
    throw error;
  }
}

function shouldBackup(root, now = Date.now()) {
  const settings = backupStatus(root);
  return Boolean(settings.directory && (!settings.lastAt || now - Date.parse(settings.lastAt) >= settings.hours * HOUR));
}

async function compilationReadiness(root) {
  const media = require('./media.cjs');
  const weeks = store.listWeeks(root);
  const thematic = new Set(weeks.filter(week => week.kind === 'category').map(week => week.id));
  const projects = store.listProjects(root).filter(project => project.status !== 'auxiliary' && project.exports.length);
  const durations = new Map();
  for (const project of projects) {
    try {
      const scene = require('./editing.cjs').effectiveScene(store.getProject(root, project.id), 'body');
      const file = store.resolveAsset(root, project.id, scene.video);
      const stat = fs.statSync(file);
      const key = file + ':' + stat.size + ':' + stat.mtimeMs;
      let duration = durationCache.get(key);
      if (duration === undefined) {
        duration = (await media.probe(file)).duration;
        if (durationCache.size >= 1024) durationCache.delete(durationCache.keys().next().value);
        durationCache.set(key, duration);
      }
      const rate = Number(scene.playbackSpeed) || 1;
      const ranges = media.retainedRanges(scene, duration);
      const added = require('./editing.cjs').plannedMemes(scene, ranges, rate).reduce((sum, meme) => sum + meme.duration, 0);
      durations.set(project.id, media.selectedDuration(scene, duration) / rate + added);
    } catch {
      // Los archivos ausentes no aportan tiempo al aviso.
    }
  }
  const durationOf = group => {
    const seconds = group.map(item => durations.get(item.id)).filter(value => value >= .5);
    return seconds.reduce((sum, value) => sum + value, 0) + Math.max(0, seconds.length - 1);
  };
  const weekly = durationOf(projects.filter(item => !item.usedBy.some(id => !thematic.has(id))));
  const tags = catalog.tagIndex(projects);
  const categories = catalog.TAG_FIELDS.flatMap(field => tags[field].map(({ value }) => ({
    field, value, seconds: durationOf(projects.filter(item => catalog.hasTag(item, field, value)))
  }))).filter(item => item.seconds >= EIGHT_MINUTES).sort((a, b) => b.seconds - a.seconds);
  return { weekly, categories };
}

const durationCache = new Map();

function chapterText(chapters) {
  const clock = seconds => {
    const number = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(number / 3600);
    const minutes = Math.floor(number / 60) % 60;
    const start = hours ? hours + ':' + String(minutes).padStart(2, '0') : String(minutes).padStart(2, '0');
    return start + ':' + String(number % 60).padStart(2, '0');
  };
  return chapters.filter(chapter => !chapter.transition && chapter.duration > 0)
    .map(chapter => clock(chapter.start) + ' ' + String(chapter.label).replace(/\s+/g, ' ').trim())
    .join('\n') + '\n';
}

module.exports = {
  beginTake, appendTake, listTakes, keepTake, discardTake, squareClip,
  readState, writeState, listIdeas, addIdeas, decideIdea,
  backupStatus, setBackup, runBackup, shouldBackup, compilationReadiness,
  chapterText, EIGHT_MINUTES, isInside
};
