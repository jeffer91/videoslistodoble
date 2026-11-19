'use strict';
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store.cjs');
const catalog = require('./catalog.cjs');

const SCENES = ['hook', 'body', 'closing'];
const MODES = ['both', 'audio', 'video'];
const PROFILES = {
  original: '',
  limpia: 'highpass=f=75,afftdn=nf=-28',
  podcast: 'highpass=f=85,afftdn=nf=-27,equalizer=f=3200:t=q:w=1:g=3,acompressor=threshold=0.13:ratio=3:attack=12:release=130,alimiter=limit=0.88',
  exterior: 'highpass=f=110,afftdn=nf=-23,equalizer=f=250:t=q:w=1.2:g=-3,acompressor=threshold=0.15:ratio=2.5'
};

function voiceFilter(profile) {
  return PROFILES[profile] ? ',' + PROFILES[profile] : '';
}

function text(value, limit, field) {
  if (typeof value !== 'string' || value.length > limit) throw Error(field + ' inválido o demasiado largo');
  return value.trim();
}

function list(value, max, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) throw Error(label + ' inválidos');
  return value;
}

function seconds(value, max = 7200) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw Error('Tiempo inválido');
  return value;
}

function interval(item, from = 'start', to = 'end') {
  const start = seconds(item?.[from]);
  const end = seconds(item?.[to]);
  if (end <= start) throw Error('El final debe ir después del inicio');
  return { start, end };
}

function getObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(label + ' inválido');
  return value;
}

function normalizeWords(raw) {
  return list(raw, 4500, 'Palabras de la transcripción').map(item => ({
    ...interval(item),
    text: text(item.text, 90, 'Texto de transcripción')
  })).filter(item => item.text).sort((a, b) => a.start - b.start || a.end - b.end);
}

function normalizePlan(plan, project) {
  getObject(plan, 'Plan de edición');
  if (plan.version !== 1) throw Error('El plan de edición requiere version: 1');
  const scenes = getObject(plan.scenes || {}, 'Conjunto de escenas');
  if (Object.keys(scenes).some(key => !SCENES.includes(key))) throw Error('Escena desconocida en el plan');
  const asset = (assetId, types) => {
    const item = project.assets.find(candidate => candidate.id === assetId);
    if (!item || !types.includes(item.type)) throw Error('El recurso indicado no pertenece al proyecto');
    return assetId;
  };
  const entry = key => {
    const item = getObject(scenes[key] || {}, 'Escena del plan');
    const cuts = list(item.cuts, 120, 'Cortes').map(cut => {
      if (!MODES.includes(cut?.mode)) throw Error('Tipo de corte inválido');
      return { ...interval(cut), mode: cut.mode };
    });
    const texts = list(item.texts, 25, 'Rótulos').map(mark => ({
      ...interval(mark), text: text(mark.text, 76, 'Rótulo')
    }));
    const highlights = list(item.highlights, 50, 'Resaltados').map(word => text(word, 60, 'Resaltado')).filter(Boolean);
    const graphics = list(item.graphics, 12, 'Gráficos').map(graphic => ({
      ...interval(graphic),
      text: text(graphic.text || '', 64, 'Gráfico'),
      assetId: graphic.assetId ? asset(graphic.assetId, ['video']) : null
    })).filter(graphic => graphic.text || graphic.assetId);
    const memes = list(item.memes, 6, 'Memes').map(meme => {
      const duration = seconds(meme.duration, 12);
      if (duration < .25) throw Error('El meme debe durar al menos 0,25 segundos');
      return { at: seconds(meme.at), duration, assetId: asset(meme.assetId, ['image', 'video']) };
    }).sort((a, b) => a.at - b.at);
    const sourceAsset = item.sourceAsset ?? project.scenes[key]?.video ?? null;
    return { sourceAsset: sourceAsset ? asset(sourceAsset, ['video']) : null, cuts, texts, highlights, graphics, memes };
  };
  const voice = plan.voice || 'original';
  if (!Object.hasOwn(PROFILES, voice)) throw Error('Perfil de voz inválido');
  return { version: 1, source: plan.source === 'claude' ? 'claude' : 'manual', voice,
    captions: plan.captions !== false, scenes: Object.fromEntries(SCENES.map(key => [key, entry(key)])) };
}

