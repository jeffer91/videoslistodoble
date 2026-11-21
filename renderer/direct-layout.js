'use strict';
/**
 * Videos largos directos · geometría compartida.
 * La usan la vista previa (canvas) y la exportación (FFmpeg) para que lo que
 * se ve al editar coincida con el MP4 final. También contiene el alineador de
 * texto del teleprompter por voz y las utilidades de la línea de tiempo.
 */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.DirectLayout = api;
})(function () {
  const W = 1920, H = 1080, FPS = 30;
  const NAMES = {
    A: 'Presentador protagonista', B: 'Presentador e imagen', C: 'Presentador pequeño',
    D: 'Imagen protagonista', E: 'Presentador sobre fondo deportivo'
  };
  const BACKGROUND_NAMES = {
    estadio: 'Estadio iluminado', tunel: 'Túnel de jugadores', cesped: 'Césped deportivo',
    luces: 'Luces cinematográficas', grafico: 'Gráficos deportivos modernos', movimiento: 'Fondo de fútbol en movimiento'
  };
  const even = n => Math.max(2, Math.round(n / 2) * 2);

  /** Distribución efectiva: sin imagen, las composiciones que la necesitan pasan a una equivalente. */
  function effective(segment, hasImage) {
    const layout = segment?.layout || 'A';
    if (hasImage) return layout;
    return layout === 'D' ? 'A' : (layout === 'B' || layout === 'C') ? 'E' : layout;
  }

  /** Cajas de la composición en un lienzo de 1920 × 1080. */
  function boxes(segment, hasImage) {
    const layout = effective(segment, hasImage);
    const scale = Math.min(1.25, Math.max(0.3, Number(segment?.scale) || 1));
    const dx = (Number(segment?.offsetX) || 0) * W, dy = (Number(segment?.offsetY) || 0) * H;
    const side = segment?.side === 'right' ? 'right' : 'left';
    const corner = ['tl', 'tr', 'bl', 'br'].includes(segment?.corner) ? segment.corner : 'br';
    const place = (x, y, size) => {
      const s = even(Math.min(H, size));
      return { x: even(Math.min(W - s, Math.max(0, x + dx))), y: even(Math.min(H - s, Math.max(0, y + dy))), size: s };
    };
    let presenter = null, image = null, lowerThird = false, radius = 30;
    if (layout === 'A') {
      const size = 900 * scale;
      presenter = place((W - size) / 2, (H - size) / 2, size);
    } else if (layout === 'B') {
      const size = 780 * scale, margin = 80, gap = 50;
      const p = place(side === 'left' ? margin : W - margin - size, (H - size) / 2, size);
      presenter = p;
      const left = side === 'left' ? p.x + p.size + gap : margin;
      const right = side === 'left' ? W - margin : p.x - gap;
      const top = 110, bottom = H - 110;
      image = { x: even(left), y: top, w: even(Math.max(200, right - left)), h: even(bottom - top), radius: 26 };
    } else if (layout === 'C') {
      const size = 380 * scale, margin = 56;
      const x = corner.endsWith('l') ? margin : W - margin - size;
      const y = corner.startsWith('t') ? margin : H - margin - size;
      presenter = place(x, y, size);
      image = { x: 0, y: 0, w: W, h: H, radius: 0 };
      radius = 22;
    } else if (layout === 'D') {
      image = { x: 0, y: 0, w: W, h: H, radius: 0 };
    } else {
      const size = 840 * scale;
      presenter = place(side === 'left' ? 150 : W - 150 - size, H - size - 40, size);
      lowerThird = true;
    }
    return { layout, presenter, image, lowerThird, radius, side };
  }

  /** Recorte «cover» de una imagen de w×h dentro de una caja. */
  function cover(srcW, srcH, boxW, boxH) {
    const ratio = Math.max(boxW / srcW, boxH / srcH);
    const w = srcW * ratio, h = srcH * ratio;
    return { w, h, x: (boxW - w) / 2, y: (boxH - h) / 2 };
  }

  /** Completa los huecos de la línea de tiempo con la distribución A. */
  function fill(layouts, duration) {
    const list = (layouts || []).filter(l => l.end > l.start).sort((a, b) => a.start - b.start);
    const out = [];
    let at = 0;
    for (const item of list) {
      const start = Math.max(at, item.start), end = Math.min(duration, item.end);
      if (start - at >= 1 / FPS) out.push({ layout: 'A', start: at, end: start, scale: 1, side: 'left', corner: 'br', filler: true });
      if (end - start >= 1 / FPS) out.push({ ...item, start, end });
      at = Math.max(at, end);
    }
    if (duration - at >= 1 / FPS) out.push({ layout: 'A', start: at, end: duration, scale: 1, side: 'left', corner: 'br', filler: true });
    return out;
  }

  /** Fotogramas exactos de cada tramo para que la suma coincida con el audio. */
  function frames(segments, duration) {
    const total = Math.round(duration * FPS);
    let used = 0;
    return segments.map((segment, index) => {
      const end = index === segments.length - 1 ? total : Math.round(segment.end * FPS);
      const count = Math.max(0, end - used);
      const result = { ...segment, startFrame: used, frames: count };
      used += count;
      return result;
    }).filter(s => s.frames > 0);
  }

  function at(layouts, time) {
    return (layouts || []).find(l => time >= l.start && time < l.end) || null;
  }

  // ── Alineador del teleprompter por voz ────────────────────────────────────
  function normalize(word) {
    return String(word || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '');
  }

  // ── Marcas del guion: [IMAGEN: …], [DATO: …], [MÚSICA: …], [PREGUNTA: …], [CTA: …] ─
  const MARK_TYPES = { imagen: 'imagen', foto: 'imagen', dato: 'dato', estadistica: 'dato', musica: 'musica', pregunta: 'pregunta', cta: 'cta', llamado: 'cta',
    composicion: 'composicion', plano: 'composicion', transicion: 'transicion' };
  const MARK = /\[\s*([A-Za-zÁÉÍÓÚáéíóúÑñ]+)\s*:\s*([^\]\n]{1,200})\]/g;
  const fold = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  /** Separa las marcas del texto narrable. `word` es el número de palabras narrables previas. */
  function marks(text) {
    const raw = String(text || '');
    const list = [];
    let clean = '', last = 0, match;
    MARK.lastIndex = 0;
    while ((match = MARK.exec(raw))) {
      const type = MARK_TYPES[fold(match[1])];
      if (!type) continue;
      clean += raw.slice(last, match.index);
      last = MARK.lastIndex;
      list.push({ type, value: match[2].trim(), word: countWords(clean) });
    }
    clean += raw.slice(last);
    return { clean: clean.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n'), marks: list };
  }
  function countWords(text) { return (String(text).match(/\S+/g) || []).filter(w => normalize(w)).length; }
  function stripMarks(text) { return marks(text).clean; }

  // ── Cortes no destructivos ─────────────────────────────────────────────────
  const q = value => Math.round(Math.max(0, Number(value) || 0) * FPS) / FPS;
  /** Tramos conservados de la toma (en segundos de la toma original, en la rejilla de 1/30 s). */
  function kept(cuts, duration) {
    const list = (cuts || []).filter(c => c.enabled !== false && c.end > c.start).map(c => ({ start: q(c.start), end: Math.min(q(c.end), q(duration)) }))
      .filter(c => c.end - c.start >= 1 / FPS).sort((a, b) => a.start - b.start);
    const out = [];
    let at = 0;
    for (const cut of list) {
      if (cut.start > at) out.push({ start: at, end: cut.start });
      at = Math.max(at, cut.end);
    }
    if (q(duration) > at) out.push({ start: at, end: q(duration) });
    return out.filter(r => r.end - r.start >= 1 / FPS);
  }
  function keptDuration(cuts, duration) { return kept(cuts, duration).reduce((n, r) => n + r.end - r.start, 0); }
  /** Tiempo de la toma → tiempo en el video (los cortes desaparecen). */
  function mapTime(ranges, t) {
    let out = 0;
    for (const r of ranges) {
      if (t < r.start) return out;
      if (t <= r.end) return out + t - r.start;
      out += r.end - r.start;
    }
    return out;
  }
  /** Si t cae en un corte, devuelve dónde continúa la reproducción. */
  function skip(ranges, t) {
    for (const r of ranges) { if (t < r.start) return r.start; if (t < r.end) return t; }
    return ranges.length ? ranges.at(-1).end : t;
  }
  /** Piezas de render: cada tramo de composición recortado por los tramos conservados. */
  function pieces(segments, ranges) {
    const out = [];
    for (const [index, segment] of segments.entries()) {
      for (const r of ranges) {
        const start = Math.max(q(segment.start), r.start), end = Math.min(q(segment.end), r.end);
        const frames = Math.round((end - start) * FPS);
        if (frames > 0) out.push({ ...segment, index, srcStart: start, srcEnd: start + frames / FPS, frames });
      }
    }
    return out;
  }

  /** Posición del llamado a la acción: del lado contrario al presentador, arriba, sin tapar subtítulos. */
  function ctaBox(segment, hasImage, type) {
    const box = boxes(segment, hasImage);
    const w = 470, h = type === 'comentar' ? 250 : 136;
    const presenterRight = box.presenter && box.presenter.x + box.presenter.size / 2 > W / 2;
    const right = box.presenter ? !presenterRight : false;
    return { x: right ? W - 44 - w : 44, y: 150, w, h, from: right ? W : -w };
  }

  function tokens(text) {
    const list = [];
    const re = /\S+/g;
    let match;
    text = stripMarks(text);
    while ((match = re.exec(String(text || '')))) {
      const norm = normalize(match[0]);
      if (norm) list.push({ word: norm, index: match.index, length: match[0].length });
    }
    return list;
  }

  function similar(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    if (a.length > 3 && b.length > 3 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) return 0.75;
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 3) return 0;
    let prev = Array.from({ length: n + 1 }, (_v, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return Math.max(0, 1 - prev[n] / Math.max(m, n));
  }

  /**
   * Busca dónde está leyendo el presentador. Recibe las palabras del guion,
   * lo último reconocido y la posición actual; devuelve el índice de la palabra
   * siguiente a la última leída o -1 si no hay coincidencia fiable.
   * Admite retrocesos (cuando el presentador repite una frase).
   */
  function align(scriptTokens, heard, current = 0, { back = 60, ahead = 120 } = {}) {
    const spoken = tokens(heard).map(t => t.word).slice(-10);
    if (spoken.length < 2) return -1;
    const from = Math.max(0, current - back), to = Math.min(scriptTokens.length, current + ahead);
    let best = -1, bestScore = 0;
    for (let end = from; end < to; end++) {
      let score = 0, matched = 0, j = end;
      for (let k = spoken.length - 1; k >= 0 && j >= 0; k--) {
        const s = similar(spoken[k], scriptTokens[j]?.word);
        if (s >= 0.7) { score += s * (spoken[k].length > 3 ? 1.4 : 0.7); matched++; j--; }
        else if (j > 0 && similar(spoken[k], scriptTokens[j - 1]?.word) >= 0.7) { score += 0.5; matched++; j -= 2; }
        else score -= 0.35;
      }
      const distance = Math.abs(end + 1 - current) / 80;
      const total = score - distance;
      if (matched >= Math.min(3, spoken.length) && total > bestScore) { bestScore = total; best = end + 1; }
    }
    return bestScore >= 2 ? best : -1;
  }

  function stamp(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(r).padStart(2, '0');
  }

  return { W, H, FPS, NAMES, BACKGROUND_NAMES, effective, boxes, cover, fill, frames, at, normalize, tokens, similar, align, stamp, marks, stripMarks, kept, keptDuration, mapTime, skip, pieces, ctaBox };
});
