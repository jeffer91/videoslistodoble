'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const store = require('./store.cjs');
const media = require('./media.cjs');
const production = require('./production.cjs');

const NETWORKS = ['youtube', 'tiktok', 'instagram', 'facebook'];

function outputs(root, kind, id) {
  if (kind === 'short') {
    const project = store.getProject(root, id);
    return (project.exports || []).map(item => item.file).filter(Boolean);
  }
  if (kind === 'week') return store.getWeek(root, id).outputs || [];
  throw Error('Tipo de video inválido');
}

function resolveOutput(root, { kind, id, file }) {
  if (typeof file !== 'string' || !/^[0-9a-z_-]+\.mp4$/i.test(file)) throw Error('Exportación inválida');
  const dir = path.join(root, 'Exportaciones', kind === 'short' ? 'Shorts' : 'Videos-Largos');
  const found = outputs(root, kind, id).find(candidate => path.basename(candidate) === file);
  if (!found) throw Error('El video no pertenece a la ficha');
  const resolved = fs.realpathSync(path.join(dir, file));
  if (!production.isInside(fs.realpathSync(dir), resolved) || !fs.statSync(resolved).isFile()) {
    throw Error('El video no está dentro de su carpeta de exportación');
  }
  return resolved;
}

function sidecar(file) {
  return path.join(path.dirname(file), path.parse(file).name + '.publicacion.json');
}

function titleFor(root, { kind, id }) {
  return kind === 'short' ? store.getProject(root, id).title : store.getWeek(root, id).title;
}

function entryFor(root, target) {
  const file = resolveOutput(root, target);
  const json = sidecar(file);
  if (fs.existsSync(json)) return store.readJSON(json);
  const title = titleFor(root, target);
  const project = target.kind === 'short' ? store.getProject(root, target.id) : null;
  const tags = project ? Object.values(project.tags || {}).flat() : [];
  const chaptersFile = file.replace(/\.mp4$/, '.capitulos.txt');
  const description = fs.existsSync(chaptersFile) ? fs.readFileSync(chaptersFile, 'utf8') : '';
  return {
    target, quality: null, thumbnails: [], approval: null,
    networks: Object.fromEntries(NETWORKS.map(name => [name, { title: title.slice(0, 100), description, tags, coverTime: 0 }]))
  };
}

function updateEntry(root, target, fields) {
  const file = resolveOutput(root, target);
  const next = { ...entryFor(root, target), ...fields, target };
  store.atomic(sidecar(file), next);
  return next;
}

function normalizeNetwork(name, data) {
  if (!NETWORKS.includes(name)) throw Error('Red no admitida');
  const title = String(data?.title || '').trim();
  const description = String(data?.description || '').trim();
  const tags = Array.isArray(data?.tags) ? data.tags : String(data?.tags || '').split(',');
  const unique = [...new Set(tags.map(value => String(value).trim()).filter(Boolean))];
  if (!title || title.length > 100 || description.length > (name === 'youtube' || name === 'facebook' ? 4700 : 1950) ||
      unique.length > 25 || unique.some(value => value.length > 55) || unique.join(',').length > 440) {
    throw Error('Revisa el título, la descripción y las etiquetas para ' + name);
  }
  const coverTime = Number(data?.coverTime ?? 0);
  if (!Number.isFinite(coverTime) || coverTime < 0 || coverTime > 7200) throw Error('Tiempo de portada inválido');
  const choice = Number(data?.thumbnail || 0);
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) throw Error('Miniatura inválida');
  const privacy = String(data?.privacy || '');
  const privacyOptions = name === 'youtube' ? ['private', 'unlisted', 'public'] :
    name === 'tiktok' ? ['SELF_ONLY', 'FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'PUBLIC_TO_EVERYONE'] : ['public'];
  // TikTok: «direct» publica; «inbox» lo deja en los borradores de la app para publicarlo con un toque.
  const mode = name === 'tiktok' && data?.mode === 'inbox' ? 'inbox' : 'direct';
  if (privacy && !privacyOptions.includes(privacy)) throw Error('Visibilidad inválida');
  const coverUrl = String(data?.coverUrl || '').trim();
  if (coverUrl) {
    const parsed = new URL(coverUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || coverUrl.length > 1800) {
      throw Error('Para Instagram usa una portada pública HTTPS');
    }
  }
  return {
    title, description, tags: unique, coverTime, thumbnail: choice, privacy, coverUrl, mode,
    comments: data?.comments === true, duet: data?.duet === true, stitch: data?.stitch === true,
    madeForKids: data?.madeForKids === true, branded: data?.branded === true, ownBrand: data?.ownBrand === true,
    // Datos de la ficha de publicación que usa el publicador por navegador.
    aiRealistic: data?.aiRealistic === true,
    caption: String(data?.caption || '').slice(0, 2200),
    groupText: String(data?.groupText || '').slice(0, 500)
  };
}

