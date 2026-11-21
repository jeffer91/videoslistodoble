'use strict';
/**
 * Videos largos directos · automatización.
 *  - Sincroniza el guion (y sus marcas) con la voz transcrita.
 *  - Propone cortes de silencios, muletillas y frases repetidas (se conserva el último intento).
 *  - Planifica los llamados a la acción (suscribirse, like, comentar).
 *  - Sugiere título, descripción y etiquetas de YouTube.
 *  - Revisión final del MP4 antes de publicar.
 */
const Layout = require('../renderer/direct-layout.js');
const intel = require('./direct-intel.cjs');

const FPS = Layout.FPS;
const q = value => Math.round(Math.max(0, value) * FPS) / FPS;
const FILLER = /^(e+h+|e+m+|m{2,}|mmm+|ehm+|uh+|um+|aa+h)$/;

function transcriptOf(section) {
  return section.take && section.transcript?.takeId === section.take.id ? section.transcript.words || [] : [];
}

/**
 * Alinea las palabras del guion con las palabras dichas (LCS con similitud).
 * Ante frases repetidas se queda con el último intento. Devuelve, para cada
 * palabra del guion, el índice de la palabra transcrita o -1.
 */
function alignWords(scriptTokens, spoken) {
  const n = scriptTokens.length, m = spoken.length;
  if (!n || !m) return { map: new Array(n).fill(-1), used: new Set() };
  const words = spoken.map(w => Layout.normalize(w.text));
  const match = (i, j) => Layout.similar(scriptTokens[i].word, words[j]) >= 0.75;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) dp[i][j] = match(i - 1, j - 1) ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const map = new Array(n).fill(-1), used = new Set();
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (match(i - 1, j - 1) && dp[i][j] === dp[i - 1][j - 1] + 1) { map[i - 1] = j - 1; used.add(j - 1); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  return { map, used };
}

/** Momento (en la toma) de cada palabra del guion; interpola las no reconocidas. */
function wordTimes(section) {
  const tokens = Layout.tokens(section.text);
  const spoken = transcriptOf(section);
  if (!spoken.length) {
    const estimate = intel.estimateWords({ ...section, text: Layout.stripMarks(section.text) });
    return tokens.map((_t, i) => estimate[i]?.start ?? (section.take?.duration || 0));
  }
  const { map } = alignWords(tokens, spoken);
  const times = map.map(j => (j >= 0 ? spoken[j].start : null));
  const total = section.take?.duration || spoken.at(-1).end;
  for (let i = 0; i < times.length; i++) {
    if (times[i] !== null) continue;
    let a = i - 1; while (a >= 0 && times[a] === null) a--;
    let b = i + 1; while (b < times.length && times[b] === null) b++;
    const ta = a >= 0 ? times[a] : 0, tb = b < times.length ? times[b] : total;
    times[i] = ta + (tb - ta) * (i - a) / (b - a);
  }
  return times;
}

/** Marcas del guion con su momento en la toma. */
function timedMarks(section) {
  const { marks } = Layout.marks(section.text);
  if (!marks.length || !section.take) return [];
  const times = wordTimes(section);
  return marks.map(mark => ({ ...mark, time: mark.word < times.length ? times[mark.word] : section.take.duration }));
}

/**
 * Cortes automáticos (editables y reversibles):
 *  - silencios de más de 0,8 s (deja un respiro natural),
 *  - muletillas («eh», «mmm»),
 *  - intentos fallidos: si una frase del guion se empezó y se repitió, se quita el intento anterior.
 */
