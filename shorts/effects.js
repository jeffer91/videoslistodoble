'use strict';
/*
 * Efectos de «Shorts web»: marcas del guion, tiempos, zoom de énfasis, palabras clave y sonidos.
 * Funciones puras (sin navegador): se cargan como `ShortsEffects` y en Node con require().
 *
 * Marcas (van dentro del texto de cada escena; el teleprompter no las muestra):
 *   [IMAGEN: Estadio Azteca]            pantalla dividida con esa foto arriba
 *   [TITULAR: Lo que nadie vio]         titular en caja blanca (sustituye al título)
 *   [ZOOM]                              acercamiento fuerte en ese momento
 *   [REC]                               visor de cámara «REC» con esquinas
 *   [PASO: Gancho visual]               insignia numerada «① Gancho visual»
 *   [TEXTO: ¿Viste este | movimiento?]  texto con dos pesos (fino | grueso)
 *   [DATO: 44 goles]                    contador animado de la cifra
 *   [JUGADOR: Kane | Bayern | Inglaterra | 32 años]  ficha de jugador
 *   [VS: Kane 44 goles | Haaland 38 goles]           comparación
 *   [MARCADOR: México 2-1 Brasil | Final 2005]       marcador
 *   [FLECHA: este es él]                flecha y círculo señalando
 *   [TEMBLOR]                           sacudida de cámara
 *   [MAPA: México]                      mapa que se acerca al país
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShortsEffects = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SCENES = ['hook', 'body', 'closing'];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const TYPES = {
    imagen: 'imagen', foto: 'imagen', image: 'imagen', titular: 'titular', titulo: 'titular', zoom: 'zoom', rec: 'rec',
    paso: 'paso', texto: 'texto', dato: 'dato', cifra: 'dato', jugador: 'jugador', ficha: 'jugador', vs: 'vs',
    marcador: 'marcador', resultado: 'marcador', flecha: 'flecha', temblor: 'temblor', mapa: 'mapa', pais: 'mapa'
  };
  /** Tipos que ocupan la mitad superior (pantalla dividida); son excluyentes entre sí. */
  const PANEL = new Set(['imagen', 'dato', 'jugador', 'vs', 'marcador', 'mapa']);
  const DURATION = { imagen: 3.2, dato: 2.8, jugador: 3.4, vs: 3.8, marcador: 3.2, mapa: 3.4, texto: 2.4, flecha: 2.2, temblor: 0.4, zoom: 1.8 };

  const DEFAULTS = {
    effects: true, captionStyle: 'limpio', titleStyle: 'caja', zoom: true, sfx: true, progress: true, grade: true, loop: false, recHook: false
  };
  const settings = options => ({ ...DEFAULTS, ...(options || {}) });

  const MARK = /\[\s*([A-Za-zÁÉÍÓÚÑáéíóúñ]+)\s*(?::\s*([^\]]*))?\]/g;
  const countWords = text => String(text || '').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;

  /** Separa las marcas del texto narrable. word = palabras narrables antes de la marca. */
  function parseMarks(text) {
    const source = String(text || '');
    const marks = [];
    let clean = '', last = 0, m;
    MARK.lastIndex = 0;
    while ((m = MARK.exec(source))) {
      const type = TYPES[fold(m[1])];
      if (!type) continue;
      clean += source.slice(last, m.index);
      last = m.index + m[0].length;
      marks.push({ type, value: String(m[2] || '').trim(), word: countWords(clean) });
    }
    clean += source.slice(last);
    clean = clean.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:!?])/g, '$1').replace(/^[ \t]+|[ \t]+$/gm, '').trim();
    return { clean, marks, words: countWords(clean) };
  }

  const stripMarks = text => parseMarks(text).clean;

  /** Partes de un texto separado por «|». */
  const parts = value => String(value || '').split('|').map(s => s.trim()).filter(Boolean);

  /** «Kane 44 goles» → { name: 'Kane', stat: '44 goles' }. */
  function splitStat(text) {
    const s = String(text || '').trim();
    const m = /^(.*?)\s+([+\-]?\d[\d.,]*.*)$/.exec(s);
    return m ? { name: m[1].trim(), stat: m[2].trim() } : { name: s, stat: '' };
  }

  /** «44 goles» → { prefix:'', number:44, decimals:0, suffix:' goles' } para el contador. */
  function parseNumber(text) {
    const s = String(text || '').trim();
    const m = /^(.*?)(\d{1,3}(?:[.,\s]\d{3})+|\d+(?:[.,]\d+)?)(.*)$/.exec(s);
    if (!m) return { prefix: '', number: null, decimals: 0, suffix: s, text: s };
    let raw = m[2];
    let decimals = 0;
    if (/^\d{1,3}(?:[.,\s]\d{3})+$/.test(raw)) raw = raw.replace(/[.,\s]/g, '');
    else if (/[.,]/.test(raw)) { decimals = raw.split(/[.,]/)[1].length; raw = raw.replace(',', '.'); }
    return { prefix: m[1], number: Number(raw), decimals, suffix: m[3], separator: /,\d+$/.test(m[2]) ? ',' : '.', text: s };
  }

  /** Cifra formateada al estilo español: 1.234 y 3,5. */
  function formatNumber(value, decimals = 0, separator = ',') {
    const fixed = Number(value).toFixed(decimals);
    const [int, dec] = fixed.split('.');
    const grouped = int.length > 4 ? int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : int;
    return dec ? grouped + (separator === '.' ? '.' : ',') + dec : grouped;
  }

  /** «México 2-1 Brasil | Final 2005». */
  function parseScore(value) {
    const [main, note = ''] = parts(value);
    const m = /^(.*?)\s+(\d+)\s*[-–:]\s*(\d+)\s+(.*)$/.exec(main || '');
    if (!m) return { home: main || '', away: '', homeScore: '', awayScore: '', note };
    return { home: m[1].trim(), homeScore: m[2], awayScore: m[3], away: m[4].trim(), note };
  }

  /** Búsquedas de foto que necesitan las marcas (sin repetir). */
  function photoQueries(script) {
    const out = [];
    const add = q => { const v = String(q || '').trim(); if (v && !out.some(x => fold(x) === fold(v))) out.push(v); };
    for (const key of SCENES) {
      for (const mark of parseMarks(script?.[key]).marks) {
        if (mark.type === 'imagen') add(mark.value);
        if (mark.type === 'jugador') add(parts(mark.value)[0]);
        if (mark.type === 'vs') parts(mark.value).slice(0, 2).forEach(side => add(splitStat(side).name));
      }
    }
    return out;
  }

  const photoKey = query => fold(query).replace(/[^a-z0-9ñ]+/g, ' ').trim();

  /** Titular del guion ([TITULAR: …]) o el título del proyecto. */
  function headline(project) {
    for (const key of SCENES) {
      const mark = parseMarks(project?.script?.[key]).marks.find(m => m.type === 'titular' && m.value);
      if (mark) return mark.value;
    }
    return project?.title || '';
  }

  /**
   * Convierte las marcas en eventos con tiempo del Short.
   * words: palabras de los subtítulos (tiempo del Short) o null; sin ellas se reparte por proporción.
   */
  function schedule(project, timeline, words) {
    const opts = settings(project?.options);
    const events = [];
    if (!timeline?.segments?.length) return { events, steps: 0 };
    for (const key of SCENES) {
      const segs = timeline.segments.filter(s => s.scene === key);
      if (!segs.length) continue;
      const start = segs[0].outStart, end = segs[segs.length - 1].outEnd;
      const parsed = parseMarks(project?.script?.[key]);
      const spoken = (words || []).filter(w => w.start >= start - 0.05 && w.start < end);
      const at = word => {
        if (spoken.length && parsed.words) {
          if (word >= parsed.words) return Math.max(start, spoken[spoken.length - 1].end - 0.1);
          const i = clamp(Math.round(word * spoken.length / parsed.words), 0, spoken.length - 1);
          return spoken[i].start;
        }
        return start + (end - start) * (parsed.words ? clamp(word / parsed.words, 0, 1) : 0);
      };
      if (key === 'hook' && opts.recHook) events.push({ type: 'rec', value: '', start, end, scene: key });
      for (const mark of parsed.marks) {
        if (mark.type === 'titular') continue;
        const t = clamp(at(mark.word), start, Math.max(start, end - 0.25));
        const span = mark.type === 'rec' ? end - t : (DURATION[mark.type] || 2.5);
        // Cada efecto termina como tarde al final de su escena (los pasos siguen hasta el siguiente paso).
        events.push({ type: mark.type, value: mark.value, start: t, end: Math.min(t + span, mark.type === 'paso' ? timeline.content : end), scene: key });
      }
    }
    events.sort((a, b) => a.start - b.start);
    // Paneles excluyentes: el siguiente acorta al anterior. Pasos: hasta el siguiente paso o el final.
    let panel = null, step = null, number = 0;
    for (const e of events) {
      if (PANEL.has(e.type)) { if (panel && panel.end > e.start) panel.end = e.start; panel = e; }
      if (e.type === 'paso') { e.number = ++number; if (step) step.end = e.start; e.end = timeline.content; step = e; }
      if (e.type === 'rec' && step && step.end > e.start) step.end = e.start;
      if (e.type === 'paso') for (const r of events) if (r.type === 'rec' && r.start < e.start && r.end > e.start) r.end = e.start;
    }
    // La flecha señala el panel activo si lo hay.
    for (const e of events) if (e.type === 'flecha') e.onPanel = events.some(p => PANEL.has(p.type) && p.start <= e.start + 0.01 && p.end > e.start);
    return { events: events.filter(e => e.end - e.start > 0.05), steps: number };
  }

  /** Eventos activos en t. */
  const activeAt = (events, t) => events.filter(e => t >= e.start && t < e.end);

  /**
   * Zooms de énfasis: uno cada 4,5–6 s en un comienzo de palabra (más los de [ZOOM]),
   * nunca en el primer segundo ni mientras hay un panel en pantalla.
   */
  function emphasisZooms(timeline, words, events = [], enabled = true) {
    const zooms = events.filter(e => e.type === 'zoom').map(e => ({ start: e.start, end: e.end, strength: 1.3, forced: true }));
    if (!enabled || !timeline?.content) return zooms;
    const panelBusy = t => events.some(e => PANEL.has(e.type) && t >= e.start - 0.2 && t < e.end + 0.2);
    let t = 1.4, n = 0;
    while (t < timeline.content - 1.6) {
      const target = t;
      const word = (words || []).find(w => w.start >= target && w.start < target + 1.2);
      const start = word ? word.start : target;
      if (!panelBusy(start) && !zooms.some(z => Math.abs(z.start - start) < 2.5)) zooms.push({ start, end: start + 1.7, strength: n % 2 ? 1.18 : 1.24 });
      n++;
      t = start + 4.5 + ((n * 7919) % 15) / 10;
    }
    return zooms.sort((a, b) => a.start - b.start);
  }

  /** Factor de zoom en t (1 = sin zoom): entrada 0,22 s, mantiene y sale 0,25 s. */
  function zoomAt(zooms, t) {
    for (const z of zooms) {
      if (t < z.start || t >= z.end + 0.25) continue;
      const k = z.strength - 1;
      if (t < z.start + 0.22) { const p = (t - z.start) / 0.22; return 1 + k * (1 - Math.pow(1 - p, 3)); }
      if (t < z.end) return z.strength;
      const p = (t - z.end) / 0.25; return 1 + k * (1 - p * p);
    }
    return 1;
  }

  /** Sacudida (px) en t para los eventos de temblor y el final de cada contador. */
  function shakeAt(events, t) {
    let x = 0, y = 0;
    for (const e of events) {
      const s = e.type === 'temblor' ? e.start : e.type === 'dato' ? e.start + 0.95 : null;
      if (s === null || t < s || t > s + 0.4) continue;
      const k = 22 * Math.exp(-(t - s) * 9);
      x += k * Math.sin((t - s) * 83); y += k * Math.cos((t - s) * 67);
    }
    return { x, y };
  }

  /** ¿Es palabra clave? Cifras, años y nombres propios (mayúscula que no empieza frase). */
  function isKeyword(words, i) {
    const w = String(words[i]?.text || '');
    const bare = w.replace(/^[¿¡"«(]+|[.,;:!?"»)]+$/g, '');
    if (!bare) return false;
    if (/\d/.test(bare)) return true;
    if (bare.length < 3 || !/^\p{Lu}/u.test(bare)) return false;
    const prev = String(words[i - 1]?.text || '');
    return i > 0 && !/[.!?…]$/.test(prev) && !/^[¿¡]/.test(w);
  }

  /** Escala de la animación «pop» (rebote) para un elemento que apareció hace age s. */
  function popScale(age, from = 0.78) {
    if (age >= 0.26) return 1;
    if (age < 0.13) { const p = age / 0.13; return from + (1.1 - from) * (1 - Math.pow(1 - p, 2)); }
    const p = (age - 0.13) / 0.13; return 1.1 - 0.1 * p * p * (3 - 2 * p);
  }

  /** Entrada y salida suaves (0..1) para un evento. */
  function presence(e, t, fadeIn = 0.25, fadeOut = 0.2) {
    if (t < e.start || t >= e.end) return 0;
    return clamp(Math.min((t - e.start) / fadeIn, (e.end - t) / fadeOut), 0, 1);
  }

  /* ---------- Sonidos sintetizados (sin archivos) ---------- */

  function noise(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; }; }

  /** «Pop» corto para textos que aparecen. */
  function popSound(sr) {
    const n = Math.round(sr * 0.11), out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) { const t = i / sr; phase += 2 * Math.PI * (950 - 3600 * t) / sr; out[i] = Math.sin(phase) * Math.exp(-t * 38) * 0.9; }
    return out;
  }

  /** «Whoosh» de aire para paneles y zooms. */
  function whooshSound(sr) {
    const n = Math.round(sr * 0.5), out = new Float32Array(n), rnd = noise(7);
    let low = 0, band = 0;
    for (let i = 0; i < n; i++) {
      const p = i / n, cutoff = 0.02 + 0.22 * Math.sin(Math.PI * p);
      low += cutoff * (rnd() - low); band += cutoff * (low - band);
      out[i] = (low - band) * Math.pow(Math.sin(Math.PI * p), 1.6) * 3.2;
    }
    return out;
  }

  /** Golpe grave para el final del contador y el temblor. */
  function hitSound(sr) {
    const n = Math.round(sr * 0.4), out = new Float32Array(n), rnd = noise(11);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr; phase += 2 * Math.PI * (95 - 50 * Math.min(1, t / 0.25)) / sr;
      out[i] = Math.sin(phase) * Math.exp(-t * 9) * 0.95 + rnd() * Math.exp(-t * 60) * 0.35;
    }
    return out;
  }

  /** Lista de sonidos { at, kind, gainDb } sin amontonarlos (mínimo 0,35 s entre ellos). */
  function soundCues(events, zooms) {
    const cues = [];
    for (const e of events) {
      if (PANEL.has(e.type)) cues.push({ at: Math.max(0, e.start - 0.12), kind: 'whoosh', gainDb: -13 });
      if (['texto', 'paso', 'flecha', 'rec'].includes(e.type)) cues.push({ at: e.start, kind: 'pop', gainDb: -15 });
      if (e.type === 'dato') cues.push({ at: e.start + 0.95, kind: 'hit', gainDb: -11 });
      if (e.type === 'temblor') cues.push({ at: e.start, kind: 'hit', gainDb: -11 });
    }
    for (const z of zooms) cues.push({ at: Math.max(0, z.start - 0.08), kind: 'whoosh', gainDb: z.forced ? -15 : -19 });
    cues.sort((a, b) => a.at - b.at);
    return cues.filter((c, i, all) => !all.slice(0, i).some(p => Math.abs(p.at - c.at) < 0.35 && p.kind === c.kind));
  }

  return {
    SCENES, PANEL, DURATION, DEFAULTS, settings, parseMarks, stripMarks, parts, splitStat, parseNumber, formatNumber, parseScore,
    photoQueries, photoKey, headline, schedule, activeAt, emphasisZooms, zoomAt, shakeAt, isKeyword, popScale, presence,
    popSound, whooshSound, hitSound, soundCues, fold
  };
});