function effectiveScene(project, key) {
  const scene = project.scenes[key];
  const plan = project.editingPlan;
  const entry = plan?.scenes?.[key];
  const current = entry && (!entry.sourceAsset || entry.sourceAsset === scene.video) ? entry : null;
  const transcript = project.transcripts?.[key];
  return {
    ...scene, cuts: [...(scene.cuts || []), ...(current?.cuts || [])],
    captions: plan?.captions !== false && transcript?.assetId === scene.video ? transcript.words : [],
    editing: current, voice: plan?.voice || 'original'
  };
}

function clipsOnOutput(items, ranges, rate) {
  const results = [];
  let position = 0;
  for (const range of ranges) {
    for (const entry of items) {
      const start = Math.max(entry.start, range.start);
      const end = Math.min(entry.end, range.end);
      if (end > start + .015) results.push({
        ...entry, start: position + (start - range.start) / rate, end: position + (end - range.start) / rate
      });
    }
    position += (range.end - range.start) / rate;
  }
  return results;
}

function plannedMemes(scene, ranges, rate) {
  const result = [];
  for (const entry of scene.editing?.memes || []) {
    const at = clipsOnOutput([{ start: entry.at, end: entry.at + .03 }], ranges, rate)[0]?.start;
    if (at !== undefined) result.push({ ...entry, at });
  }
  return result;
}

function stamp(seconds) {
  const units = Math.max(0, Math.round(seconds * 100));
  return Math.floor(units / 360000) + ':' + String(Math.floor(units / 6000) % 60).padStart(2, '0') +
    ':' + String(Math.floor(units / 100) % 60).padStart(2, '0') + '.' + String(units % 100).padStart(2, '0');
}

function assText(value) {
  return String(value).replace(/[{}\\\r\n\0]/g, ' ').replace(/\s+/g, ' ').trim();
}

function captionEvents(words, highlights, width) {
  const emphasized = new Set(highlights.flatMap(word => catalog.fold(word).split(' ')));
  const events = [];
  let group = [];
  const flush = () => {
    for (const [index, current] of group.entries()) {
      const end = Math.min(group[index + 1]?.start ?? current.end + .12, current.end + .12);
      const content = group.map((word, wordIndex) => {
        const cleaned = assText(word.text);
        return wordIndex === index || emphasized.has(catalog.fold(cleaned.replace(/[^\p{L}\p{N}]/gu, '')))
          ? '{\\c&H0052D5FF&}' + cleaned + '{\\c&H00FFFFFF&}' : cleaned;
      }).join(' ');
      if (end > current.start + .02) events.push({ ...current, end, style: 'Caption', content });
    }
    group = [];
  };
  for (const word of words) {
    const last = group.at(-1);
    const chars = group.reduce((sum, entry) => sum + assText(entry.text).length + 1, word.text.length);
    if (group.length >= 5 || chars > (width > 1080 ? 46 : 28) || (last && word.start - last.end > .4)) flush();
    group.push({ ...word, text: [...word.text].slice(0, width > 1080 ? 43 : 26).join('') });
  }
  flush();
  return events;
}

function assDocument(width, height, words, highlights, texts, graphics) {
  const margin = Math.max(12, Math.round(width * .09));
  const subtitleSize = Math.max(13, Math.round(Math.min(width, height * 1.4) * .049));
  const head = [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: ' + width, 'PlayResY: ' + height, 'WrapStyle: 0',
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Caption,Arial,' + subtitleSize + ',&H00FFFFFF,&H0052D5FF,&H0000080A,&H70000000,-1,0,0,0,100,100,0,0,1,3,1,2,' + margin + ',' + margin + ',' + Math.round(height * .18) + ',1',
    'Style: Card,Arial,' + Math.round(subtitleSize * .84) + ',&H0052D5FF,&H00FFFFFF,&H00132417,&H70000000,-1,0,0,0,100,100,0,0,3,8,0,8,' + margin + ',' + margin + ',' + Math.round(height * .18) + ',1',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];
  const events = captionEvents(words, highlights, width);
  for (const item of texts) events.push({ ...item, style: 'Card', content: '{\\fad(120,120)}' + assText(item.text) });
  for (const item of graphics) {
    events.push({ ...item, style: 'Card', content: '{\\fad(200,170)\\fscx85\\fscy85\\t(0,230,\\fscx100\\fscy100)}' + assText(item.text) });
  }
  return head.concat(events.map(event => ['Dialogue: 0', stamp(event.start), stamp(event.end), event.style, '', 0, 0, 0, '', event.content].join(','))).join('\n') + '\n';
}