function autocut(section) {
  const spoken = transcriptOf(section);
  const duration = section.take?.duration || 0;
  if (!spoken.length || !duration) return [];
  const cuts = [];
  const add = (start, end, reason) => { start = q(start); end = q(Math.min(duration, end)); if (end - start >= 0.25) cuts.push({ start, end, reason }); };
  const tokens = Layout.tokens(section.text);
  const { map, used } = alignWords(tokens, spoken);
  // Intentos fallidos: palabras dichas no alineadas que se parecen a lo que se lee justo después.
  const scriptOf = new Map(map.map((j, i) => [j, i]).filter(([j]) => j >= 0));
  for (let j = 0; j < spoken.length;) {
    if (used.has(j)) { j++; continue; }
    let k = j;
    while (k < spoken.length && !used.has(k)) k++;
    const run = spoken.slice(j, k);
    const next = k < spoken.length ? scriptOf.get(k) : null;
    const fillers = run.every(w => FILLER.test(Layout.normalize(w.text)));
    if (fillers) add(run[0].start - 0.02, (spoken[k]?.start ?? run.at(-1).end) - 0.05, 'Muletilla');
    else if (next !== null && next !== undefined && run.length >= 2) {
      const window = tokens.slice(Math.max(0, next - 20), next + 6).map(t => t.word);
      const similarRun = run.filter(w => window.some(x => Layout.similar(Layout.normalize(w.text), x) >= 0.75)).length;
      if (similarRun / run.length >= 0.6) add(run[0].start - 0.05, spoken[k].start - 0.12, 'Frase repetida: se conserva el último intento');
    }
    j = k;
  }
  // Silencios.
  if (spoken[0].start > 0.6) add(0, spoken[0].start - 0.3, 'Silencio inicial');
  for (let i = 1; i < spoken.length; i++) {
    const gap = spoken[i].start - spoken[i - 1].end;
    if (gap > 0.8) add(spoken[i - 1].end + 0.22, spoken[i].start - 0.18, 'Silencio de ' + gap.toFixed(1).replace('.', ',') + ' s');
  }
  if (duration - spoken.at(-1).end > 1.2) add(spoken.at(-1).end + 0.6, duration, 'Silencio final');
  // Une cortes que se tocan.
  cuts.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const cut of cuts) {
    const last = merged.at(-1);
    if (last && cut.start <= last.end + 0.05) { last.end = Math.max(last.end, cut.end); if (!last.reason.includes(cut.reason)) last.reason += ' · ' + cut.reason; }
    else merged.push({ ...cut });
  }
  return merged.map((c, i) => ({ id: 'corte-' + i + '-' + Math.round(c.start * 100), ...c, enabled: true, auto: true }));
}

// ── Llamados a la acción ────────────────────────────────────────────────────
const CTA_WORDS = [
  { type: 'suscribir', re: /^suscr[ií]b|^campan/ },
  { type: 'like', re: /^like$|^lik[eé]$|^megusta$/ },
  { type: 'comentar', re: /^comenta|^comentario/ }
];
const CTA_LENGTH = { suscribir: 5.2, like: 4.2, comentar: 7 };

/** Pregunta para los comentarios: la marca [PREGUNTA] o una pregunta dicha en el guion. */
function question(project) {
  for (const s of project.sections) {
    const mark = Layout.marks(s.text).marks.find(m => m.type === 'pregunta');
    if (mark) return mark.value.replace(/^¿?/, '¿').replace(/\??$/, '?');
  }
  for (const s of [...project.sections].reverse()) {
    const found = Layout.stripMarks(s.text).match(/¿[^?]{8,140}\?/g);
    if (found) return found.at(-1);
  }
  return '';
}

/**
 * Llamados a la acción por sección, en tiempo de la toma.
 * Fuentes: frases dichas, marcas [CTA]/[PREGUNTA], recordatorios automáticos y los añadidos a mano.
 */
function plannedCtas(project, outputStarts = null) {
  const settings = project.settings.cta || {};
  if (settings.enabled === false) return {};
  const ask = question(project);
  const bySection = {};
  const all = [];
  const push = (section, item) => {
    const off = section.ctaOff || [];
    if (off.includes(item.id)) return;
    (bySection[section.id] ||= []).push(item);
    all.push({ ...item, sectionId: section.id });
  };
  for (const section of project.sections.filter(s => s.take)) {
    const duration = section.take.duration;
    const words = transcriptOf(section);
    let lastOf = {};
    for (const w of words) {
      const norm = Layout.normalize(w.text);
      for (const rule of CTA_WORDS) {
        if (!rule.re.test(norm) || (lastOf[rule.type] !== undefined && w.start - lastOf[rule.type] < 20)) continue;
        lastOf[rule.type] = w.start;
        push(section, { id: 'voz-' + rule.type + '-' + Math.round(w.start), type: rule.type, start: Math.max(0, w.start - 0.3), text: rule.type === 'comentar' ? ask : '', source: 'voz' });
      }
    }
    for (const mark of timedMarks(section)) {
      if (mark.type === 'cta') {
        const v = Layout.normalize(mark.value);
        const type = /coment/.test(v) ? 'comentar' : /like|gusta/.test(v) ? 'like' : 'suscribir';
        push(section, { id: 'marca-' + type + '-' + mark.word, type, start: mark.time, text: type === 'comentar' ? ask : '', source: 'guion' });
      }
      if (mark.type === 'pregunta') push(section, { id: 'marca-pregunta-' + mark.word, type: 'comentar', start: mark.time, text: mark.value, source: 'guion' });
    }
    for (const manual of section.ctas || []) push(section, { ...manual, text: manual.type === 'comentar' ? manual.text || ask : '', source: 'manual' });
    for (const item of bySection[section.id] || []) item.end = Math.min(duration, item.start + CTA_LENGTH[item.type]);
  }
  // Recordatorios automáticos: uno hacia el minuto 1:30 y otro al final.
  if (settings.reminders !== false && outputStarts) {
    const recorded = project.sections.filter(s => s.take);
    const near = (type, at) => all.some(c => c.type === type && Math.abs((outputStarts[c.sectionId] ?? 0) + c.start - at) < 45);
    const place = (type, target, text) => {
      for (const s of recorded) {
        const start = outputStarts[s.id] ?? 0, length = s.take.duration;
        if (target >= start && target < start + length - CTA_LENGTH[type]) {
          const local = Math.max(3, target - start);
          push(s, { id: 'auto-' + type + '-' + Math.round(target), type, start: local, end: Math.min(length, local + CTA_LENGTH[type]), text, source: 'automático' });
          return;
        }
      }
    };
    const total = recorded.length ? (outputStarts[recorded.at(-1).id] ?? 0) + recorded.at(-1).take.duration : 0;
    if (total > 70 && !near('suscribir', 90)) place('suscribir', Math.min(90, total * 0.25), '');
    const finalType = ask ? 'comentar' : 'like';
    if (total > 25 && !near(finalType, total - 18)) place(finalType, Math.max(5, total - 20), ask);
  }
  for (const list of Object.values(bySection)) list.sort((a, b) => a.start - b.start);
  return bySection;
}

