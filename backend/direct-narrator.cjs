'use strict';
/**
 * Videos largos directos · narrador de las transiciones.
 *
 * Una voz neuronal local (Piper, licencia MIT) dice el título de cada sección
 * mientras corre su cartela de transición. Piper y la voz (es_MX «ald», de
 * dominio público) se descargan una sola vez, verificadas, y después todo
 * funciona sin internet y sin coste. La locución se guarda en caché según el
 * texto, así que solo se genera de nuevo cuando cambia el título.
 *
 * Tiempos dentro de la transición:
 *   0,0 s   impacto + golpe de la música de tráiler
 *   0,7 s   el narrador dice el título (START)
 *   +1,0 s  tras terminar la voz, golpe final y entra la sección (TAIL)
 * La transición se alarga sola si la voz no cabe (hasta MAX segundos).
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const START = 0.7;
const TAIL = 1.0;
const MAX = 10;
const CACHE_VERSION = 1;

const PIPER_VERSION = '2023.11.14-2';
const PIPER = {
  win32: { url: 'https://github.com/rhasspy/piper/releases/download/' + PIPER_VERSION + '/piper_windows_amd64.zip',
    sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea', limit: 30 * 1024 * 1024, archive: 'piper.zip', exe: 'piper.exe' },
  linux: { url: 'https://github.com/rhasspy/piper/releases/download/' + PIPER_VERSION + '/piper_linux_x86_64.tar.gz',
    sha256: 'a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992', limit: 32 * 1024 * 1024, archive: 'piper.tar.gz', exe: 'piper' }
};
// Voz masculina de español de México, dominio público (Unlicense). Verificación MD5 publicada por Piper en voices.json.
const VOICE = {
  key: 'es_MX-ald-medium',
  base: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_MX/ald/medium/',
  model: { size: 63201294, md5: '86374058e59b41ac3b7fe4181e1daad6' },
  config: { size: 4889, md5: '31c5463bf001d6e69bf57fc5916c0908' }
};

const dir = root => path.join(root, 'Recursos', 'Piper');
const cacheDir = root => path.join(root, 'Recursos', 'Directos', 'Narrador');

/** Texto que dice el narrador: el título de la transición (o de la sección), sin mayúsculas sostenidas. */
function narratorText(section) {
  const raw = String(section?.transition?.title || section?.title || '').replace(/[━─═*#[\]_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const letters = raw.replace(/[^\p{L}]/gu, '');
  if (!letters || letters !== letters.toUpperCase()) return raw;
  const lower = raw.toLocaleLowerCase('es');
  return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1);
}

/** ¿Lleva narrador esta transición? Nunca en la introducción. */
function wants(project, section) {
  return Boolean(section && !section.intro && project.settings.transitions?.narrator !== false &&
    section.transition?.enabled !== false && section.transition?.narrator !== false && narratorText(section));
}

const hashOf = text => createHash('sha256').update(CACHE_VERSION + '|' + VOICE.key + '|' + text).digest('hex').slice(0, 24);
const fileFor = (root, hash) => path.join(cacheDir(root), hash + '.m4a');

/** Duración de la transición con narrador: la configurada o la que haga falta para que la voz quepa. */
function transitionLength(base, narration) {
  if (!narration?.duration) return base;
  return Math.min(MAX, Math.max(base, Math.ceil((START + narration.duration + TAIL) * 10) / 10));
}

/** Locución vigente de una sección (o null si falta o es de otro título). */
function current(root, project, section) {
  const n = section?.transition?.narration;
  if (!wants(project, section) || !n || n.text !== narratorText(section) || n.hash !== hashOf(n.text)) return null;
  return root && !fs.existsSync(fileFor(root, n.hash)) ? null : n;
}

// ── Instalación de Piper ─────────────────────────────────────────────────────
function findExecutable(directory, name) {
  if (!fs.existsSync(directory)) return '';
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name) return candidate;
    if (entry.isDirectory()) { const found = findExecutable(candidate, name); if (found) return found; }
  }
  return '';
}

