'use strict';
// Limpieza de la voz con IA (DeepFilterNet) antes del montaje, análisis de la toma
// y muestras «antes / después» para escuchar el resultado.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const media = require('./media.cjs');
const editing = require('./editing.cjs');

const VERSION = '0.5.6';
const BASE = 'https://github.com/Rikorose/DeepFilterNet/releases/download/v' + VERSION + '/deep-filter-' + VERSION + '-';
const BINARIES = {
  'win32-x64': { url: BASE + 'x86_64-pc-windows-msvc.exe', sha256: '75e11fa16445f560cb6b021521ddb89e89270d13b83089705d98776f58fd7915', name: 'deep-filter.exe' },
  'linux-x64': { url: BASE + 'x86_64-unknown-linux-musl', sha256: '70775e251eee44c0f2451a1e833326cf8bcbbe304d3e7cd12851e6fce72ef7da', name: 'deep-filter' }
};
const LIMIT = 60 * 1024 * 1024;
const CACHE_DAYS = 14;

/** Ruta del limpiador por IA; se descarga una sola vez (verificado por SHA-256). Null si no hay versión para este equipo. */
async function denoiser(root, signal) {
  if (process.env.RECORDS_DEEPFILTER !== undefined) return process.env.RECORDS_DEEPFILTER || null;
  if (process.env.RECORDS_RENDER_TEST_MODE === '1') return null; // las pruebas no descargan nada
  const spec = BINARIES[process.platform + '-' + process.arch];
  if (!spec) return null;
  return require('./verified-download.cjs').ensure(path.join(root, 'Recursos', 'DeepFilterNet', VERSION, spec.name),
    { url: spec.url, sha256: spec.sha256, limit: LIMIT, label: 'el limpiador de voz', executable: true }, signal);
}

/** Ruido de fondo, nivel, picos y saturación de la voz. */
async function analyze(file, signal) {
  const { stderr } = await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-nostats', '-i', file, '-vn', '-ac', '1',
    '-af', 'astats=measure_perchannel=none:measure_overall=Peak_level+RMS_level+Noise_floor+Peak_count+Flat_factor',
    '-f', 'null', process.platform === 'win32' ? 'NUL' : '-'], signal);
  const read = label => {
    const match = stderr.match(new RegExp(label + ':\\s*(-?[\\d.]+|-inf)', 'g'))?.at(-1)?.split(':')[1]?.trim();
    return match === '-inf' ? -120 : Number(match);
  };
  const noise = read('Noise floor dB'), peak = read('Peak level dB'), rms = read('RMS level dB');
  const peaks = read('Peak count'), flat = read('Flat factor');
  const clipped = Number.isFinite(peak) && peak > -0.3 && ((Number.isFinite(peaks) && peaks > 30) || (Number.isFinite(flat) && flat > 3));
  const level = !Number.isFinite(noise) ? 'desconocido' : noise > -42 ? 'alto' : noise > -55 ? 'medio' : 'bajo';
  const notes = [];
  if (level === 'alto') notes.push('Ruido de fondo alto: se aplicó limpieza fuerte.');
  else if (level === 'medio') notes.push('Algo de ruido de fondo: limpieza moderada.');
  else if (level === 'bajo') notes.push('Grabación limpia: limpieza suave para no alterar la voz.');
  if (clipped) notes.push('La voz estaba saturada en algunos momentos: se reparó.');
  if (Number.isFinite(rms) && rms < -38) notes.push('La grabación está muy baja; graba más cerca del micrófono la próxima vez.');
  return { noise: Number.isFinite(noise) ? +noise.toFixed(1) : null, peak: Number.isFinite(peak) ? +peak.toFixed(1) : null,
    rms: Number.isFinite(rms) ? +rms.toFixed(1) : null, clipped, level, notes };
}

/** Límite de atenuación de DeepFilterNet: más fuerte cuanto más ruido, sin llegar a sonar artificial. */
function attenuation(profile, report) {
  const table = profile === 'natural' ? { alto: 28, medio: 18, bajo: 10 } : { alto: 42, medio: 30, bajo: 18 };
  return table[report.level] ?? (profile === 'natural' ? 18 : 30);
}

function pruneCache(folder) {
  try {
    const old = Date.now() - CACHE_DAYS * 86400000;
    for (const name of fs.readdirSync(folder)) {
      const file = path.join(folder, name);
      if (fs.statSync(file).mtimeMs < old) fs.rmSync(file, { force: true });
    }
  } catch { /* la caché es opcional */ }
}

/**
 * Devuelve la toma con la voz limpia (vídeo intacto). Se guarda en caché por toma y perfil.
 * Si la IA no está disponible, devuelve la toma original con fallback=true (se usa el reductor clásico).
 */