async function overlayScene(library, root, project, scene, segments, ranges, rate, signal) {
  const media = require('./media.cjs');
  const entry = scene.editing;
  const words = clipsOnOutput(scene.captions || [], ranges, rate);
  const values = name => clipsOnOutput(entry?.[name] || [], ranges, rate);
  const texts = values('texts');
  const graphics = values('graphics');
  const memes = plannedMemes(scene, ranges, rate);
  const at=scene.closingStamp?.at;
  const stampRanges=Number.isFinite(at) && ranges.some(r=>r.start<=at && at<r.end)
    ? clipsOnOutput([{start:at,end:at+1}],ranges,rate) : [];
  if (!stampRanges.length && !words.length && !texts.length && !graphics.length && !memes.length) return { segments, added: 0 };
  const input = path.join(root, 'scene.mp4');
  await media.concat(root, segments, input, signal);
  let last = input;
  const info = await media.probe(input);
  const subtitles = words.length || texts.length || graphics.some(item => !item.assetId);
  const overlays = graphics.filter(item => item.assetId);
  if (subtitles || overlays.length) {
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input];
    const filter = [];
    let video = '0:v';
    if (subtitles) {
      fs.writeFileSync(path.join(root, 'texto.ass'),
        assDocument(info.width, info.height, words, entry?.highlights || [], texts, graphics.filter(item => !item.assetId)));
      filter.push('[0:v]ass=texto.ass[captioned]');
      video = 'captioned';
    }
    for (const [index, graphic] of overlays.entries()) {
      const assetPath = store.resolveAsset(library, project.id, graphic.assetId);
      if (path.extname(assetPath).toLowerCase() === '.webm') args.push('-c:v', 'libvpx-vp9');
      args.push('-i', assetPath);
      const i = index + 1;
      filter.push('[' + i + ':v]trim=duration=' + (graphic.end - graphic.start).toFixed(3) +
        ',scale=' + info.width + ':' + info.height + ':force_original_aspect_ratio=decrease,format=rgba,setpts=PTS-STARTPTS+' +
        graphic.start.toFixed(3) + '/TB[g' + i + ']');
      filter.push('[' + video + '][g' + i + ']overlay=(W-w)/2:(H-h)/2:eof_action=pass[o' + i + ']');
      video = 'o' + i;
    }
    last = path.join(root, 'decorado.mp4');
    await media.command(media.toolPath('ffmpeg'), [...args, '-filter_complex', filter.join(';'), '-map', '[' + video + ']',
      '-map', '0:a', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', last],
    signal, null, root);
  }
  if (stampRanges.length) {
    const start=stampRanges[0].start, end=stampRanges.at(-1).end;
    for(const name of ['sello.png','sello.wav'])
      fs.copyFileSync(path.join(__dirname,'..','assets',name),path.join(root,name));
    const output=path.join(root,'sellado.mp4');
    const width=2*Math.round(info.width*.6/2);
    const graph=[
      '[1:v]scale='+width+':-1,format=rgba[stamp]',
      "[0:v][stamp]overlay=x=(W-w)/2:y=H*0.24:enable='gte(t,"+start.toFixed(6)+")*lt(t,"+end.toFixed(6)+")'[v]",
      '[2:a]adelay='+Math.round(start*1000)+':all=1[hit]',
      '[0:a][hit]amix=inputs=2:duration=first:normalize=0[a]'
    ];
    await media.command(media.toolPath('ffmpeg'),['-hide_banner','-loglevel','error','-y','-i',last,
      '-i','sello.png','-i','sello.wav','-filter_complex',graph.join(';'),'-map','[v]','-map','[a]',
      '-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2',output],signal,null,root);
    last=output;
  }
  let added = 0;
  for (const [index, meme] of memes.entries()) {
    const output = path.join(root, 'meme-' + index + '.mp4');
    const assetPath = store.resolveAsset(library, project.id, meme.assetId);
    const moment = Math.round(30 * Math.max(.06, Math.min(info.duration + added - .06, meme.at + added))) / 30;
    const duration = meme.duration;
    const maxWidth = Math.floor(info.width * .83 / 2) * 2;
    const maxHeight = Math.floor(info.height * .50 / 2) * 2;
    const graph = [
      '[0:v]trim=end=' + moment + ',setpts=PTS-STARTPTS[v0]',
      '[0:a]atrim=end=' + moment + ',asetpts=PTS-STARTPTS[a0]',
      '[0:v]trim=start=' + moment + ':duration=0.045,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=' +
        duration + ',trim=duration=' + duration + ',gblur=sigma=18[bg]',
      '[1:v]fps=30,scale=' + maxWidth + ':' + maxHeight + ':force_original_aspect_ratio=decrease,setsar=1,setpts=PTS-STARTPTS[sticker]',
      '[bg][sticker]overlay=(W-w)/2:(H-h)/2:shortest=1[vm]',
      'anullsrc=r=48000:cl=stereo:d=' + duration + '[am]',
      '[0:v]trim=start=' + moment + ',setpts=PTS-STARTPTS[v1]',
      '[0:a]atrim=start=' + moment + ',asetpts=PTS-STARTPTS[a1]',
      '[v0][a0][vm][am][v1][a1]concat=n=3:v=1:a=1[v][a]'
    ];
    const image = project.assets.find(item => item.id === meme.assetId)?.type === 'image';
    await media.command(media.toolPath('ffmpeg'), [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', last, ...(image ? ['-loop', '1'] : ['-stream_loop', '-1']),
      '-t', (duration + .1).toFixed(3), '-i', assetPath, '-filter_complex', graph.join(';'),
      '-map', '[v]', '-map', '[a]', '-r', '30', '-t', (info.duration + added + duration).toFixed(3),
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-ar', '48000', '-ac', '2', '-c:a', 'aac', output
    ], signal);
    last = output;
    added += duration;
  }
  return { segments: [last], added };
}