function paths(root) {
  const spec = PIPER[process.platform];
  const base = path.join(dir(root), PIPER_VERSION);
  return {
    exe: process.env.RECORDS_PIPER || (spec ? findExecutable(path.join(base, 'motor'), spec.exe) : ''),
    model: process.env.RECORDS_PIPER_MODEL || path.join(dir(root), 'voces', VOICE.key + '.onnx')
  };
}

function status(root) {
  const p = paths(root);
  const ready = Boolean(p.exe && fs.existsSync(p.exe) && fs.existsSync(p.model) && fs.existsSync(p.model + '.json'));
  return { ready, voice: VOICE.key, supported: Boolean(PIPER[process.platform] || process.env.RECORDS_PIPER) };
}

async function download(url, file, { md5, size, sha256, limit, label }, signal) {
  if (sha256) return require('./verified-download.cjs').ensure(file, { url, sha256, limit, label }, signal);
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const partial = file + '.' + process.pid + '.descarga';
  try {
    const response = await fetch(url, { signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(20 * 60000)]) });
    if (!response.ok || !response.body) throw Error('No se pudo descargar ' + label + ' · HTTP ' + response.status);
    const hash = createHash('md5');
    const out = fs.createWriteStream(partial, { flags: 'w' });
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > size) throw Error('La descarga de ' + label + ' supera el tamaño previsto');
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
    }
    await new Promise((resolve, reject) => out.end(error => error ? reject(error) : resolve()));
    if (bytes !== size || hash.digest('hex') !== md5) throw Error('La descarga de ' + label + ' no coincide con la versión verificada');
    fs.renameSync(partial, file);
    return file;
  } finally { fs.rmSync(partial, { force: true }); }
}

const installing = new Map();
/** Descarga Piper y la voz una sola vez (≈ 85 MB). */
function install(root, signal, send = () => {}, media = require('./media.cjs')) {
  // RECORDS_PIPER=off desactiva el narrador (pruebas sin red).
  if (process.env.RECORDS_PIPER === 'off') return Promise.reject(Error('Narrador desactivado en este equipo'));
  if (status(root).ready) return Promise.resolve(status(root));
  if (installing.has(root)) return installing.get(root);
  const task = (async () => {
    const spec = PIPER[process.platform];
    const p = paths(root);
    if (!p.exe || !fs.existsSync(p.exe)) {
      if (!spec) throw Error('El narrador automático necesita Windows x64');
      send({ type: 'status', message: 'Descargando el narrador (Piper)…' });
      const base = path.join(dir(root), PIPER_VERSION);
      const archive = await download(spec.url, path.join(base, spec.archive), { ...spec, label: 'Piper' }, signal);
      const target = path.join(base, 'motor');
      fs.rmSync(target, { recursive: true, force: true });
      fs.mkdirSync(target, { recursive: true });
      const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
      await media.command(tar, ['-xf', archive, '-C', target], signal);
      if (!findExecutable(target, spec.exe)) throw Error('La descarga de Piper no contiene ' + spec.exe);
    }
    if (!fs.existsSync(p.model + '.json')) await download(VOICE.base + VOICE.key + '.onnx.json', p.model + '.json', { ...VOICE.config, label: 'la voz del narrador' }, signal);
    if (!fs.existsSync(p.model)) {
      send({ type: 'status', message: 'Descargando la voz del narrador (63 MB)…' });
      await download(VOICE.base + VOICE.key + '.onnx', p.model, { ...VOICE.model, label: 'la voz del narrador' }, signal);
    }
    const result = status(root);
    if (!result.ready) throw Error('No se pudo preparar el narrador');
    return result;
  })().finally(() => installing.delete(root));
  installing.set(root, task);
  return task;
}

