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
const narrator = require('./direct-narrator.cjs');
const captions = require('./direct-captions.cjs');
const intel = require('./direct-intel.cjs');
const directStore = require('./direct-store.cjs');
const auto = require('./direct-auto.cjs');

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
    if (transition) {
      // Con narrador, la cartela dura lo necesario para que la voz quepa entera.
      const base = section.transition.duration || project.settings.transitions.duration;
      const narration = narrator.current(null, project, section);
      pieces.push({ kind: 'transition', section, style: styles[index], duration: narrator.transitionLength(base, narration), narration });
    }
    pieces.push({ kind: 'section', section, duration: Layout.keptDuration(section.cuts, section.take.duration) });
  });
  const cta = project.settings.cta || {};
  if (pieces.length && cta.enabled !== false && cta.endscreen !== false) {
    pieces.push({ kind: 'endscreen', section: pieces.at(-1).section, duration: cta.endscreenDuration || 20 });
  }
  return { pieces, missing };
}

/**
 * Foto de fondo de la cartela: la elegida, o en automático la primera foto de la
 * sección (sin contar los gráficos de datos). null = fondo gráfico.
 */
function transitionImage(root, project, section) {
  const choice = section.transition?.image || 'auto';
  if (choice === 'none') return null;
  const usable = image => {
    if (!image) return false;
    const file = directStore.resolveFile(root, project.id, image.file);
    return fs.existsSync(file);
  };
  if (choice !== 'auto') { const chosen = project.images.find(i => i.id === choice); return usable(chosen) ? chosen : null; }
  for (const imageId of section.imageIds || []) {
    const image = project.images.find(i => i.id === imageId);
    if (image && !image.source?.stat && usable(image)) return image;
  }
  return null;
}

/** Fondo de la cartela: foto (si hay) o el fondo gráfico del estilo. */
async function transitionBackground(root, project, section, style) {
  const image = transitionImage(root, project, section);
  const file = image ? await graphics.photoBackground(root, directStore.resolveFile(root, project.id, image.file)) : await graphics.background(root, style);
  return { file, image };
}