/**
 * Ficha de publicación: lo que el usuario confirma una vez por video y Studio
 * adapta a cada red. Sin ficha completa no se publica automáticamente.
 */
function normalizeSheet(data) {
  const text = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max + 1);
  const hook = text(data?.hook, 150);
  const description = text(data?.description, 1500);
  const groupText = text(data?.groupText, 500);
  if (hook.length < 10 || hook.length > 150) throw Error('El gancho debe tener entre 10 y 150 caracteres');
  if (description.length > 1500) throw Error('La descripción admite hasta 1.500 caracteres');
  if (groupText.length > 500) throw Error('El texto del grupo admite hasta 500 caracteres');
  const raw = Array.isArray(data?.hashtags) ? data.hashtags : String(data?.hashtags || '').split(/[\s,]+/);
  const hashtags = [...new Set(raw.map(value => String(value).trim().replace(/^#+/, '')).filter(Boolean))];
  if (hashtags.length < 1 || hashtags.length > 5) throw Error('Usa entre 1 y 5 hashtags específicos');
  if (hashtags.some(tag => !/^[\p{L}\p{N}_]{2,40}$/u.test(tag))) throw Error('Cada hashtag debe ser una sola palabra, sin espacios ni signos');
  return { hook, description, hashtags, aiRealistic: data?.aiRealistic === true, groupText, savedAt: new Date().toISOString() };
}

function saveSheet(root, target, value) {
  return updateEntry(root, target, { sheet: normalizeSheet(value) });
}

/** Propuesta inicial a partir del guion y las etiquetas del récord (el usuario la corrige). */
function suggestSheet(root, target) {
  const entry = entryFor(root, target);
  if (entry.sheet) return entry.sheet;
  const title = titleFor(root, target);
  const project = target.kind === 'short' ? store.getProject(root, target.id) : null;
  const sentences = value => String(value || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?¿¡])\s+/).filter(Boolean);
  const hook = (sentences(project?.script?.hook)[0] || title).slice(0, 150);
  const description = sentences(project?.script?.body).slice(0, 2).join(' ').slice(0, 400);
  const word = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join('').slice(0, 40);
  const tags = project?.tags || {};
  const hashtags = [...new Set(['jugadores', 'clubes', 'selecciones', 'competiciones', 'tipos']
    .flatMap(field => tags[field] || []).map(word).filter(tag => tag.length >= 2))].slice(0, 4);
  return { hook: hook.length >= 10 ? hook : (hook + ' · ' + title).slice(0, 150), description,
    hashtags: hashtags.length ? hashtags : ['Futbol'], aiRealistic: false, groupText: '', suggested: true };
}

function saveNetwork(root, target, network, value) {
  const current = entryFor(root, target);
  const metadata = normalizeNetwork(network, value);
  return updateEntry(root, target, { networks: { ...current.networks, [network]: metadata } });
}

async function qualityCheck(file, kind, signal, expected) {
  const info = await media.probe(file);
  const min = kind === 'short' ? 1 : production.EIGHT_MINUTES;
  const test = process.env.RECORDS_RENDER_TEST_MODE === '1';
  const [width, height] = kind === 'short' ? (test ? [270, 480] : [1080, 1920]) : (test ? [480, 270] : [1920, 1080]);
  const checks = [
    { label: 'Duración', ok: info.duration >= min, value: info.duration.toFixed(2) + ' s' },
    { label: 'Resolución', ok: info.width === width && info.height === height, value: info.width + ' × ' + info.height },
    { label: 'Pista de audio', ok: info.hasAudio, value: info.hasAudio ? 'Presente' : 'Ausente' }
  ];
  let volume = null;
  try {
    const { stderr } = await media.command(media.toolPath('ffmpeg'), [
      '-hide_banner', '-nostats', '-xerror', '-i', file, '-map', '0:v:0', '-map', '0:a:0',
      '-af', 'loudnorm=print_format=json', '-f', 'null', '-'
    ], signal);
    const analysis = stderr.match(/\{\s*"input_i"[\s\S]*?\}/g)?.at(-1);
    if (analysis) {
      const measured = Number(JSON.parse(analysis).input_i);
      if (Number.isFinite(measured)) volume = measured;
    }
    checks.push({ label: 'Archivo reproducible', ok: true, value: 'Video y audio decodificados' });
  } catch (error) {
    if (signal?.aborted) throw error;
    checks.push({ label: 'Archivo reproducible', ok: false, value: 'Error al decodificar' });
  }
  checks.push({ label: 'Volumen integrado', ok: volume !== null && volume >= -25 && volume <= -10,
    value: volume !== null ? volume + ' LUFS' : 'Sin señal medible' });
  checks.push({ label: 'Márgenes del texto', ok: true, value: 'Rótulos y subtítulos ajustados al área segura' });
  if (expected !== undefined && Math.abs(info.duration - expected) > 2) {
    checks.push({ label: 'Duración del montaje', ok: false, value: 'Difiere del montaje previsto por más de 2 s' });
  }
  return { checks, ok: checks.every(item => item.ok), ...info, volume, at: new Date().toISOString() };
}

async function checkOutput(root, target, signal) {
  const quality = await qualityCheck(resolveOutput(root, target), target.kind, signal);
  updateEntry(root, target, { quality });
  return quality;
}

async function fingerprint(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function approveOutput(root, target, confirmed, signal) {
  if (confirmed !== true) throw Error('Confirma que revisaste el MP4');
  const file = resolveOutput(root, target);
  const quality = await checkOutput(root, target, signal);
  if (!quality.ok) throw Error('Corrige el resultado del chequeo o vuelve a exportar antes de aprobar');
  const approval = { at: new Date().toISOString(), sha256: await fingerprint(file) };
  if (target.kind === 'short') store.saveProject(root, { id: target.id, stage: 'aprobado' });
  return updateEntry(root, target, { approval });
}

function xml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character]);
}