// ── Locución ─────────────────────────────────────────────────────────────────
function runPiper(exe, model, text, output, signal) {
  return new Promise((resolve, reject) => {
    // Un poco más lenta y sin variación excesiva: tono de documental.
    const child = spawn(exe, ['--model', model, '--output_file', output, '--length_scale', '1.12', '--noise_scale', '0.5', '--noise_w', '0.3', '--sentence_silence', '0'],
      { cwd: path.dirname(exe), windowsHide: true, signal });
    let errors = '';
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => code === 0 && fs.existsSync(output) ? resolve(output) : reject(Error('El narrador no pudo generar la voz' + (errors ? ' · ' + errors.trim().split('\n').at(-1) : ''))));
    child.stdin.end(text.replace(/\s+/g, ' ') + '\n', 'utf8');
  });
}

/** Cadena de «voz de documental»: algo más grave, cuerpo, compresión, eco corto y volumen como la voz principal. */
const VOICE_FILTER = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,' +
  'aresample=48000,asetrate=48000*0.94,aresample=48000,atempo=1.0638,' +
  'equalizer=f=110:t=q:w=1:g=4,equalizer=f=3200:t=q:w=1.2:g=2.5,highpass=f=70,' +
  'acompressor=threshold=-20dB:ratio=3:attack=8:release=180,aecho=0.85:0.55:45|95:0.22|0.1,' +
  'loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000';

const pendingSpeech = new Map();
/** Genera (o reutiliza) la locución de un texto. Devuelve { text, hash, duration, voice, file }. */
async function speak(root, text, { signal, send } = {}, media = require('./media.cjs')) {
  const clean = String(text || '').trim();
  if (!clean) throw Error('No hay título que leer');
  const hash = hashOf(clean);
  const file = fileFor(root, hash);
  const done = async () => ({ text: clean, hash, voice: VOICE.key, duration: Math.round((await media.probe(file)).duration * 1000) / 1000, file });
  if (fs.existsSync(file)) return done();
  if (pendingSpeech.has(file)) return pendingSpeech.get(file);
  const task = (async () => {
    await install(root, signal, send, media);
    const p = paths(root);
    const temp = media.temporary(root);
    try {
      const raw = await runPiper(p.exe, p.model, clean, path.join(temp, 'voz.wav'), signal);
      fs.mkdirSync(cacheDir(root), { recursive: true });
      const partial = file.replace(/\.m4a$/, '.parcial.m4a');
      await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af', VOICE_FILTER,
        '-ac', '2', '-c:a', 'aac', '-b:a', '192k', partial], signal);
      fs.renameSync(partial, file);
      return done();
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  })().finally(() => pendingSpeech.delete(file));
  pendingSpeech.set(file, task);
  return task;
}

/**
 * Antes de exportar: genera la locución de cada transición que la necesita y
 * la guarda en el proyecto (texto, duración). Si el narrador no está
 * disponible (sin internet la primera vez) se exporta sin voz y se avisa.
 */
async function prepare(root, id, { signal, send = () => {} } = {}, media = require('./media.cjs')) {
  const store = require('./direct-store.cjs');
  const project = store.read(root, id);
  const missing = project.sections.filter(s => s.take && wants(project, s) && !current(root, project, s));
  if (!missing.length) return { project, warning: null };
  let warning = null;
  for (const [i, section] of missing.entries()) {
    send({ stage: 'prepare', percent: 5, message: 'Narrador · «' + narratorText(section) + '» (' + (i + 1) + '/' + missing.length + ')' });
    try {
      const n = await speak(root, narratorText(section), { signal, send: m => send({ stage: 'prepare', percent: 5, message: m.message }) }, media);
      store.setNarration(root, { id, sectionId: section.id, narration: { text: n.text, hash: n.hash, voice: n.voice, duration: n.duration } });
    } catch (error) {
      if (signal?.aborted) throw error;
      warning = 'Narrador no disponible: ' + error.message + '. Se exporta sin la voz en las transiciones.';
      break;
    }
  }
  return { project: store.read(root, id), warning };
}

module.exports = { START, TAIL, MAX, VOICE, PIPER, narratorText, wants, current, transitionLength, status, install, speak, prepare, fileFor, hashOf, VOICE_FILTER };