// ── Marcas aplicadas a la composición ─────────────────────────────────────
const TRANSITION_NAMES = { estadio: 'estadio', tunel: 'tunel', cesped: 'cesped', luces: 'luces', grafico: 'grafico', graficos: 'grafico', movimiento: 'movimiento' };
const MOOD_NAMES = { epica: 'epica', emotiva: 'emotiva', tension: 'tension', ambiental: 'ambiental', ninguna: 'ninguna', sin: 'ninguna' };

/** «44 goles» → { value: '44', label: 'goles' } para la tarjeta gráfica. */
function markStat(value) {
  const parsed = intel.statistic(value);
  if (parsed) return { ...parsed, context: '' };
  const m = /^\s*([\d.,%]+)\s+(.+)$/.exec(value);
  return m ? { value: m[1], label: m[2].slice(0, 40), context: '' } : { value: value.slice(0, 12), label: '', context: '' };
}
const statKey = stat => stat.value + '|' + stat.label;

function imageTagged(project, value) {
  const wanted = Layout.normalize(String(value).replace(/\s+/g, ''));
  return project.images.find(i => [...(i.tags || []), i.source?.query].filter(Boolean).some(t => Layout.normalize(String(t).replace(/\s+/g, '')) === wanted)) || null;
}

/** Ajusta una propuesta con las marcas del guion ([IMAGEN], [DATO], [COMPOSICIÓN]). */
function applyMarks(project, section, layouts) {
  const out = layouts.map(l => ({ ...l }));
  for (const mark of timedMarks(section)) {
    const seg = out.find(l => mark.time >= l.start && mark.time < l.end) || out.at(-1);
    if (!seg) continue;
    if (mark.type === 'imagen') {
      const image = imageTagged(project, mark.value);
      if (image) Object.assign(seg, { imageId: image.id, layout: ['B', 'C', 'D'].includes(seg.layout) ? seg.layout : (seg.end - seg.start > 8 ? 'C' : 'B'), reason: 'Guion: imagen «' + mark.value + '»' });
    } else if (mark.type === 'dato') {
      const image = project.images.find(i => i.source?.stat === statKey(markStat(mark.value)));
      if (image) Object.assign(seg, { imageId: image.id, layout: 'B', reason: 'Guion: dato «' + mark.value + '»' });
    } else if (mark.type === 'composicion') {
      const letter = (/\b([A-E])\b/i.exec(mark.value) || [])[1];
      if (letter) Object.assign(seg, { layout: letter.toUpperCase(), reason: 'Guion: composición ' + letter.toUpperCase() });
    }
  }
  return out;
}

/** Música y transición pedidas en el guion. */
function sectionDirectives(section) {
  const result = {};
  for (const mark of Layout.marks(section.text).marks) {
    const v = Layout.normalize(mark.value.split(/\s+/)[0]);
    if (mark.type === 'musica' && MOOD_NAMES[v]) result.mood = MOOD_NAMES[v];
    if (mark.type === 'transicion' && TRANSITION_NAMES[v]) result.transition = TRANSITION_NAMES[v];
  }
  return result;
}

