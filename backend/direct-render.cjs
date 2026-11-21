'use strict';
/**
 * Videos largos directos · exportación final 1920 × 1080 MP4 (H.264 + AAC).
 *
 * 1. Cartela de transición por sección (fondo animado, título, destello).
 * 2. Cada sección se compone por tramos según su línea de tiempo (A–E) desde
 *    la copia MP4 de la toma; las grabaciones originales nunca se modifican.
 * 3. Una sola pista de audio: voz continua, música por sección con fundidos
 *    cruzados y ducking (la música baja cuando habla el presentador) y efectos.
 * 4. Capítulos de YouTube y SRT calculados con la duración real de cada pieza.
 */
const fs = require('node:fs');
const path = require('node:path');
const Layout = require('../renderer/direct-layout.js');
const graphics = require('./direct-graphics.cjs');
const audio = require('./direct-audio.cjs');
const captions = require('./direct-captions.cjs');
const intel = require('./direct-intel.cjs');
const directStore = require('./direct-store.cjs');

const FPS = Layout.FPS;
const QUALITY = {
  final: { preset: 'veryfast', crf: '20', scale: null, label: 'Final 1920 × 1080' },
  draft: { preset: 'ultrafast', crf: '30', scale: '960:540', label: 'Borrador rápido 960 × 540' }
};

function videoArgs(quality, frames) {
  const q = QUALITY[quality] || QUALITY.final;
  return ['-frames:v', String(frames), '-an', '-r', String(FPS), '-c:v', 'libx264', '-preset', q.preset, '-crf', q.crf, '-profile:v', 'high',
    '-pix_fmt', 'yuv420p', '-g', '60', '-video_track_timescale', '15360'];
}

function finish(label, quality) {
  const q = QUALITY[quality] || QUALITY.final;
  return (q.scale ? ';[' + label + ']scale=' + q.scale + ':flags=bicubic,setsar=1,format=yuv420p[out]' : ';[' + label + ']setsar=1,format=yuv420p[out]');
}

function sectionLabel(section) {
  return section.intro ? 'Introducción' : 'Sección ' + String(section.number).padStart(2, '0');
}

/** Piezas del video en orden: transición + sección para cada sección grabada. */
function plan(project) {
  const styles = intel.resolvedStyles(project);
  const pieces = [];
  const missing = [];
  project.sections.forEach((section, index) => {
    if (!section.take) { missing.push(section.title); return; }
    const transition = project.settings.transitions.enabled && section.transition.enabled;
    if (transition) pieces.push({ kind: 'transition', section, style: styles[index], duration: section.transition.duration || project.settings.transitions.duration });
    pieces.push({ kind: 'section', section, duration: section.take.duration });
  });
  return { pieces, missing };
}

async function renderTransition(ctx, piece, output) {
  const { root, media, signal, quality } = ctx;
  const frames = Math.round(piece.duration * FPS);
  const d = frames / FPS;
  const section = piece.section;
  const bg = await graphics.background(root, piece.style);
  const intro = section.intro;
  const title = await graphics.titleCard(root, { label: intro ? 'Once Records presenta' : sectionLabel(section),
    title: section.transition.title || (intro ? ctx.project.title : section.title) });
  const sweep = await graphics.sweep(root);
  const still = 'loop=loop=-1:size=1:start=0,setpts=N/' + FPS + '/TB,';
  const ease = 'if(lt(t,0.35),220,if(lt(t,0.95),220*pow(1-(t-0.35)/0.6,3),0))';
  const graph = '[0:v]scale=2016:1134,zoompan=z=\'1+0.06*on/' + frames + '\':x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':d=' + (frames + 5) + ':s=1920x1080:fps=' + FPS + '[bg];' +
    '[1:v]' + still + 'format=rgba,fade=t=in:st=0.35:d=0.5:alpha=1,fade=t=out:st=' + Math.max(0.9, d - 0.85).toFixed(3) + ':d=0.5:alpha=1[title];' +
    '[2:v]' + still + 'format=rgba[sw];' +
    '[bg][title]overlay=x=\'' + ease + '\':y=0:eval=frame[t1];' +
    '[t1][sw]overlay=x=\'-700+(W+1400)*t/' + d.toFixed(3) + '\':y=0:eval=frame[t2];' +
    '[t2]fade=t=in:st=0:d=0.3,fade=t=out:st=' + (d - 0.35).toFixed(3) + ':d=0.35[v]' + finish('v', quality);
  await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y',
    '-i', bg, '-i', title, '-i', sweep,
    '-filter_complex', graph, '-map', '[out]', ...videoArgs(quality, frames), output], signal);
  return frames;
}

