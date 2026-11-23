'use strict';
/*
 * Núcleo de «Shorts web»: funciones puras sin acceso al navegador.
 * Se cargan en la página como `ShortsCore` y en Node con require() para las pruebas.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShortsCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SCENES = ['hook', 'body', 'closing'];
  const SCENE_LABELS = { hook: 'Gancho', body: 'Desarrollo', closing: 'Cierre' };
  const WIDTH = 1080;
  const HEIGHT = 1920;
  const FPS = 30;
  const SAMPLE_RATE = 48000;
  const STAMP_SECONDS = 1.6;
  const TARGET_LUFS = -14;
  const PEAK_CEILING_DB = -1;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const dbToGain = db => Math.pow(10, db / 20);
  const gainToDb = gain => 20 * Math.log10(Math.max(gain, 1e-12));

  /* ---------- Guion ---------- */

  const HEADINGS = [
    { key: 'hook', pattern: /^(?:#+\s*)?(?:\d+\s*[.)·-]\s*)?(?:gancho|hook|inicio|intro(?:ducci[oó]n)?)\s*(?:[:.\-–—]\s*|$)/i },
    { key: 'body', pattern: /^(?:#+\s*)?(?:\d+\s*[.)·-]\s*)?(?:desarrollo|cuerpo|body|historia|contenido)\s*(?:[:.\-–—]\s*|$)/i },
    { key: 'closing', pattern: /^(?:#+\s*)?(?:\d+\s*[.)·-]\s*)?(?:cierre|final|closing|conclusi[oó]n|despedida)\s*(?:[:.\-–—]\s*|$)/i }
  ];

  /** Divide un guion pegado en gancho, desarrollo y cierre. */
  function parseScript(text) {
    const result = { hook: '', body: '', closing: '' };
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    let current = null;
    let found = false;
    const buckets = { hook: [], body: [], closing: [] };
    for (const raw of lines) {
      const line = raw.replace(/^[\s*_>]+|[\s*_]+$/g, '');
      const heading = HEADINGS.find(h => h.pattern.test(line));
      if (heading) {
        found = true;
        current = heading.key;
        const rest = line.replace(heading.pattern, '').trim();
        if (rest) buckets[current].push(rest);
        continue;
      }
      if (current) buckets[current].push(raw.trim());
    }
    if (found) {
      for (const key of SCENES) result[key] = tidy(buckets[key].join('\n'));
      return result;
    }
    const paragraphs = String(text || '').split(/\n\s*\n/).map(tidy).filter(Boolean);
    if (paragraphs.length >= 3) {
      result.hook = paragraphs[0];
      result.closing = paragraphs[paragraphs.length - 1];
      result.body = paragraphs.slice(1, -1).join('\n\n');
    } else if (paragraphs.length === 2) {
      result.hook = paragraphs[0];
      result.body = paragraphs[1];
    } else {
      result.body = paragraphs[0] || '';
    }
    return result;
  }
  function tidy(text) {
    return String(text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------- Audio ---------- */

  /** Mezcla varios canales Float32Array en uno. */
  function mixToMono(channels) {
    if (!channels.length) return new Float32Array(0);
    if (channels.length === 1) return Float32Array.from(channels[0]);
    const out = new Float32Array(channels[0].length);
    for (const channel of channels) for (let i = 0; i < out.length; i++) out[i] += channel[i] / channels.length;
    return out;
  }

  /** Nivel RMS en dBFS por ventanas consecutivas. */
  function envelope(samples, sampleRate, windowSeconds = 0.02) {
    const size = Math.max(1, Math.round(sampleRate * windowSeconds));
    const count = Math.ceil(samples.length / size);
    const out = new Float32Array(count);
    for (let w = 0; w < count; w++) {
      let sum = 0;
      const start = w * size;
      const end = Math.min(samples.length, start + size);
      for (let i = start; i < end; i++) sum += samples[i] * samples[i];
      out[w] = gainToDb(Math.sqrt(sum / Math.max(1, end - start)));
    }
    return { levels: out, window: size / sampleRate };
  }

  function percentile(values, p) {
    const sorted = Array.from(values).sort((a, b) => a - b);
    if (!sorted.length) return -120;
    return sorted[clamp(Math.floor(p * (sorted.length - 1)), 0, sorted.length - 1)];
  }

  /**
   * Detecta los tramos con voz y devuelve los que se conservan.
   * Se eliminan los silencios largos del principio, del final y entre frases.
   */
  function detectSpeech(samples, sampleRate, options = {}) {
    const minSilence = options.minSilence ?? 0.45;
    const pad = options.pad ?? 0.12;
    const minSpeech = options.minSpeech ?? 0.1;
    const duration = samples.length / sampleRate;
    if (!duration) return { ranges: [], threshold: 0, floor: 0, speech: false };
    const { levels, window } = envelope(samples, sampleRate, 0.02);
    const floor = percentile(levels, 0.15);
    const peak = percentile(levels, 0.98);
    const threshold = clamp(Math.max(floor + 12, peak - 32), -58, -24);
    if (peak < -60 || peak - floor < 6) {
      return { ranges: [{ start: 0, end: duration }], threshold, floor, speech: false };
    }
    const voiced = [];
    let open = null;
    for (let i = 0; i < levels.length; i++) {
      const on = levels[i] >= threshold;
      if (on && open === null) open = i;
      if (!on && open !== null) { voiced.push([open * window, i * window]); open = null; }
    }
    if (open !== null) voiced.push([open * window, levels.length * window]);
    const merged = [];
    for (const [start, end] of voiced) {
      const last = merged[merged.length - 1];
      if (last && start - last[1] < minSilence) last[1] = end;
      else merged.push([start, end]);
    }
    const ranges = [];
    for (const [start, end] of merged) {
      if (end - start < minSpeech) continue;
      const range = { start: Math.max(0, start - pad), end: Math.min(duration, end + pad) };
      const last = ranges[ranges.length - 1];
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
      else ranges.push(range);
    }
    if (!ranges.length) return { ranges: [{ start: 0, end: duration }], threshold, floor, speech: false };
    return { ranges: ranges.map(r => ({ start: round3(r.start), end: round3(r.end) })), threshold, floor, speech: true };
  }
  const round3 = n => Math.round(n * 1000) / 1000;

  const totalLength = ranges => ranges.reduce((sum, r) => sum + Math.max(0, r.end - r.start), 0);

  /**
   * Une los tramos conservados de cada escena en una sola pista,
   * con fundidos cortos en cada corte para evitar chasquidos.
   */
  function joinRanges(parts, sampleRate, fadeSeconds = 0.012) {
    const pieces = [];
    for (const part of parts) {
      for (const range of part.ranges) {
        const start = clamp(Math.round(range.start * sampleRate), 0, part.samples.length);
        const end = clamp(Math.round(range.end * sampleRate), start, part.samples.length);
        pieces.push({ samples: part.samples, start, end });
      }
    }
    const length = pieces.reduce((n, p) => n + p.end - p.start, 0);
    const out = new Float32Array(length);
    const fade = Math.max(1, Math.round(fadeSeconds * sampleRate));
    let offset = 0;
    for (const piece of pieces) {
      const size = piece.end - piece.start;
      out.set(piece.samples.subarray(piece.start, piece.end), offset);
      const ramp = Math.min(fade, Math.floor(size / 2));
      for (let i = 0; i < ramp; i++) {
        const g = i / ramp;
        out[offset + i] *= g;
        out[offset + size - 1 - i] *= g;
      }
      offset += size;
    }
    return out;
  }

  function biquad(samples, b0, b1, b2, a0, a1, a2) {
    const out = new Float32Array(samples.length);
    const nb0 = b0 / a0, nb1 = b1 / a0, nb2 = b2 / a0, na1 = a1 / a0, na2 = a2 / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const y = nb0 * x + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
      out[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y;
    }
    return out;
  }

  /** Filtro de ponderación K de ITU-R BS.1770 para cualquier frecuencia de muestreo. */
  function kWeight(samples, sampleRate) {
    let w0 = 2 * Math.PI * 1500 / sampleRate;
    const A = Math.pow(10, 4 / 40);
    let alpha = Math.sin(w0) / (2 / Math.SQRT2);
    const cos = Math.cos(w0), sq = 2 * Math.sqrt(A) * alpha;
    const shelf = biquad(samples,
      A * ((A + 1) + (A - 1) * cos + sq), -2 * A * ((A - 1) + (A + 1) * cos), A * ((A + 1) + (A - 1) * cos - sq),
      (A + 1) - (A - 1) * cos + sq, 2 * ((A - 1) - (A + 1) * cos), (A + 1) - (A - 1) * cos - sq);
    w0 = 2 * Math.PI * 38 / sampleRate;
    alpha = Math.sin(w0) / (2 * 0.5);
    const c = Math.cos(w0);
    return biquad(shelf, (1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha);
  }

  /**
   * Sonoridad integrada (LUFS) de una señal mono que se reproducirá igual en los dos canales.
   * Devuelve -Infinity si todo es silencio.
   */
  function loudness(samples, sampleRate, stereo = true) {
    const weighted = kWeight(samples, sampleRate);
    const block = Math.round(0.4 * sampleRate);
    const step = Math.round(0.1 * sampleRate);
    const powers = [];
    if (weighted.length < block) {
      let sum = 0;
      for (const v of weighted) sum += v * v;
      if (weighted.length) powers.push(sum / weighted.length);
    } else {
      for (let start = 0; start + block <= weighted.length; start += step) {
        let sum = 0;
        for (let i = start; i < start + block; i++) sum += weighted[i] * weighted[i];
        powers.push(sum / block);
      }
    }
    const channels = stereo ? 2 : 1;
    const lufs = z => -0.691 + 10 * Math.log10(channels * z);
    const absolute = powers.filter(z => z > 0 && lufs(z) > -70);
    if (!absolute.length) return -Infinity;
    const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
    const relative = lufs(mean(absolute)) - 10;
    const gated = absolute.filter(z => lufs(z) > relative);
    return lufs(mean(gated.length ? gated : absolute));
  }

  function peak(samples) {
    let max = 0;
    for (const v of samples) { const a = Math.abs(v); if (a > max) max = a; }
    return max;
  }

  /** Limitador con anticipación: ningún pico supera el techo. */
  function limit(samples, sampleRate, ceilingDb = PEAK_CEILING_DB, lookaheadMs = 5, releaseMs = 80) {
    const ceiling = dbToGain(ceilingDb);
    const look = Math.max(1, Math.round(sampleRate * lookaheadMs / 1000));
    const needed = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      needed[i] = a > ceiling ? ceiling / a : 1;
    }
    // Mínimo deslizante hacia delante (cola monótona).
    const ahead = new Float32Array(samples.length);
    const queue = new Int32Array(samples.length + 1);
    let head = 0, tail = 0;
    for (let i = samples.length - 1; i >= 0; i--) {
      while (tail > head && needed[queue[tail - 1]] >= needed[i]) tail--;
      queue[tail++] = i;
      while (queue[head] > i + look) head++;
      ahead[i] = needed[queue[head]];
    }
    const release = Math.exp(-1 / (sampleRate * releaseMs / 1000));
    const out = new Float32Array(samples.length);
    let gain = 1;
    for (let i = 0; i < samples.length; i++) {
      const target = ahead[i];
      gain = target < gain ? target : target - (target - gain) * release;
      const v = samples[i] * gain;
      out[i] = v > ceiling ? ceiling : v < -ceiling ? -ceiling : v;
    }
    return out;
  }

  /** Lleva la voz a -14 LUFS con un techo de -1 dBFS. */
  function normalizeVoice(samples, sampleRate, target = TARGET_LUFS, maxBoostDb = 24) {
    const before = loudness(samples, sampleRate);
    if (!Number.isFinite(before)) return { samples: Float32Array.from(samples), before, after: before, gainDb: 0 };
    const gainDb = clamp(target - before, -30, maxBoostDb);
    const g = dbToGain(gainDb);
    const boosted = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) boosted[i] = samples[i] * g;
    const limited = limit(boosted, sampleRate);
    return { samples: limited, before, after: loudness(limited, sampleRate), gainDb };
  }

  /** Mezcla un efecto (mono) dentro de la pista a partir de un segundo dado. */
  function mixAt(base, effect, sampleRate, atSeconds, gainDb = 0) {
    const out = Float32Array.from(base);
    const start = Math.round(atSeconds * sampleRate);
    const g = dbToGain(gainDb);
    for (let i = 0; i < effect.length && start + i < out.length; i++) {
      if (start + i >= 0) out[start + i] = clamp(out[start + i] + effect[i] * g, -1, 1);
    }
    return out;
  }

  /* ---------- Línea de tiempo ---------- */

  /**
   * Construye la línea de tiempo del Short.
   * scenes: [{ key, ranges:[{start,end}] }] en orden de aparición.
   */
  function buildTimeline(scenes, options = {}) {
    const tail = options.stamp === false ? 0 : (options.stampSeconds ?? STAMP_SECONDS);
    const segments = [];
    let cursor = 0;
    for (const scene of scenes) {
      scene.ranges.forEach((range, index) => {
        const length = Math.max(0, range.end - range.start);
        if (length <= 0) return;
        segments.push({ scene: scene.key, index, first: index === 0, outStart: cursor, outEnd: cursor + length, srcStart: range.start, srcEnd: range.end });
        cursor += length;
      });
    }
    const content = cursor;
    return { segments, content, tail, duration: content + tail };
  }

  /** Qué escena y qué instante del original corresponden al segundo t del Short. */
  function locate(timeline, t) {
    const { segments } = timeline;
    if (!segments.length) return null;
    if (t >= timeline.content) {
      const last = segments[segments.length - 1];
      return { segment: last, segmentIndex: segments.length - 1, srcTime: Math.max(last.srcStart, last.srcEnd - 1 / FPS), local: last.outEnd - last.outStart, stamp: t - timeline.content };
    }
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid].outStart <= t) lo = mid; else hi = mid - 1;
    }
    const segment = segments[lo];
    const local = t - segment.outStart;
    return { segment, segmentIndex: lo, srcTime: segment.srcStart + local, local, stamp: null };
  }

  /* ---------- Composición ---------- */

  /** Recorte tipo «cover» de una fuente sw×sh dentro de dw×dh. */
  function coverCrop(sw, sh, dw, dh, focusY = 0.42) {
    const scale = Math.max(dw / sw, dh / sh);
    const w = dw / scale, h = dh / scale;
    return { sx: (sw - w) / 2, sy: clamp((sh - h) * focusY, 0, sh - h), sw: w, sh: h };
  }

  /** Rectángulo del presentador para cada escena (Short 1080×1920). */
  function presenterRect(sceneKey) {
    if (sceneKey === 'closing') {
      const w = 930, h = 1300;
      return { x: (WIDTH - w) / 2, y: HEIGHT - h - Math.round(HEIGHT * 0.12), w, h };
    }
    const w = 930, h = 1160;
    return { x: (WIDTH - w) / 2, y: (HEIGHT - h) / 2 + 60, w, h };
  }

  /** Recorrido del logo por los bordes en ciclos de 24 s, igual que el Studio de Windows. */
  function logoPosition(t, W, H, w, h) {
    const m = ((t % 24) + 24) % 24;
    if (m < 6) return { x: (W - w) * m / 6, y: 0 };
    if (m < 12) return { x: W - w, y: (H - h) * (m - 6) / 6 };
    if (m < 18) return { x: (W - w) * (1 - (m - 12) / 6), y: H - h };
    return { x: 0, y: (H - h) * (1 - (m - 18) / 6) };
  }

  /** Acercamiento suave alterno en cada salto para disimular los cortes. */
  function punchZoom(segment) {
    if (!segment || segment.first) return 1;
    return segment.index % 2 ? 1.07 : 1.0;
  }

  /** Destello de entrada al empezar cada escena (0..1). */
  function flash(segment, local) {
    if (!segment || !segment.first) return 0;
    return 0.35 * Math.exp(-local * 14);
  }

  /** Caída del sello: desplazamiento vertical relativo (0 = en su sitio). */
  function stampDrop(elapsed) {
    const fall = 0.22;
    if (elapsed < fall) { const p = elapsed / fall; return -(1 - p * p); }
    const bounce = elapsed - fall;
    return 0.025 * Math.sin(Math.min(1, bounce / 0.18) * Math.PI) * Math.exp(-bounce * 6);
  }

  /** Reparte un texto en líneas que caben en maxWidth, con «…» si sobra. */
  function wrapLines(text, maxWidth, measure, maxLines = 2) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (let i = 0; i < words.length; i++) {
      const next = line ? line + ' ' + words[i] : words[i];
      if (measure(next) <= maxWidth || !line) { line = next; continue; }
      lines.push(line);
      line = words[i];
      if (lines.length === maxLines) { line = words.slice(i).join(' '); break; }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) lines.length = maxLines;
    const lastIndex = lines.length - 1;
    if (lastIndex >= 0 && (measure(lines[lastIndex]) > maxWidth || words.join(' ').length > lines.join(' ').length)) {
      let last = lines[lastIndex];
      while (last.length > 1 && measure(last + '…') > maxWidth) last = last.slice(0, -1).trimEnd();
      lines[lastIndex] = last + '…';
    }
    return lines;
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function fileName(title, extension) {
    const base = String(title || 'short').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'short';
    return base + '.' + extension;
  }

  return {
    SCENES, SCENE_LABELS, WIDTH, HEIGHT, FPS, SAMPLE_RATE, STAMP_SECONDS, TARGET_LUFS, PEAK_CEILING_DB,
    clamp, dbToGain, gainToDb, parseScript, mixToMono, envelope, detectSpeech, totalLength, joinRanges,
    kWeight, loudness, peak, limit, normalizeVoice, mixAt, buildTimeline, locate, coverCrop, presenterRect,
    logoPosition, punchZoom, flash, stampDrop, wrapLines, formatTime, fileName
  };
});
