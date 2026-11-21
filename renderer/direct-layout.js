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

  function tokens(text) {
    const list = [];
    const re = /\S+/g;
    let match;
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

  return { W, H, FPS, NAMES, BACKGROUND_NAMES, effective, boxes, cover, fill, frames, at, normalize, tokens, similar, align, stamp };
});