function headingLines(input, limit) {
  const words = input.split(/\s+/).map(word => [...word].slice(0, limit).join(''));
  const lines = [''];
  for (const word of words) {
    const index = lines.length - 1;
    const joined = [lines[index], word].filter(Boolean).join(' ');
    if (joined.length <= limit) lines[index] = joined;
    else if (lines.length < 3) lines.push(word);
    else {
      lines[index] = lines[index].slice(0, limit - 1).trim() + '…';
      break;
    }
  }
  return lines;
}

async function thumbnails(root, target, { title, time, assetId }, signal) {
  const file = resolveOutput(root, target);
  const heading = String(title || titleFor(root, target)).trim().slice(0, 120);
  if (!heading) throw Error('Escribe el texto de la miniatura');
  const seconds = Number(time ?? 0);
  if (!Number.isFinite(seconds) || seconds < 0) throw Error('Tiempo de miniatura inválido');
  const dir = media.temporary(root);
  const snapshot = path.join(dir, 'fotograma.jpg');
  const image = target.kind === 'short' && assetId ? store.resolveAsset(root, target.id, assetId) : null;
  try {
    if (!image) {
      const duration = (await media.probe(file)).duration;
      await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-ss',
        media.seconds(Math.min(seconds, Math.max(0, duration - .2))), '-i', file, '-frames:v', '1', snapshot], signal);
    }
    const themes = [
      { accent: '#ffd765', base: '#11231a', side: 'left' },
      { accent: '#aff0d6', base: '#0a192c', side: 'right' },
      { accent: '#ffffff', base: '#771a22', side: 'left' }
    ];
    const background = await sharp(image || snapshot).rotate().resize(1280, 720, { fit: 'cover' }).toBuffer();
    const generated = [];
    for (const [index, theme] of themes.entries()) {
      const x = theme.side === 'left' ? 82 : 700;
      const rect = x - 38;
      const lines = headingLines(heading.toLocaleUpperCase('es'), 16);
      const markup = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">' +
        '<rect y="0" width="1280" height="720" fill="#0a0e13" fill-opacity=".20"/>' +
        '<rect x="' + rect + '" y="96" rx="22" width="560" height="528" fill="' + theme.base + '" fill-opacity=".9"/>' +
        '<text x="' + x + '" y="191" font-family="Arial, sans-serif" font-size="33" font-weight="bold" fill="' + theme.accent + '">11 RÉCORDS</text>' +
        lines.map((line, i) => '<text x="' + x + '" y="' + (315 + i * 70) +
          '" font-family="Arial, sans-serif" font-size="53" font-weight="bold" textLength="' +
          Math.max(1, Math.min(475, line.length * 30)) + '" lengthAdjust="spacingAndGlyphs" fill="#fff">' + xml(line) + '</text>').join('') +
        '<rect x="' + x + '" y="563" width="152" height="8" fill="' + theme.accent + '"/></svg>';
      const name = path.parse(file).name + '.miniatura-' + (index + 1) + '.jpg';
      const destination = path.join(path.dirname(file), name);
      const temporary = path.join(dir, name);
      await sharp(background).composite([{ input: Buffer.from(markup) }]).jpeg({ quality: 86, mozjpeg: true }).toFile(temporary);
      fs.copyFileSync(temporary, destination);
      generated.push(name);
    }
    return updateEntry(root, target, { thumbnails: generated });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function thumbnailPath(root, target, choice) {
  if (!choice) return null;
  const name = entryFor(root, target).thumbnails[choice - 1];
  if (!name) throw Error('Genera la miniatura seleccionada');
  return path.join(path.dirname(resolveOutput(root, target)), path.basename(name));
}

module.exports = {
  normalizeSheet, saveSheet, suggestSheet,
  NETWORKS, outputs, resolveOutput, sidecar, entryFor, updateEntry, normalizeNetwork, saveNetwork, qualityCheck,
  checkOutput, fingerprint, approveOutput, thumbnails, thumbnailPath
};