async function renderTransition(ctx, piece, output) {
  const { root, media, signal, quality } = ctx;
  const frames = Math.round(piece.duration * FPS);
  const d = frames / FPS;
  const section = piece.section;
  const { file: bg } = await transitionBackground(root, ctx.project, section, piece.style);
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

async function renderEndscreen(ctx, piece, output) {
  const { root, media, signal, quality, project } = ctx;
  const frames = Math.round(piece.duration * FPS);
  const bg = await graphics.background(root, 'estadio');
  const card = await graphics.endscreen(root, { title: project.title });
  const graph = '[0:v]scale=2016:1134,zoompan=z=\'1+0.04*on/' + frames + '\':x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':d=' + (frames + 5) + ':s=1920x1080:fps=' + FPS + '[bg];' +
    '[1:v]loop=loop=-1:size=1:start=0,setpts=N/' + FPS + '/TB,format=rgba,fade=t=in:st=0.2:d=0.6:alpha=1[card];[bg][card]overlay=0:0,fade=t=in:st=0:d=0.4,fade=t=out:st=' + (frames / FPS - 0.6).toFixed(3) + ':d=0.6[v]' + finish('v', quality);
  await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-i', bg, '-i', card, '-filter_complex', graph, '-map', '[out]', ...videoArgs(quality, frames), output], signal);
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

async function renderSegment(ctx, section, segment, index, output, outStart = null, ctas = []) {
  const { root, project, media, signal, quality, temp } = ctx;
  const image = segment.imageId ? imageFile(root, project, segment.imageId) : null;
  const hasImage = Boolean(image && fs.existsSync(image));
  const box = Layout.boxes(segment, hasImage);
  const master = directStore.resolveFile(root, project.id, section.take.master);
  const start = segment.srcStart ?? segment.startFrame / FPS, length = segment.frames / FPS;
  const phase = outStart ?? start;
  const inputs = [], graph = [];
  const add = (args) => { inputs.push(...args); return inputs.filter(x => x === '-i').length - 1; };
  // Las imágenes fijas se decodifican una sola vez y se repiten con el filtro loop.
  const still = (file, before = '') => '[' + add(['-i', file]) + ':v]' + (before ? before + ',' : '') + 'loop=loop=-1:size=1:start=0,setpts=N/' + FPS + '/TB';
  const bg = await backgroundFor(root, project, segment);
  // Paneo lento y continuo del fondo (la fase depende del tiempo de la sección).
  graph.push(still(bg, 'scale=2016:1134') + ',crop=1920:1080:x=\'48+44*sin((t+' + phase.toFixed(3) + ')*0.21)\':y=\'27+24*cos((t+' + phase.toFixed(3) + ')*0.17)\'[base]');
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
  // Llamados a la acción: entran deslizándose, se «pulsan» a los 2,2 s y salen.
  for (const [n, cta] of ctas.entries()) {
    const a = cta.localStart, b = cta.localEnd;
    const pos = Layout.ctaBox(segment, hasImage, cta.type);
    const x = '\'' + pos.x + '+(' + (pos.from - pos.x) + ')*(max(0,1-(t-(' + a.toFixed(3) + '))/0.35)+max(0,(t-(' + (b - 0.35).toFixed(3) + '))/0.35))\'';
    const normal = await graphics.ctaCard(root, { type: cta.type, text: cta.text });
    graph.push(still(normal) + ',format=rgba[cta' + n + ']', '[' + last + '][cta' + n + ']overlay=x=' + x + ':y=' + pos.y + ':eval=frame:enable=\'between(t,' + a.toFixed(3) + ',' + b.toFixed(3) + ')\'[ctal' + n + ']');
    last = 'ctal' + n;
    if (cta.type !== 'comentar') {
      const pressed = await graphics.ctaCard(root, { type: cta.type, pressed: true });
      graph.push(still(pressed) + ',format=rgba[ctp' + n + ']', '[' + last + '][ctp' + n + ']overlay=x=' + x + ':y=' + pos.y + ':eval=frame:enable=\'between(t,' + (a + 2.2).toFixed(3) + ',' + b.toFixed(3) + ')\'[ctpl' + n + ']');
      last = 'ctpl' + n;
    }
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
    if (item.kind === 'transition' && item.narration && fs.existsSync(narrator.fileFor(root, item.narration.hash))) {
      // El narrador entra tras el golpe inicial y va en la pista de voz: la música baja sola (ducking).
      const index = add(['-i', narrator.fileFor(root, item.narration.hash)]);
      const delay = Math.round(narrator.START * 1000);
      graph.push('[' + index + ':a]aresample=48000,aformat=channel_layouts=stereo,volume=' + gain + ',adelay=' + delay + '|' + delay +
        ',apad=whole_dur=' + item.duration.toFixed(4) + ',atrim=0:' + item.duration.toFixed(4) + ',asetpts=N/SR/TB[nar' + voices.length + ']');
      voices.push('[nar' + voices.length + ']');
    } else if (item.kind === 'transition') {
      voices.push('[sil' + voices.length + ']');
      graph.push('anullsrc=r=48000:cl=stereo,atrim=0:' + item.duration.toFixed(4) + ',asetpts=N/SR/TB[sil' + (voices.length - 1) + ']');
    } else if (item.kind === 'endscreen') {
      voices.push('[sil' + voices.length + ']');
      graph.push('anullsrc=r=48000:cl=stereo,atrim=0:' + item.duration.toFixed(4) + ',asetpts=N/SR/TB[sil' + (voices.length - 1) + ']');
    } else {
      // Voz limpia (IA si está disponible, si no filtros clásicos) y solo los tramos conservados.
      const profile = project.settings.voice.profile || 'natural';
      const master = directStore.resolveFile(root, project.id, item.section.take.master);
      const cleaned = profile === 'original' ? { file: master, fallback: false } : await require('./voice-audio.cjs').cleanVoice(root, master, profile, signal).catch(() => ({ file: master, fallback: true }));
      const chain = require('./editing.cjs').voiceFilter(profile, cleaned.fallback);
      const index = add(['-i', cleaned.file]);
      const label = 'voz' + voices.length;
      const ranges = item.ranges;
      const parts = ranges.map((r, k) => label + 'r' + k);
      graph.push('[' + index + ':a]aresample=48000,aformat=channel_layouts=stereo' + (parts.length > 1 ? ',asplit=' + parts.length : '') + parts.map(x => '[' + x + 'in]').join(''));
      ranges.forEach((r, k) => graph.push('[' + parts[k] + 'in]atrim=start=' + r.start.toFixed(4) + ':duration=' + (r.frames / FPS).toFixed(4) + ',asetpts=N/SR/TB,apad=whole_dur=' + (r.frames / FPS).toFixed(4) +
        (ranges.length > 1 ? ',afade=t=in:d=0.008,afade=t=out:st=' + Math.max(0, r.frames / FPS - 0.01).toFixed(4) + ':d=0.008' : '') + '[' + parts[k] + ']'));
      graph.push(parts.map(x => '[' + x + ']').join('') + (parts.length > 1 ? 'concat=n=' + parts.length + ':v=0:a=1,' : '') + 'anull' + chain + ',volume=' + gain + ',atrim=0:' + item.duration.toFixed(4) + ',apad=whole_dur=' + item.duration.toFixed(4) + '[' + label + ']');
      voices.push('[' + label + ']');
    }
  }
  const ducking = project.settings.music.enabled && project.settings.music.ducking;
  graph.push(voices.join('') + 'concat=n=' + voices.length + ':v=0:a=1' + (ducking ? ',asplit=2[voice][side]' : '[voice]'));
  // Música: una pista por sección, desde su transición hasta el final, con fundido cruzado.
  const music = [];
  if (project.settings.music.enabled) {
    const sources = new Map();
    // Música de tráiler bajo las transiciones con narrador; la música de la sección entra al terminar.
    for (const item of timeline) {
      if (item.kind !== 'transition' || item.section.intro || item.section.transition.music === 'ninguna' || !item.narration) continue;
      const file = await audio.sting(root, item.duration, media);
      const index = add(['-i', file]);
      const offset = Math.round(item.start * 1000);
      const len = item.duration + 1.2;
      const volume = (item.section.audio.volume ?? project.settings.music.volume) * 1.6;
      graph.push('[' + index + ':a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:' + len.toFixed(4) + ',asetpts=N/SR/TB,afade=t=out:st=' + (len - 1.1).toFixed(3) + ':d=1.1,volume=' + volume.toFixed(3) +
        ',adelay=' + offset + '|' + offset + '[sting' + music.length + ']');
      music.push('[sting' + music.length + ']');
      const group = ctx.sectionsOnTimeline.find(g => g.section.id === item.section.id);
      if (group && group.start === item.start) group.start = item.start + item.duration - 0.3;
    }
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
  for (const click of ctx.clicks || []) {
    const file = await audio.ensure(root, 'sfx', 'clic', media);
    const index = add(['-i', file]);
    const offset = Math.round(click * 1000);
    graph.push('[' + index + ':a]aresample=48000,aformat=channel_layouts=stereo,volume=0.7,adelay=' + offset + '|' + offset + '[fx' + effects.length + ']');
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
  // Narrador de las transiciones (Piper, local). Sin él se exporta igual y se avisa.
  const narration = await narrator.prepare(root, id, { signal, send }, media);
  if (narration.warning) send({ stage: 'prepare', percent: 5, message: narration.warning, warning: narration.warning });
  project = directStore.read(root, id);
  const fresh = plan(project).pieces;
  const temp = media.temporary(root);
  const ctx = { root, project, media, signal, quality, temp, counter: 0,
    subtitles: section => project.settings.subtitles.enabled && project.settings.subtitles.burn && section.transcript?.takeId === section.take.id ? section.transcript.words : null };
  try {
    const files = [];
    const timeline = [];
    let frames = 0;
    const work = fresh.reduce((n, p) => n + (p.kind === 'section' ? Layout.pieces(Layout.fill(p.section.layouts, p.section.take.duration), Layout.kept(p.section.cuts, p.section.take.duration)).length : 1), 0);
    let done = 0;
    const step = message => send({ stage: 'video', percent: Math.round(5 + 75 * done / work), message });
    // Tiempos de salida previstos (para los recordatorios automáticos de los llamados a la acción).
    const outputStarts = {};
    let cursor = 0;
    for (const piece of fresh) {
      if (piece.kind === 'section') outputStarts[piece.section.id] = cursor;
      cursor += piece.kind === 'section' ? piece.duration : Math.round(piece.duration * FPS) / FPS;
    }
    const plannedCtas = auto.plannedCtas(project, outputStarts);
    ctx.clicks = [];
    let ctaCount = 0;
    for (const piece of fresh) {
      if (piece.kind === 'transition' || piece.kind === 'endscreen') {
        step(piece.kind === 'transition' ? 'Transición · ' + piece.section.title : 'Pantalla final');
        const file = path.join(temp, 'p' + files.length + '.mp4');
        const count = piece.kind === 'transition' ? await renderTransition(ctx, piece, file) : await renderEndscreen(ctx, piece, file);
        files.push(file);
        timeline.push({ kind: piece.kind, section: piece.section, start: frames / FPS, duration: count / FPS, narration: piece.narration || null });
        frames += count;
        done++;
        continue;
      }
      const section = piece.section;
      const ranges = Layout.kept(section.cuts, section.take.duration);
      const parts = Layout.pieces(Layout.fill(section.layouts, section.take.duration), ranges);
      const sectionStart = frames;
      // Llamados a la acción en tiempo de salida de la sección.
      const ctas = (plannedCtas[section.id] || []).map(c => {
        const startOut = Layout.mapTime(ranges, c.start);
        const length = c.end - c.start;
        return { ...c, outStart: startOut, outEnd: startOut + length };
      });
      for (const c of ctas) { ctx.clicks.push(sectionStart / FPS + c.outStart + (c.type === 'comentar' ? 0.1 : 2.2)); ctaCount++; }
      let local = 0;
      for (const [index, part] of parts.entries()) {
        step('Sección «' + section.title + '» · tramo ' + (index + 1) + ' de ' + parts.length);
        const file = path.join(temp, 'p' + files.length + '.mp4');
        const length = part.frames / FPS;
        const visible = ctas.filter(c => c.outEnd > local && c.outStart < local + length).map(c => ({ ...c, localStart: c.outStart - local, localEnd: c.outEnd - local }));
        await renderSegment(ctx, section, part, part.index, file, sectionStart / FPS + local, visible);
        files.push(file);
        frames += part.frames;
        local += length;
        done++;
      }
      // Rangos de audio con los mismos fotogramas que el video.
      const audioRanges = ranges.map(r => ({ start: r.start, frames: parts.filter(p => p.srcStart >= r.start - 1e-6 && p.srcEnd <= r.end + 1e-6).reduce((n, p) => n + p.frames, 0) })).filter(r => r.frames > 0);
      timeline.push({ kind: 'section', section, start: sectionStart / FPS, duration: (frames - sectionStart) / FPS, ranges: audioRanges });
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
    const blocks = timeline.filter(t => t.kind === 'section' && t.section.transcript?.takeId === t.section.take.id).map(t => {
      const ranges = Layout.kept(t.section.cuts, t.section.take.duration);
      const inside = w => ranges.some(r => w.start >= r.start - 0.05 && w.start < r.end);
      return { offset: t.start, words: t.section.transcript.words.filter(inside).map(w => ({ ...w, start: Layout.mapTime(ranges, w.start), end: Layout.mapTime(ranges, w.end) })) };
    });
    let srtRel = null;
    if (blocks.length) {
      srtRel = relative.replace(/\.mp4$/, '.srt');
      fs.writeFileSync(directStore.resolveFile(root, id, srtRel), '﻿' + captions.srt(blocks), 'utf8');
    }
    const entry = { file: relative, srt: srtRel, at: new Date().toISOString(), quality, duration: info.duration, width: info.width, height: info.height,
      size: fs.statSync(destination).size, chapters: chapters.chapters.map(({ sectionId, ...c }) => c), chaptersText: chapters.text, chaptersValid: chapters.valid,
      chapterProblems: chapters.problems, missing, burnedSubtitles: Boolean(project.settings.subtitles.enabled && project.settings.subtitles.burn),
      ctas: ctaCount, pieces: timeline.map(t => ({ kind: t.kind, sectionId: t.section.id, start: t.start, duration: t.duration })) };
    if (quality === 'final') {
      send({ stage: 'review', percent: 98, message: 'Revisión final del video' });
      entry.review = await auto.review(root, directStore.read(root, id), entry, destination, media).catch(error => ({ ok: true, items: [{ level: 'info', text: 'No se pudo completar la revisión: ' + error.message }] }));
    }
    const latest = directStore.read(root, id);
    latest.exports = [...(latest.exports || []), entry].slice(-20);
    directStore.write(root, latest);
    send({ stage: 'done', percent: 100, message: 'Exportación terminada' });
    return entry;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { exportProject, plan, chapterList, transitionImage, transitionBackground, renderTransition, renderSegment, renderEndscreen, renderAudio, QUALITY, safeName };