function imageFile(root, project, imageId) {
  const image = project.images.find(i => i.id === imageId);
  return image ? directStore.resolveFile(root, project.id, image.file) : null;
}

async function backgroundFor(root, project, segment) {
  const style = segment.background || project.settings.background.style;
  const own = !segment.background && project.settings.background.imageId && imageFile(root, project, project.settings.background.imageId);
  return own && fs.existsSync(own) ? graphics.imageBackground(root, own) : graphics.background(root, style);
}

async function renderSegment(ctx, section, segment, index, output) {
  const { root, project, media, signal, quality, temp } = ctx;
  const image = segment.imageId ? imageFile(root, project, segment.imageId) : null;
  const hasImage = Boolean(image && fs.existsSync(image));
  const box = Layout.boxes(segment, hasImage);
  const master = directStore.resolveFile(root, project.id, section.take.master);
  const start = segment.startFrame / FPS, length = segment.frames / FPS;
  const inputs = [], graph = [];
  const add = (args) => { inputs.push(...args); return inputs.filter(x => x === '-i').length - 1; };
  // Las imágenes fijas se decodifican una sola vez y se repiten con el filtro loop.
  const still = (file, before = '') => '[' + add(['-i', file]) + ':v]' + (before ? before + ',' : '') + 'loop=loop=-1:size=1:start=0,setpts=N/' + FPS + '/TB';
  const bg = await backgroundFor(root, project, segment);
  // Paneo lento y continuo del fondo (la fase depende del tiempo de la sección).
  graph.push(still(bg, 'scale=2016:1134') + ',crop=1920:1080:x=\'48+44*sin((t+' + start.toFixed(3) + ')*0.21)\':y=\'27+24*cos((t+' + start.toFixed(3) + ')*0.17)\'[base]');
  let last = 'base';
  if (box.image && hasImage) {
    const w = box.image.w, h = box.image.h;
    const zoom = segment.zoom === false ? 1 : 1.08;
    const bw = Math.ceil(w * zoom / 2) * 2, bh = Math.ceil(h * zoom / 2) * 2;
    graph.push(still(image, 'scale=' + bw + ':' + bh + ':force_original_aspect_ratio=increase,crop=' + bw + ':' + bh + ',setsar=1') + ',' +
      'crop=' + w + ':' + h + ':x=\'(iw-ow)*' + (index % 2 ? '(1-t/' + length.toFixed(3) + ')' : 't/' + length.toFixed(3)) + '\':y=\'(ih-oh)/2\'' +
      (box.image.radius ? ',format=yuva420p[imgc];' + still(await graphics.mask(root, w, h, box.image.radius), 'format=gray,scale=' + w + ':' + h) + '[imgm];[imgc][imgm]alphamerge[img]' : '[img]'));
    graph.push('[' + last + '][img]overlay=' + box.image.x + ':' + box.image.y + ':shortest=0[withimg]');
    last = 'withimg';
  }
  if (box.presenter) {
    const p = box.presenter;
    const take = add(['-ss', start.toFixed(3), '-t', (length + 0.5).toFixed(3), '-i', master]);
    const maskFile = await graphics.mask(root, p.size, p.size, box.radius);
    graph.push('[' + take + ':v]fps=' + FPS + ',scale=' + p.size + ':' + p.size + ',setsar=1,format=yuva420p[pv]',
      still(maskFile, 'format=gray,scale=' + p.size + ':' + p.size) + '[pm]', '[pv][pm]alphamerge[pres]',
      '[' + last + '][pres]overlay=' + p.x + ':' + p.y + ':eof_action=repeat[withp]');
    last = 'withp';
  }
  const caption = segment.caption || '';
  const fg = await graphics.foreground(root, segment, hasImage, { sectionLabel: sectionLabel(section), sectionTitle: section.title, caption });
  graph.push(still(fg) + '[fgl]', '[' + last + '][fgl]overlay=0:0[comp]');
  last = 'comp';
  const subs = ctx.subtitles(section);
  if (subs) {
    const name = 'sub-' + ctx.counter++ + '.ass';
    fs.writeFileSync(path.join(temp, name), captions.ass(subs, project.settings.subtitles, 1920, 1080, { from: start, to: start + length }), 'utf8');
    graph.push('[' + last + ']ass=' + name + '[subbed]');
    last = 'subbed';
  }
  await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', ...inputs,
    '-filter_complex', graph.join(';') + finish(last, quality), '-map', '[out]', ...videoArgs(quality, segment.frames), output], signal, null, temp);
}