function editingSettings(root) {
  return require('./production.cjs').readState(root, 'edicion', { whisper: '', model: '' });
}

function editSettings(root, values) {
  return require('./production.cjs').writeState(root, 'edicion', { ...editingSettings(root), ...values });
}

function parseWhisper(result) {
  const words = [];
  for (const segment of result.transcription || []) {
    const start = Number(segment.offsets?.from) / 1000;
    const end = Number(segment.offsets?.to) / 1000;
    if (!(end > start)) continue;
    let group = null;
    const flush = () => {
      if (group?.text.trim() && group.end > group.start) words.push(group);
      group = null;
    };
    const initial = words.length;
    for (const token of segment.tokens || []) {
      const content = String(token.text || '');
      if (!content.trim() || /^\[[_A-Z0-9]+\]$/.test(content.trim())) continue;
      const from = Number(token.offsets?.from) / 1000;
      const to = Number(token.offsets?.to) / 1000;
      if (!Number.isFinite(from) || !(to > from)) continue;
      if (/^\s/.test(content)) flush();
      if (group) {
        group.text += content;
        group.end = Math.max(group.end, to);
      } else {
        group = { text: content.trim(), start: Math.max(start, from), end: Math.min(end, to) };
      }
    }
    flush();
    if (words.length === initial) {
      const parts = String(segment.text || '').trim().split(/\s+/).filter(Boolean);
      for (const [index, word] of parts.entries()) words.push({
        start: start + (end - start) * index / parts.length,
        end: start + (end - start) * (index + 1) / parts.length, text: word
      });
    }
  }
  return normalizeWords(words);
}

