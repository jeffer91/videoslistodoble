'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const store = require('./store.cjs');
const media = require('./media.cjs');

const SCENES = new Set(['hook', 'body', 'closing']);
const FORMATS = new Set(['mp4', 'webm']);
const MAX_FILE = 1024 * 1024 * 1024;
const MAX_CHUNK = 256 * 1024;
const TAKE_ID = /^[a-f0-9-]{36}$/;
const TOKEN = /^[a-f0-9]{64}$/;

function linkToken(directory, safeStorage, create) {
  const file = path.join(directory, 'enlace-celular.json');
  if (fs.existsSync(file)) {
    const stored = store.readJSON(file);
    const secret = stored.encrypted
      ? safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64'))
      : stored.local;
    if (!TOKEN.test(secret)) throw Error('No se pudo leer el enlace guardado');
    return secret;
  }
  if (!create) return null;
  const secret = randomBytes(32).toString('hex');
  const stored = safeStorage.isEncryptionAvailable()
    ? { encrypted: safeStorage.encryptString(secret).toString('base64') }
    : { local: secret };
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(stored), { mode: 0o600, flag: 'wx' });
  return secret;
}

function folder(root, id) {
  if (typeof id !== 'string' || !TAKE_ID.test(id)) throw Error('Identificador de toma inválido');
  return path.join(root, 'Temporales', 'Celular', id);
}

const metadata = (root, id) => path.join(folder(root, id), 'toma.json');
const draftOf = (root, id) => store.readJSON(metadata(root, id));
const rawFile = (root, draft) => path.join(folder(root, draft.id), 'original.' + draft.format);

function begin(root, { projectId, scene }) {
  const project = store.getProject(root, projectId);
  if (!SCENES.has(scene) || !project.scenes[scene]) throw Error('Escena inválida');
  const id = randomUUID();
  const draft = { id, projectId, scene, at: new Date().toISOString(), size: 0, offset: 0 };
  store.atomic(metadata(root, id), draft);
  return { id, projectId, scene, title: project.title };
}

function receipt(draft) {
  return { id: draft.id, projectId: draft.projectId, scene: draft.scene, assetId: draft.id };
}

function open(root, { id, format, size }) {
  const draft = draftOf(root, id);
  if (!FORMATS.has(format) || !Number.isSafeInteger(size) || size < 100 || size > MAX_FILE) {
    throw Error('La toma debe ser un video de hasta 1 GB');
  }
  if ((draft.format && draft.format !== format) || (draft.size && draft.size !== size)) {
    throw Error('El archivo de la toma cambió durante el envío');
  }
  if (draft.saved) return { saved: receipt(draft) };
  store.getProject(root, draft.projectId);
  draft.format = format;
  draft.size = size;
  store.atomic(metadata(root, id), draft);
  return { offset: draft.offset };
}