// ── YouTube ─────────────────────────────────────────────────────────────────
function suggestMetadata(project) {
  const first = project.sections[0];
  const text = project.sections.map(s => Layout.stripMarks(s.text)).join(' ');
  const names = intel.entities(text).filter(e => e.known).map(e => e.name);
  const hook = Layout.stripMarks(first?.text || '').replace(/\s+/g, ' ').split(/(?<=[.!?…])\s+/).slice(0, 2).join(' ').slice(0, 280);
  const hashtags = ['#fútbol', ...names.slice(0, 2).map(n => '#' + n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, ''))];
  const ask = question(project);
  const description = [hook, ask ? ask + ' Te leo en los comentarios.' : '', '🔔 Suscríbete a Once Records y activa la campana para no perderte ninguna historia del fútbol.', hashtags.join(' ')].filter(Boolean).join('\n\n');
  const tags = [...new Set([...names.slice(0, 10), 'fútbol', 'Once Records', 'historias del fútbol'])].slice(0, 15);
  return { title: project.title.slice(0, 100), description, tags, comment: ask };
}

// ── Revisión final ──────────────────────────────────────────────────────────
async function review(root, project, entry, file, media = require('./media.cjs')) {
  const items = [];
  const add = (level, text) => items.push({ level, text });
  const stats = await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-nostats', '-i', file, '-af', 'astats=measure_overall=Peak_level:measure_perchannel=0,silencedetect=noise=-45dB:d=3', '-f', 'null', process.platform === 'win32' ? 'NUL' : '-']);
  const peak = Number(/Peak level dB:\s*(-?[\d.]+|-inf)/.exec(stats.stderr)?.[1]);
  if (Number.isFinite(peak) && peak > -0.3) add('aviso', 'El audio llega a ' + peak.toFixed(1) + ' dB: puede sonar saturado.');
  else add('ok', 'Volumen de audio correcto (normalizado a −14 LUFS).');
  const breaks = new Set((entry.pieces || []).filter(p => p.kind !== 'section').map(p => Math.round(p.start)));
  const silences = [...stats.stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map(m => Number(m[1])).filter(t => ![...breaks].some(b => Math.abs(b - t) < 6));
  if (silences.length) add('aviso', 'Silencios largos en ' + silences.slice(0, 4).map(Layout.stamp).join(', ') + '. Revisa los cortes.');
  else add('ok', 'Sin silencios largos en la narración.');
  if (entry.chaptersValid) add('ok', entry.chapters.length + ' capítulos válidos para YouTube.');
  else add('aviso', 'Capítulos: ' + entry.chapterProblems.join(' · '));
  if (entry.missing?.length) add('error', 'Secciones sin grabar: ' + entry.missing.join(', '));
  const untranscribed = project.sections.filter(s => s.take && !transcriptOf(s).length).map(s => s.title);
  if (project.settings.subtitles.enabled && untranscribed.length) add('aviso', 'Sin subtítulos en: ' + untranscribed.join(', ') + ' (transcribe con Whisper).');
  else if (project.settings.subtitles.enabled) add('ok', 'Subtítulos sincronizados' + (entry.burnedSubtitles ? ' e integrados.' : ' en archivo .srt.'));
  const ctas = entry.ctas || 0;
  if (!ctas) add('aviso', 'No hay llamados a la acción (suscribirse, like, comentar).');
  else add('ok', ctas + ' llamados a la acción en pantalla.');
  for (const s of project.sections.filter(x => x.take)) {
    const ids = s.layouts.map(l => l.imageId).filter(Boolean);
    if (ids.length >= 3 && new Set(ids).size === 1) add('aviso', '«' + s.title + '» usa siempre la misma imagen.');
    if (!s.layouts.length) add('aviso', '«' + s.title + '» no tiene cambios de composición (puede resultar monótona).');
  }
  if (entry.duration < 480) add('info', 'El video dura ' + Layout.stamp(entry.duration) + '. Desde 8 minutos YouTube permite anuncios en mitad del video.');
  const title = project.youtube.title || project.title;
  if (title.length > 70) add('aviso', 'El título tiene ' + title.length + ' caracteres; en los resultados de búsqueda se corta hacia los 70.');
  if (!String(project.youtube.description || '').trim()) add('info', 'La descripción está vacía: usa «Rellenar automáticamente».');
  return { at: new Date().toISOString(), ok: !items.some(i => i.level === 'error'), items };
}

module.exports = { markStat, statKey, imageTagged, applyMarks, sectionDirectives, alignWords, wordTimes, timedMarks, autocut, plannedCtas, question, suggestMetadata, review, CTA_LENGTH };
