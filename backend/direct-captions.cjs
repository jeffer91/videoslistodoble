'use strict';
/**
 * Videos largos directos · subtítulos.
 * Agrupa las palabras transcritas en líneas legibles y genera SRT (archivo
 * independiente) y ASS (subtítulos integrados con estilos y resaltado).
 */

const MAX_CHARS = 42;
const MAX_SECONDS = 3.2;

/** Agrupa palabras con tiempo en subtítulos de una o dos líneas. */
function cues(words) {
  const list = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    list.push({ start: current[0].start, end: current.at(-1).end, words: current, text: current.map(w => w.text).join(' ') });
    current = [];
  };
  for (const word of words || []) {
    const text = current.map(w => w.text).join(' ');
    const gap = current.length ? word.start - current.at(-1).end : 0;
    if (current.length && (text.length + word.text.length + 1 > MAX_CHARS || word.end - current[0].start > MAX_SECONDS || gap > 0.8)) flush();
    current.push(word);
    if (/[.!?…]["”»)]*$/.test(word.text) || (/[,;:]$/.test(word.text) && current.map(w => w.text).join(' ').length > 22)) flush();
  }
  flush();
  // Que cada subtítulo dure al menos 0,7 s sin pisar el siguiente.
  for (let i = 0; i < list.length; i++) {
    const next = list[i + 1]?.start ?? Infinity;
    list[i].end = Math.min(next - 0.02, Math.max(list[i].end, list[i].start + 0.7));
  }
  return list;
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ',' + String(ms % 1000).padStart(3, '0');
}

/** SRT a partir de bloques { offset, words }. */
function srt(blocks) {
  const lines = [];
  let n = 1;
  for (const block of blocks) {
    for (const cue of cues(block.words)) {
      lines.push(String(n++), srtTime(cue.start + block.offset) + ' --> ' + srtTime(cue.end + block.offset), wrap(cue.text), '');
    }
  }
  return lines.join('\r\n');
}

function wrap(text) {
  if (text.length <= 32) return text;
  const words = text.split(' ');
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return words.slice(0, best).join(' ') + '\n' + words.slice(best).join(' ');
}

function assTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  return Math.floor(cs / 360000) + ':' + String(Math.floor(cs % 360000 / 6000)).padStart(2, '0') + ':' + String(Math.floor(cs % 6000 / 100)).padStart(2, '0') + '.' + String(cs % 100).padStart(2, '0');
}

const assText = value => String(value).replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\n/g, '\\N');

const STYLES = {
  // Nombre: fuente, negrita, color primario, contorno, sombra, caja
  impacto: { font: 'Arial Black', bold: -1, primary: '&H00FFFFFF', outlineColor: '&H00000000', back: '&H96000000', outline: 5, shadow: 2, box: 1 },
  clasico: { font: 'Arial', bold: -1, primary: '&H00FFFFFF', outlineColor: '&H80000000', back: '&HA0000000', outline: 0, shadow: 0, box: 3 },
  karaoke: { font: 'Arial Black', bold: -1, primary: '&H005FB1D4', outlineColor: '&H00000000', back: '&H96000000', outline: 4, shadow: 2, box: 1, secondary: '&H00FFFFFF' },
  minimal: { font: 'Arial', bold: 0, primary: '&H00FFFFFF', outlineColor: '&H00000000', back: '&H64000000', outline: 2, shadow: 1, box: 1 }
};
const HIGHLIGHT = '&H005FB1D4&'; // dorado Once Records (BGR)

/**
 * Documento ASS para un tramo: palabras con tiempos relativos al tramo.
 * El estilo «impacto» resalta la palabra que se está diciendo.
 */
function ass(words, { style = 'impacto', size = 58, position = 'bottom', highlight = true } = {}, width = 1920, height = 1080, range = null) {
  const s = STYLES[style] || STYLES.impacto;
  const alignment = position === 'top' ? 8 : position === 'middle' ? 5 : 2;
  const margin = position === 'bottom' ? 70 : 60;
  const header = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: ' + width, 'PlayResY: ' + height, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Sub,' + s.font + ',' + size + ',' + s.primary + ',' + (s.secondary || s.primary) + ',' + s.outlineColor + ',' + s.back + ',' + s.bold + ',0,0,0,100,100,0,0,' + s.box + ',' + (s.box === 3 ? 12 : s.outline) + ',' + s.shadow + ',' + alignment + ',120,120,' + margin + ',1', '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
  const events = [];
  const from = range ? range.from : 0, to = range ? range.to : Infinity;
  const time = value => assTime(Math.min(to, Math.max(from, value)) - from);
  const visible = (a, b) => Math.min(b, to) - Math.max(a, from) >= 0.01;
  for (const cue of cues(words)) {
    if (!visible(cue.start, cue.end)) continue;
    const upper = style === 'impacto';
    const show = w => assText(upper ? w.text.toLocaleUpperCase('es') : w.text);
    if (style === 'karaoke') {
      const parts = cue.words.map((w, i) => '{\\kf' + Math.max(1, Math.round(((cue.words[i + 1]?.start ?? w.end) - w.start) * 100)) + '}' + show(w));
      events.push('Dialogue: 0,' + time(cue.start) + ',' + time(cue.end) + ',Sub,,0,0,0,,' + (cue.start >= from ? '{\\fad(80,80)}' : '') + parts.join(' '));
    } else if (highlight && style !== 'minimal') {
      // Un evento por palabra: la palabra activa en dorado y ligeramente ampliada.
      cue.words.forEach((active, i) => {
        const start = i === 0 ? cue.start : active.start;
        const end = i === cue.words.length - 1 ? cue.end : cue.words[i + 1].start;
        if (end - start < 0.01 || !visible(start, end)) return;
        const text = cue.words.map(w => w === active ? '{\\c' + HIGHLIGHT + '\\fscx106\\fscy106}' + show(w) + '{\\r}' : show(w)).join(' ');
        events.push('Dialogue: 0,' + time(start) + ',' + time(end) + ',Sub,,0,0,0,,' + text);
      });
    } else {
      events.push('Dialogue: 0,' + time(cue.start) + ',' + time(cue.end) + ',Sub,,0,0,0,,' + (style === 'minimal' || cue.start < from ? '' : '{\\fad(60,60)}') + assText(wrap(cue.text)));
    }
  }
  return header.concat(events).join('\n') + '\n';
}

/** Palabras dentro de [from, to) desplazadas al inicio del tramo. */
function slice(words, from, to) {
  return (words || []).filter(w => w.end > from && w.start < to).map(w => ({ ...w, start: Math.max(0, w.start - from), end: Math.min(to - from, w.end - from) }));
}

module.exports = { cues, srt, ass, slice, srtTime, assTime, STYLES };