/** Construye la pista de audio completa. */
async function renderAudio(ctx, timeline, total, output) {
  const { root, project, media, signal, temp } = ctx;
  const inputs = [], graph = [];
  const add = args => { inputs.push(...args); return inputs.filter(x => x === '-i').length - 1; };
  const voices = [];
  const gain = project.settings.voice.gain || 1;
  for (const item of timeline) {
    if (item.kind === 'transition') {
      voices.push('[sil' + voices.length + ']');
      graph.push('anullsrc=r=48000:cl=stereo,atrim=0:' + item.duration.toFixed(4) + ',asetpts=N/SR/TB[sil' + (voices.length - 1) + ']');
    } else {
      const index = add(['-i', directStore.resolveFile(root, project.id, item.section.take.master)]);
      const label = 'voz' + voices.length;
      graph.push('[' + index + ':a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:' + item.duration.toFixed(4) + ',apad=whole_dur=' + item.duration.toFixed(4) + ',asetpts=N/SR/TB,volume=' + gain + '[' + label + ']');
      voices.push('[' + label + ']');
    }
  }
  const ducking = project.settings.music.enabled && project.settings.music.ducking;
  graph.push(voices.join('') + 'concat=n=' + voices.length + ':v=0:a=1' + (ducking ? ',asplit=2[voice][side]' : '[voice]'));
  // Música: una pista por sección, desde su transición hasta el final, con fundido cruzado.
  const music = [];
  if (project.settings.music.enabled) {
    const sources = new Map();
    for (const group of ctx.sectionsOnTimeline) {
      const sec = group.section;
      if (sec.audio.mood === 'ninguna') continue;
      let file;
      if (sec.audio.musicId) {
        const item = project.audio.find(a => a.id === sec.audio.musicId);
        if (item) file = directStore.resolveFile(root, project.id, item.file);
      }
      if (!file) {
        const mood = sec.audio.mood === 'auto' ? (intel.mood(sec) === 'ambiental' ? project.settings.music.defaultMood || 'ambiental' : intel.mood(sec)) : sec.audio.mood;
        file = await audio.ensure(root, 'music', mood, media);
      }
      if (!sources.has(file)) {
        const length = Math.max(1, (await media.probe(file)).duration || 30);
        sources.set(file, { index: add(['-stream_loop', String(Math.min(500, Math.ceil(total / length) + 2)), '-i', file]), uses: [] });
      }
      sources.get(file).uses.push(group);
    }
    for (const source of sources.values()) {
      const labels = source.uses.map((_g, i) => 'm' + source.index + '_' + i);
      graph.push('[' + source.index + ':a]aresample=48000,aformat=channel_layouts=stereo' + (labels.length > 1 ? ',asplit=' + labels.length : '') + labels.map(l => '[' + l + 'src]').join(''));
      source.uses.forEach((group, i) => {
        const volume = group.section.audio.volume ?? project.settings.music.volume;
        const begin = group.start, end = Math.min(total, group.end + 1.2);
        const len = end - begin;
        const offset = Math.round(begin * 1000);
        const label = labels[i];
        graph.push('[' + label + 'src]atrim=start=' + ((begin * 0.37) % 7).toFixed(3) + ':duration=' + len.toFixed(4) + ',asetpts=N/SR/TB,' +
          'afade=t=in:d=' + Math.min(1.5, len / 3).toFixed(3) + ',afade=t=out:st=' + Math.max(0, len - 1.6).toFixed(3) + ':d=' + Math.min(1.6, len / 3).toFixed(3) +
          ',volume=' + Number(volume).toFixed(3) + ',adelay=' + offset + '|' + offset + '[' + label + ']');
        music.push('[' + label + ']');
      });
    }
  }
  // Efectos de las transiciones.
  const effects = [];
  for (const item of timeline) {
    if (item.kind !== 'transition' || item.section.transition.sound === 'ninguno') continue;
    const file = await audio.ensure(root, 'sfx', item.section.transition.sound, media);
    const index = add(['-i', file]);
    const offset = Math.round(item.start * 1000);
    graph.push('[' + index + ':a]aresample=48000,aformat=channel_layouts=stereo,volume=' + Number(item.section.transition.volume).toFixed(3) + ',adelay=' + offset + '|' + offset + '[fx' + effects.length + ']');
    effects.push('[fx' + effects.length + ']');
  }
  const mixInputs = ['[voice]'];
  if (music.length) {
    graph.push(music.join('') + (music.length > 1 ? 'amix=inputs=' + music.length + ':normalize=0:duration=longest' : 'anull') + ',apad=whole_dur=' + total.toFixed(4) + '[musicbed]');
    if (ducking) {
      graph.push('[musicbed][side]sidechaincompress=threshold=0.025:ratio=9:attack=25:release=420:makeup=1[ducked]');
      mixInputs.push('[ducked]');
    } else mixInputs.push('[musicbed]');
  } else if (ducking) graph.push('[side]anullsink');
  if (effects.length) {
    graph.push(effects.join('') + (effects.length > 1 ? 'amix=inputs=' + effects.length + ':normalize=0:duration=longest' : 'anull') + ',apad=whole_dur=' + total.toFixed(4) + '[fxbed]');
    mixInputs.push('[fxbed]');
  }
  graph.push(mixInputs.join('') + (mixInputs.length > 1 ? 'amix=inputs=' + mixInputs.length + ':normalize=0:duration=first' : 'anull') +
    ',atrim=0:' + total.toFixed(4) + ',loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[mix]');
  const script = path.join(temp, 'audio.txt');
  fs.writeFileSync(script, graph.join(';\n'), 'utf8');
  await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex_script', script,
    '-map', '[mix]', '-t', total.toFixed(4), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', output], signal);
}

