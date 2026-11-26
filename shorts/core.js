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

  /* ---------- Subtítulos ---------- */

  /** Forma comparable de una palabra: minúsculas, sin tildes ni signos. */
  function normalizeWord(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '');
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = row;
    }
    return prev[b.length];
  }

  /** Parecido entre dos palabras normalizadas (0..1). */
  function similarity(a, b) {
    if (!a && !b) return 1;
    return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  }

  /** Divide un texto en palabras (conservando la puntuación pegada a cada una). */
  function scriptTokens(text) {
    return String(text || '').replace(/[\r\n]+/g, ' ').split(/\s+/)
      .map(t => t.replace(/^[*_#>"“”«»]+|[*_"“”«»]+$/g, '')).filter(t => normalizeWord(t));
  }

  /**
   * Corrige la ortografía de la transcripción con el guion, conservando los tiempos de Whisper.
   * Permite que Whisper parta una palabra en dos o junte dos en una, y deja intactas
   * las frases improvisadas que no están en el guion.
   */
  function alignToScript(words, script) {
    const tokens = scriptTokens(script);
    const spoken = words.filter(w => normalizeWord(w.text));
    if (!tokens.length || !spoken.length) return { words: spoken.map(w => ({ ...w })), corrected: 0, quality: 0 };
    const a = spoken.map(w => normalizeWord(w.text));
    const b = tokens.map(normalizeWord);
    const n = a.length, m = b.length;
    const INS = 1, DEL = 0.6;
    const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
    const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
    cost[0][0] = 0;
    const subCost = s => s >= 0.999 ? 0 : s >= 0.5 ? 1 - s : 1.6;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= m; j++) {
        const base = cost[i][j];
        if (base === Infinity) continue;
        const relax = (ni, nj, value, kind) => {
          if (ni <= n && nj <= m && base + value < cost[ni][nj]) { cost[ni][nj] = base + value; move[ni][nj] = kind; }
        };
        if (i < n && j < m) relax(i + 1, j + 1, subCost(similarity(a[i], b[j])), 1);
        if (i < n) relax(i + 1, j, INS, 2);
        if (j < m) relax(i, j + 1, DEL, 3);
        if (i + 1 < n && j < m) relax(i + 2, j + 1, subCost(similarity(a[i] + a[i + 1], b[j])) + 0.1, 4);
        if (i < n && j + 1 < m) relax(i + 1, j + 2, subCost(similarity(a[i], b[j] + b[j + 1])) + 0.1, 5);
      }
    }
    const steps = [];
    for (let i = n, j = m; i > 0 || j > 0;) {
      const kind = move[i][j];
      steps.push({ kind, i, j });
      if (kind === 1) { i--; j--; } else if (kind === 2) i--; else if (kind === 3) j--; else if (kind === 4) { i -= 2; j--; } else { i--; j -= 2; }
    }
    steps.reverse();
    const out = [];
    let corrected = 0, strong = 0;
    for (const { kind, i, j } of steps) {
      if (kind === 1) {
        const w = spoken[i - 1], s = similarity(a[i - 1], b[j - 1]);
        if (s >= 0.8) strong++;
        const useScript = s >= 0.5;
        if (useScript && tokens[j - 1] !== w.text.trim()) corrected++;
        out.push({ text: useScript ? tokens[j - 1] : w.text.trim(), start: w.start, end: w.end });
      } else if (kind === 2) {
        const w = spoken[i - 1];
        out.push({ text: w.text.trim(), start: w.start, end: w.end });
      } else if (kind === 4) {
        const w1 = spoken[i - 2], w2 = spoken[i - 1];
        const s = similarity(a[i - 2] + a[i - 1], b[j - 1]);
        if (s >= 0.6) { strong += 2; corrected++; out.push({ text: tokens[j - 1], start: w1.start, end: w2.end }); }
        else out.push({ text: w1.text.trim(), start: w1.start, end: w1.end }, { text: w2.text.trim(), start: w2.start, end: w2.end });
      } else if (kind === 5) {
        const w = spoken[i - 1];
        const s = similarity(a[i - 1], b[j - 2] + b[j - 1]);
        if (s >= 0.6) {
          strong++; corrected++;
          const l1 = b[j - 2].length, l2 = b[j - 1].length;
          const mid = w.start + (w.end - w.start) * l1 / (l1 + l2);
          out.push({ text: tokens[j - 2], start: w.start, end: mid }, { text: tokens[j - 1], start: mid, end: w.end });
        } else out.push({ text: w.text.trim(), start: w.start, end: w.end });
      }
    }
    const quality = strong / spoken.length;
    if (quality < 0.35) return { words: spoken.map(w => ({ text: w.text.trim(), start: w.start, end: w.end })), corrected: 0, quality };
    return { words: out, corrected, quality };
  }

  /** Convierte tramos con tiempo (sin tiempos por palabra) en palabras repartidas por longitud. */
  function wordsFromChunks(chunks) {
    const out = [];
    for (const chunk of chunks || []) {
      const [start, end] = chunk.timestamp || [];
      const parts = String(chunk.text || '').trim().split(/\s+/).filter(Boolean);
      if (!parts.length || !Number.isFinite(start)) continue;
      const stop = Number.isFinite(end) && end > start ? end : start + parts.length * 0.35;
      const total = parts.reduce((n, p) => n + p.length + 1, 0);
      let cursor = start;
      for (const part of parts) {
        const span = (stop - start) * (part.length + 1) / total;
        out.push({ text: part, start: cursor, end: cursor + span });
        cursor += span;
      }
    }
    return out;
  }

  const HALLUCINATIONS = [/amara\.org/i, /subt[ií]tulos (realizados|por la comunidad)/i, /gracias por ver(\s+el\s+video)?[.!]*$/i, /suscr[ií]bete al canal/i];
  /** Quita frases que Whisper inventa a veces y que no están en el guion. */
  function dropHallucinations(words, script = '') {
    const text = words.map(w => w.text).join(' ');
    const pattern = HALLUCINATIONS.find(p => p.test(text) && !p.test(script));
    if (!pattern) return words;
    const sentences = [];
    let current = [];
    for (const w of words) { current.push(w); if (/[.!?]$/.test(w.text)) { sentences.push(current); current = []; } }
    if (current.length) sentences.push(current);
    return sentences.filter(s => !HALLUCINATIONS.some(p => p.test(s.map(w => w.text).join(' ')) && !p.test(script))).flat();
  }

  /**
   * Agrupa las palabras en «páginas» cortas de subtítulos.
   * Corta tras signos de puntuación, en pausas y al llegar al máximo de palabras o letras.
   */
  function captionPages(words, options = {}) {
    const maxWords = options.maxWords ?? 4;
    const maxChars = options.maxChars ?? 22;
    const gap = options.gap ?? 0.4;
    const hold = options.hold ?? 0.5;
    const pages = [];
    let group = [];
    const flush = () => { if (group.length) pages.push({ words: group }); group = []; };
    for (const word of words) {
      const text = String(word.text || '').trim();
      if (!text) continue;
      const last = group[group.length - 1];
      const chars = group.reduce((n, w) => n + w.text.length + 1, text.length);
      if (last && (group.length >= maxWords || chars > maxChars || word.start - last.end > gap || /[.!?;:,]$/.test(last.text))) flush();
      group.push({ text, start: word.start, end: Math.max(word.end, word.start + 0.05), ...(word.key ? { key: true } : {}) });
    }
    flush();
    pages.forEach((page, i) => {
      page.start = page.words[0].start;
      const lastEnd = page.words[page.words.length - 1].end;
      const next = pages[i + 1];
      page.end = next ? Math.max(lastEnd, Math.min(next.words[0].start, lastEnd + hold)) : lastEnd + hold;
    });
    return pages;
  }

  /** Subtítulo visible en el instante t: página, palabra activa y tiempo desde que apareció. */
  function captionAt(pages, t) {
    if (!pages?.length) return null;
    let lo = 0, hi = pages.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pages[mid].start <= t) lo = mid; else hi = mid - 1; }
    const page = pages[lo];
    if (t < page.start || t >= page.end) return null;
    let active = -1;
    page.words.forEach((w, i) => { if (t >= w.start) active = i; });
    return { page, active, age: t - page.start };
  }

  /** Cambia el texto de una página repartiendo su tiempo entre las palabras nuevas. */
  function retimePage(page, text) {
    const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return [];
    const start = page.words[0].start;
    const end = page.words[page.words.length - 1].end;
    if (parts.length === page.words.length) return parts.map((p, i) => ({ ...page.words[i], text: p }));
    const total = parts.reduce((n, p) => n + p.length + 1, 0);
    let cursor = start;
    return parts.map(p => {
      const span = (end - start) * (p.length + 1) / total;
      const word = { text: p, start: cursor, end: cursor + span };
      cursor += span;
      return word;
    });
  }

  /**
   * Trozos de como mucho maxSeconds para Whisper, cortando en el punto más silencioso
   * a partir de minSeconds. Devuelve [{start,end}] en segundos.
   */
  function splitForTranscription(samples, sampleRate, maxSeconds = 25, minSeconds = 12) {
    const duration = samples.length / sampleRate;
    if (duration <= maxSeconds) return duration > 0 ? [{ start: 0, end: duration }] : [];
    const { levels, window } = envelope(samples, sampleRate, 0.02);
    const parts = [];
    let start = 0;
    while (duration - start > maxSeconds) {
      const from = Math.ceil((start + minSeconds) / window), to = Math.floor((start + maxSeconds) / window);
      let best = to, quietest = Infinity;
      for (let i = from; i <= to && i < levels.length; i++) if (levels[i] < quietest) { quietest = levels[i]; best = i; }
      const cut = best * window;
      parts.push({ start, end: cut });
      start = cut;
    }
    parts.push({ start, end: duration });
    return parts;
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
    logoPosition, punchZoom, flash, stampDrop, wrapLines, formatTime, fileName,
    normalizeWord, similarity, scriptTokens, alignToScript, wordsFromChunks, dropHallucinations, captionPages, captionAt, retimePage, splitForTranscription
  };
});