function append(root, { id, offset, data }) {
  const draft = draftOf(root, id);
  if (!draft.size || draft.saved || offset !== draft.offset || !(data instanceof Uint8Array)
    || !data.length || data.length > MAX_CHUNK || offset + data.length > draft.size) {
    throw Error('El fragmento no coincide con la toma pendiente');
  }
  const file = rawFile(root, draft);
  const handle = fs.openSync(file, fs.existsSync(file) ? 'r+' : 'w+');
  try {
    if (fs.fstatSync(handle).size < offset) throw Error('Faltan datos en el archivo temporal');
    let written = 0;
    while (written < data.length) {
      const count = fs.writeSync(handle, data, written, data.length - written, offset + written);
      if (!count) throw Error('No se pudo escribir la grabación');
      written += count;
    }
    fs.ftruncateSync(handle, offset + written);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  draft.offset += data.length;
  store.atomic(metadata(root, id), draft);
  return { offset: draft.offset };
}

async function finish(root, id) {
  const draft = draftOf(root, id);
  if (draft.saved) return receipt(draft);
  if (draft.size < 100 || draft.offset !== draft.size) throw Error('Todavía faltan fragmentos de la toma');
  const projectFile = store.projectFile(root, draft.projectId);
  const source = rawFile(root, draft);
  const project = store.getProject(root, draft.projectId);
  if (!project.assets.some(asset => asset.id === id)) {
    const original = await media.probe(source);
    if (!original.width || !original.height || !original.hasAudio || original.duration < .1) {
      throw Error('La toma no contiene suficiente video y audio. Sigue disponible en el celular.');
    }
    const converted = path.join(folder(root, id), 'cuadrado.mp4');
    await media.command(media.toolPath('ffmpeg'), [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
      '-map', '0:v:0', '-map', '0:a:0',
      '-vf', "crop='min(iw,ih)':'min(iw,ih)',scale=1080:1080,setsar=1",
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', converted
    ]);
    const square = await media.probe(converted);
    if (square.width !== 1080 || square.height !== 1080 || !square.hasAudio || square.duration < .1) {
      throw Error('No se pudo verificar el encuadre cuadrado con audio');
    }

    // Volver a leer después de FFmpeg para incorporar las ediciones guardadas durante la conversión.
    const latest = store.getProject(root, draft.projectId);
    const directory = path.dirname(projectFile);
    fs.mkdirSync(path.join(directory, 'Originales'), { recursive: true });
    const date = draft.at.slice(0, 16).replace('T', ' ');
    const rawId = id + '-original';
    const files = [
      { id: rawId, type: 'video', file: 'Originales/' + rawId + '.' + draft.format,
        name: 'Celular original ' + date + '.' + draft.format, size: draft.size },
      { id, type: 'video', file: 'Originales/' + id + '.mp4',
        name: 'Celular cuadrado ' + date + '.mp4', size: fs.statSync(converted).size }
    ];
    for (const [index, asset] of files.entries()) {
      fs.copyFileSync(index === 0 ? source : converted, path.join(directory, asset.file));
    }
    latest.assets.push(...files);
    const scene = latest.scenes[draft.scene];
    Object.assign(scene, { video: id, start: 0, end: Math.min(square.duration, 180), silences: [], cuts: [], approved: false });
    delete scene.cutHistory;
    latest.updatedAt = new Date().toISOString();
    store.atomic(projectFile, latest);
  }
  draft.saved = true;
  store.atomic(metadata(root, id), draft);
  fs.rmSync(source, { force: true });
  fs.rmSync(path.join(folder(root, id), 'cuadrado.mp4'), { force: true });
  return receipt(draft);
}

function cancel(root, id) {
  const draft = draftOf(root, id);
  if (!draft.size && !draft.saved) fs.rmSync(folder(root, id), { recursive: true, force: true });
}

function install({ app, root, register, safeStorage, clipboard }) {
  const finishing = new Map();
  const profile = process.env.RECORDS_TEST_ROOT ? path.join(root, 'Configuracion') : app.getPath('userData');
  register('mobile:link', ({ create }) => linkToken(profile, safeStorage, create === true));
  register('mobile:copy', ({ url }) => {
    const prefix = 'https://jeffer91.github.io/videoslistodoble/grabador/#';
    const token = linkToken(profile, safeStorage, false);
    if (!token || url !== prefix + token) throw Error('Enlace inválido');
    clipboard.writeText(url);
    return true;
  });
  const actions = {
    begin: data => begin(root, data),
    cancel: data => cancel(root, data.id),
    open: data => open(root, data),
    append: data => append(root, data),
    finish: ({ id }) => {
      if (!finishing.has(id)) finishing.set(id, finish(root, id).finally(() => finishing.delete(id)));
      return finishing.get(id);
    }
  };
  register('mobile:record', ({ action, data }) => {
    if (!Object.hasOwn(actions, action)) throw Error('Acción móvil inválida');
    return actions[action](data || {});
  });
}

module.exports = { install, begin, open, append, finish };