function setTranscript(root, { id, scene, assetId, words }) {
  if (!SCENES.includes(scene)) throw Error('Escena inválida');
  const project = store.getProject(root, id);
  if (!assetId || project.scenes[scene].video !== assetId) throw Error('La toma cambió. Vuelve a transcribir.');
  const transcripts = { ...project.transcripts, [scene]: { assetId, words: normalizeWords(words) } };
  const scenes = { ...project.scenes, [scene]: { ...project.scenes[scene], approved: false } };
  return store.saveProject(root, { id, transcripts, scenes });
}

async function transcribe(root, id, signal, send = () => {}) {
  const config = editingSettings(root);
  if (!config.whisper || !config.model || !fs.existsSync(config.whisper) || !fs.existsSync(config.model)) {
    throw Error('Configura whisper-cli y el modelo multilingüe en Ajustes');
  }
  const media = require('./media.cjs');
  const project = store.getProject(root, id);
  const temp = media.temporary(root);
  const scenes = SCENES.filter(scene => project.scenes[scene].video);
  if (!scenes.length) throw Error('Graba o importa alguna escena');
  try {
    for (const [index, scene] of scenes.entries()) {
      const assetId = project.scenes[scene].video;
      const source = store.resolveAsset(root, id, assetId);
      if (!(await media.probe(source)).hasAudio) throw Error('La escena ' + scene + ' no tiene narración');
      const wave = path.join(temp, scene + '.wav');
      const output = path.join(temp, scene);
      send({ type: 'status', message: 'Transcribiendo ' + scene + ' en tu PC', percent: Math.round(100 * index / scenes.length) });
      await media.command(media.toolPath('ffmpeg'), [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wave
      ], signal);
      await media.command(config.whisper, ['-m', config.model, '-f', wave, '-l', 'es', '-ojf', '-sow', '-of', output], signal);
      const words = parseWhisper(store.readJSON(output + '.json'));
      setTranscript(root, { id, scene, assetId, words });
      const previous = store.getProject(root, id);
      if (!(previous.scenes[scene].silences || []).length) {
        const silences = await media.detectSilences(source, store.getSettings(root).silenceThreshold, signal);
        const latest = store.getProject(root, id);
        if (latest.scenes[scene].video === assetId && !(latest.scenes[scene].silences || []).length && silences.length) {
          latest.scenes[scene].silences = silences;
          store.saveProject(root, { id, scenes: latest.scenes });
        }
      }
    }
    return store.getProject(root, id);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function importScript(root, id, input) {
  const current = store.getProject(root, id);
  const value = typeof input === 'string' ? { script: catalog.parseScript(input) } : getObject(input, 'Guion');
  return store.saveProject(root, {
    id, title: value.title ?? current.title,
    script: value.script ?? current.script,
    tags: value.tags ?? current.tags,
    notes: value.notes,
    withClaude: current.withClaude || value.source === 'claude'
  });
}

function applyPlan(root, id, input) {
  const project = store.getProject(root, id);
  const plan = normalizePlan(input, project);
  return store.saveProject(root, {
    id, editingPlan: plan, withClaude: project.withClaude || plan.source === 'claude',
    scenes: Object.fromEntries(SCENES.map(key => [key, { ...project.scenes[key], approved: false }]))
  });
}

function exportHandoff(root, id) {
  const project = store.getProject(root, id);
  const directory = path.join(root, 'Proyectos', project.id, 'Edicion');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'transcripcion-y-guion.json');
  const scenes = Object.fromEntries(SCENES.map(key => [
    key, { script: project.script?.[key] || '', ...project.transcripts?.[key] }
  ]));
  store.atomic(file, { version: 1, title: project.title, tags: catalog.tagsOf(project), scenes,
    resources: project.assets.map(({ id, name, type }) => ({ id, name, type })) });
  return file;
}

module.exports = {
  PROFILES, voiceFilter, normalizeWords, normalizePlan, effectiveScene, clipsOnOutput, plannedMemes, assDocument,
  overlayScene, editingSettings, editSettings, parseWhisper, setTranscript, transcribe,
  importScript, applyPlan, exportHandoff
};