function chapterList(timeline, project) {
  const chapters = [];
  for (const item of timeline) {
    if (chapters.some(c => c.sectionId === item.section.id)) continue;
    chapters.push({ sectionId: item.section.id, start: item.start, title: item.section.transition.title || item.section.title });
  }
  if (chapters.length) chapters[0].start = 0;
  const end = timeline.at(-1) ? timeline.at(-1).start + timeline.at(-1).duration : 0;
  const problems = [];
  if (chapters.length < 3) problems.push('YouTube necesita al menos 3 capítulos');
  chapters.forEach((c, i) => { if ((chapters[i + 1]?.start ?? end) - c.start < 10) problems.push('«' + c.title + '» dura menos de 10 s'); });
  const text = chapters.map(c => Layout.stamp(c.start) + ' ' + c.title).join('\n');
  return { chapters, text, valid: problems.length === 0, problems, project: project.id };
}

function safeName(title) {
  return String(title || 'video').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'video';
}

/** Exporta el proyecto completo. `send` recibe el progreso. */
async function exportProject(root, id, { quality = 'final', signal = new AbortController().signal, send = () => {} } = {}, media = require('./media.cjs')) {
  let project = directStore.read(root, id);
  const { pieces, missing } = plan(project);
  if (!pieces.length) throw Error('Graba al menos una sección para exportar');
  directStore.ensureSpace(root, 1.5 * 1024 * 1024 * 1024);
  const recorded = pieces.filter(p => p.kind === 'section');
  for (const [i, piece] of recorded.entries()) {
    send({ stage: 'prepare', percent: Math.round(5 * i / recorded.length), message: 'Preparando la toma de «' + piece.section.title + '»' });
    await directStore.prepareMaster(root, { id, sectionId: piece.section.id }, signal, media);
  }
  project = directStore.read(root, id);
  const fresh = plan(project).pieces;
  const temp = media.temporary(root);
  const ctx = { root, project, media, signal, quality, temp, counter: 0,
    subtitles: section => project.settings.subtitles.enabled && project.settings.subtitles.burn && section.transcript?.takeId === section.take.id ? section.transcript.words : null };
  try {
    const files = [];
    const timeline = [];
    let frames = 0;
    const work = fresh.reduce((n, p) => n + (p.kind === 'section' ? Layout.frames(Layout.fill(p.section.layouts, p.section.take.duration), p.section.take.duration).length : 1), 0);
    let done = 0;
    const step = message => send({ stage: 'video', percent: Math.round(5 + 75 * done / work), message });
    for (const piece of fresh) {
      if (piece.kind === 'transition') {
        step('Transición · ' + piece.section.title);
        const file = path.join(temp, 'p' + files.length + '.mp4');
        const count = await renderTransition(ctx, piece, file);
        files.push(file);
        timeline.push({ kind: 'transition', section: piece.section, start: frames / FPS, duration: count / FPS });
        frames += count;
        done++;
        continue;
      }
      const section = piece.section;
      const segments = Layout.frames(Layout.fill(section.layouts, section.take.duration), section.take.duration);
      const sectionStart = frames;
      for (const [index, segment] of segments.entries()) {
        step('Sección «' + section.title + '» · tramo ' + (index + 1) + ' de ' + segments.length);
        const file = path.join(temp, 'p' + files.length + '.mp4');
        await renderSegment(ctx, section, segment, index, file);
        files.push(file);
        frames += segment.frames;
        done++;
      }
      timeline.push({ kind: 'section', section, start: sectionStart / FPS, duration: (frames - sectionStart) / FPS });
    }
    const total = frames / FPS;
    ctx.sectionsOnTimeline = [];
    for (const item of timeline) {
      const current = ctx.sectionsOnTimeline.find(g => g.section.id === item.section.id);
      if (current) current.end = item.start + item.duration;
      else ctx.sectionsOnTimeline.push({ section: item.section, start: item.start, end: item.start + item.duration });
    }
    send({ stage: 'join', percent: 82, message: 'Uniendo las piezas del video' });
    const list = path.join(temp, 'lista.txt');
    fs.writeFileSync(list, files.map(f => "file '" + f.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');
    const silent = path.join(temp, 'video.mp4');
    await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent], signal);
    send({ stage: 'audio', percent: 88, message: 'Mezclando voz, música y efectos' });
    const mix = path.join(temp, 'audio.m4a');
    await renderAudio(ctx, timeline, total, mix);
    send({ stage: 'mux', percent: 95, message: 'Escribiendo el MP4 final' });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const name = safeName(project.title) + (quality === 'draft' ? '-borrador-' : '-') + stamp + '.mp4';
    const relative = 'Exportaciones/' + name;
    const destination = directStore.resolveFile(root, id, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const partial = destination.replace(/\.mp4$/, '.parcial.mp4');
    await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-i', silent, '-i', mix, '-map', '0:v:0', '-map', '1:a:0',
      '-c', 'copy', '-t', total.toFixed(4), '-movflags', '+faststart', partial], signal);
    const info = await media.probe(partial);
    const expected = QUALITY[quality]?.scale ? [960, 540] : [1920, 1080];
    if (info.width !== expected[0] || info.height !== expected[1] || !info.hasAudio || Math.abs(info.duration - total) > 0.6) {
      throw Error('La verificación del MP4 falló (' + info.width + '×' + info.height + ', ' + info.duration.toFixed(1) + ' s)');
    }
    fs.renameSync(partial, destination);
    const chapters = chapterList(timeline, project);
    fs.writeFileSync(destination.replace(/\.mp4$/, '.capitulos.txt'), chapters.text + '\n', 'utf8');
    const blocks = timeline.filter(t => t.kind === 'section' && t.section.transcript?.takeId === t.section.take.id)
      .map(t => ({ offset: t.start, words: t.section.transcript.words }));
    let srtRel = null;
    if (blocks.length) {
      srtRel = relative.replace(/\.mp4$/, '.srt');
      fs.writeFileSync(directStore.resolveFile(root, id, srtRel), '﻿' + captions.srt(blocks), 'utf8');
    }
    const entry = { file: relative, srt: srtRel, at: new Date().toISOString(), quality, duration: info.duration, width: info.width, height: info.height,
      size: fs.statSync(destination).size, chapters: chapters.chapters.map(({ sectionId, ...c }) => c), chaptersText: chapters.text, chaptersValid: chapters.valid,
      chapterProblems: chapters.problems, missing, burnedSubtitles: Boolean(project.settings.subtitles.enabled && project.settings.subtitles.burn) };
    const latest = directStore.read(root, id);
    latest.exports = [...(latest.exports || []), entry].slice(-20);
    directStore.write(root, latest);
    send({ stage: 'done', percent: 100, message: 'Exportación terminada' });
    return entry;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { exportProject, plan, chapterList, renderTransition, renderSegment, renderAudio, QUALITY, safeName };