async function cleanVoice(root, voice, profile, signal, report = null) {
  if (!editing.AI_PROFILES.has(profile)) return { file: voice, fallback: false };
  const info = await media.probe(voice);
  if (!info.hasAudio) return { file: voice, fallback: false };
  const stat = fs.statSync(voice);
  const folder = path.join(root, 'Temporales', 'Voz-limpia');
  fs.mkdirSync(folder, { recursive: true });
  const key = createHash('sha256').update([voice, stat.size, stat.mtimeMs, profile, VERSION, 2].join('|')).digest('hex').slice(0, 24);
  const target = path.join(folder, key + '.mkv');
  if (fs.existsSync(target)) {
    fs.utimesSync(target, new Date(), new Date());
    return { file: target, fallback: false, cached: true };
  }
  let exe;
  try { exe = await denoiser(root, signal); } catch (error) {
    if (signal?.aborted) throw error;
    exe = null;
  }
  if (!exe) return { file: voice, fallback: true };
  pruneCache(folder);
  const work = media.temporary(root);
  try {
    const analysis = report || await analyze(voice, signal);
    const raw = path.join(work, 'voz.wav');
    // 48 kHz mono es lo que espera el modelo; la saturación se repara antes de limpiar.
    await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-i', voice, '-vn', '-ac', '1', '-ar', '48000',
      ...(analysis.clipped ? ['-af', 'adeclip'] : []), '-c:a', 'pcm_s16le', raw], signal);
    const out = path.join(work, 'limpia');
    fs.mkdirSync(out);
    await media.command(exe, ['-D', '-a', String(attenuation(profile, analysis)), '-o', out, raw], signal);
    const cleaned = path.join(out, 'voz.wav');
    if (!fs.existsSync(cleaned)) throw Error('El limpiador de voz no produjo audio');
    const partial = path.join(work, 'toma.mkv');
    await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-i', voice, '-i', cleaned,
      '-map', '0:v:0?', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '1', partial], signal);
    fs.renameSync(partial, target);
    return { file: target, fallback: false, report: analysis };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { file: voice, fallback: true, error: error.message };
  } finally {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  }
}

const SAMPLE = /^[A-Za-z0-9_-]{1,80}$/;
function samplePath(root, projectId, scene, kind) {
  if (!SAMPLE.test(projectId) || !['hook', 'body', 'closing'].includes(scene) || !['antes', 'despues'].includes(kind)) {
    throw Error('Muestra de audio desconocida');
  }
  return path.join(root, 'Temporales', 'Muestras-audio', projectId + '-' + scene + '-' + kind + '.m4a');
}

/** Diez segundos de la toma: original y con el perfil elegido (con volumen de redes) para comparar. */
async function preview(root, project, scene, profile, signal) {
  const take = editing.effectiveScene(project, scene);
  if (!take?.video) throw Error('Esta escena todavía no tiene grabación');
  if (!Object.hasOwn(editing.PROFILES, profile)) throw Error('Perfil de voz inválido');
  const voice = require('./store.cjs').resolveAsset(root, project.id, take.video);
  const info = await media.probe(voice);
  if (!info.hasAudio) throw Error('La grabación no tiene audio');
  const report = await analyze(voice, signal);
  const cleaned = await cleanVoice(root, voice, profile, signal, report);
  const start = Math.max(0, Math.min(info.duration - 10, info.duration * 0.25));
  const length = Math.min(10, info.duration).toFixed(2);
  fs.mkdirSync(path.join(root, 'Temporales', 'Muestras-audio'), { recursive: true });
  const loud = 'loudnorm=I=-14:TP=-1.5:LRA=11';
  const encode = (file, filter, target) => media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y',
    '-ss', start.toFixed(2), '-t', length, '-i', file, '-vn', '-af', filter, '-ac', '2', '-ar', '48000', '-c:a', 'aac', '-b:a', '160k', target], signal);
  await encode(voice, 'aresample=48000', samplePath(root, project.id, scene, 'antes'));
  await encode(cleaned.file, 'aresample=48000' + editing.voiceFilter(profile, cleaned.fallback) + ',' + loud, samplePath(root, project.id, scene, 'despues'));
  const notes = [...report.notes];
  if (cleaned.fallback && editing.AI_PROFILES.has(profile)) notes.push('La limpieza con IA no está disponible ahora: se usó el reductor clásico.');
  return { report: { ...report, notes }, ai: editing.AI_PROFILES.has(profile) && !cleaned.fallback, version: Date.now() };
}

module.exports = { denoiser, analyze, attenuation, cleanVoice, preview, samplePath, BINARIES, VERSION };
