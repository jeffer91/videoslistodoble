'use strict';
/**
 * Videos largos directos · editor visual con línea de tiempo.
 * Vista previa en canvas con las mismas capas y geometría que la exportación
 * (renderer/direct-layout.js + gráficos generados por el backend).
 * La edición es no destructiva: solo se guardan tramos en el proyecto.
 */
(function () {
  const L = window.DirectLayout;
  let S = null, api = null;
  const E = { segment: null, playing: false, frame: 0, video: null, canvas: null, ctx: null, pps: 40, undo: [], images: new Map(), layers: new Map(), pendingLayers: new Map(),
    saveTimer: 0, transition: null, drag: null, ctaPlan: {}, ctaLayers: new Map() };
  const ACTIONS = new Set(['ed-play', 'ed-split', 'ed-delete', 'ed-layout', 'ed-side', 'ed-corner', 'ed-propose', 'ed-apply', 'ed-discard', 'ed-undo', 'ed-entities', 'ed-search', 'ed-entity',
    'ed-use-image', 'ed-own-images', 'ed-paste-image', 'ed-remove-image', 'ed-transition-preview', 'ed-seg', 'ed-zoom-in', 'ed-zoom-out', 'ed-transcribe', 'ed-open-source', 'ed-select-image', 'ed-tag', 'ed-cut', 'ed-cta', 'ed-cta-add', 'ed-cuts-auto']);
  const COLORS = { A: '#2fbf6b', B: '#d4b15f', C: '#55d3c2', D: '#c46be0', E: '#e0784a' };

  const esc = v => window.DirectLong.esc(v);
  const clock = v => window.DirectLong.clock(v);
  const btn = (...a) => window.DirectLong.btn(...a);
  const q = sel => document.getElementById('direct-view')?.querySelector(sel);

  function section() { return window.DirectLong.section(); }
  function project() { return S.project; }
  function duration() { return section()?.take?.duration || 0; }
  function segments() { return L.fill(section().layouts, duration()); }
  function current() { return segments().find(s => s.id === E.segment) || L.at(segments(), S.time) || segments()[0]; }
  function hasImage(seg) { return Boolean(seg?.imageId && project().images.some(i => i.id === seg.imageId)); }

  // ── HTML ───────────────────────────────────────────────────────────────────
  function html(state) {
    S = state;
    const p = state.project;
    if (!p.sections.length) return '<div class="dl-empty"><h2>Importa el guion y graba las secciones</h2></div>';
    const s = window.DirectLong.section();
    const list = '<div class="dl-panel"><h2>Secciones</h2><ol class="dl-sections">' + p.sections.map(x => '<li class="' + (x.id === s.id ? 'active' : '') + '"><button data-dl="select" data-id="' + esc(x.id) + '">' +
      '<span class="dl-num">' + window.DirectLong.label(x) + '</span><span class="dl-sec-title">' + esc(x.title) + '</span><span class="dl-sec-state ' + (x.take ? 'ok' : '') + '">' + (x.take ? (x.layouts.length ? '✎ ' : '') + clock(x.take.duration) : 'Sin grabar') + '</span></button></li>').join('') + '</ol>' +
      '<h3>Fondo del proyecto</h3><label class="dl-field"><select id="ed-bg-style">' + Object.entries(L.BACKGROUND_NAMES).map(([k, v]) => '<option value="' + k + '"' + (p.settings.background.style === k ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select></label>' +
      '<label class="dl-field">O una imagen propia de fondo<select id="ed-bg-image"><option value="">— Ninguna —</option>' + p.images.map(i => '<option value="' + esc(i.id) + '"' + (p.settings.background.imageId === i.id ? ' selected' : '') + '>' + esc(i.name) + '</option>').join('') + '</select></label></div>';
    if (!s.take) return '<div class="dl-editor">' + list + '<section class="dl-panel dl-empty"><h2>Esta sección no está grabada</h2>' + btn('tab', 'Ir a Grabación', '', 'data-tab="grabacion"') + '</section></div>';
    const seg = current();
    const stage = '<section class="dl-ed-main"><div class="dl-canvas-wrap"><canvas id="ed-canvas" width="960" height="540"></canvas><video id="ed-video" preload="auto" playsinline hidden></video></div>' +
      '<div class="dl-row wrap dl-transport">' + btn('ed-play', '▶ Reproducir', '', 'id="ed-play"') + '<input type="range" id="ed-scrub" min="0" max="' + duration() + '" step="0.033" value="' + S.time + '">' +
      '<span id="ed-time" class="dl-time">' + clock(S.time) + ' / ' + clock(duration()) + ((section().cuts || []).some(c => c.enabled) ? ' · final ' + clock(L.keptDuration(section().cuts, duration())) : '') + '</span>' + btn('ed-split', '✂ Dividir aquí', 'secondary') + btn('ed-cuts-auto', 'Detectar cortes', 'secondary', 'title="Silencios, muletillas y frases repetidas"') +
      '<select id="ed-cta-type" aria-label="Llamado a la acción"><option value="suscribir">Suscríbete</option><option value="like">Dale like</option><option value="comentar">Comenta</option></select>' + btn('ed-cta-add', '＋ Llamado aquí', 'secondary') + btn('ed-zoom-out', '－', 'secondary', 'title="Alejar"') + btn('ed-zoom-in', '＋', 'secondary', 'title="Acercar"') + '</div>' +
      timeline() + '</section>';
    return '<div class="dl-editor">' + list + stage + '<div class="dl-ed-side">' + inspector(seg) + smart() + imagesPanel() + transitionPanel() + '</div></div>';
  }

  function timeline() {
    const s = section(), d = duration();
    const width = Math.max(800, Math.ceil(d * E.pps));
    const px = t => (t * E.pps).toFixed(1);
    const segs = segments();
    const ticks = [];
    const step = E.pps >= 60 ? 1 : E.pps >= 25 ? 5 : 10;
    for (let t = 0; t <= d; t += step) ticks.push('<span style="left:' + px(t) + 'px">' + clock(t) + '</span>');
    const cues = s.transcript?.takeId === s.take.id ? groupCues(s.transcript.words) : [];
    const styles = S.project.sections.map(x => x.id === s.id);
    return '<div class="dl-timeline" id="ed-timeline"><div class="dl-tl-labels"><span>Tiempo</span><span>Transición</span><span>Composición</span><span>Imágenes</span><span>Subtítulos</span><span>Voz</span><span>Música</span><span>Cortes</span><span>Llamados</span></div>' +
      '<div class="dl-tl-scroll"><div class="dl-tl-inner" style="width:' + width + 'px">' +
      '<div class="dl-tl-ruler">' + ticks.join('') + '</div>' +
      '<div class="dl-tl-track">' + (S.project.settings.transitions.enabled && s.transition.enabled ? '<span class="dl-tl-block trans" style="left:0;width:' + Math.min(width, 120) + 'px" title="Entra antes de la sección">◆ ' + esc(s.transition.style === 'auto' ? 'Automática' : L.BACKGROUND_NAMES[s.transition.style]) + ' · ' + s.transition.duration + ' s</span>' : '<span class="dl-tl-empty">Sin transición</span>') + '</div>' +
      '<div class="dl-tl-track">' + segs.map((g, i) => '<button data-dl="ed-seg" data-index="' + i + '" class="dl-tl-block seg ' + (g.filler ? 'filler ' : '') + ((current() === g || (g.id && g.id === E.segment)) ? 'sel' : '') + '" style="left:' + px(g.start) + 'px;width:' + px(g.end - g.start) + 'px;--c:' + COLORS[L.effective(g, hasImage(g))] + '" title="' + esc(L.NAMES[g.layout] + (g.reason ? ' · ' + g.reason : '')) + '">' +
        '<b>' + L.effective(g, hasImage(g)) + '</b> ' + esc(L.NAMES[L.effective(g, hasImage(g))]) + (g.source === 'auto' ? ' · IA' : '') + '</button>' + (i < segs.length - 1 && !g.filler && !segs[i + 1].filler ? '<span class="dl-tl-handle" data-handle="' + i + '" style="left:' + px(g.end) + 'px"></span>' : '')).join('') + '</div>' +
      '<div class="dl-tl-track">' + segs.filter(g => hasImage(g)).map(g => '<span class="dl-tl-block img" style="left:' + px(g.start) + 'px;width:' + px(g.end - g.start) + 'px">▧ ' + esc(S.project.images.find(i => i.id === g.imageId).name) + '</span>').join('') + '</div>' +
      '<div class="dl-tl-track">' + (cues.length ? cues.map(c => '<span class="dl-tl-block sub" style="left:' + px(c.start) + 'px;width:' + px(Math.max(0.2, c.end - c.start)) + 'px" title="' + esc(c.text) + '">' + esc(c.text) + '</span>').join('') : '<span class="dl-tl-empty">' + btn('ed-transcribe', 'Transcribir para generar subtítulos', 'link') + '</span>') + '</div>' +
      '<div class="dl-tl-track"><span class="dl-tl-block voice" style="left:0;width:' + px(d) + 'px">🎙 Toma única · ' + clock(d) + '</span></div>' +
      '<div class="dl-tl-track"><span class="dl-tl-block music" style="left:0;width:' + px(d) + 'px">♫ ' + esc(s.audio.musicId ? 'Pista propia' : s.audio.mood === 'auto' ? 'Música automática' : s.audio.mood) + (S.project.settings.music.ducking ? ' · ducking' : '') + '</span></div>' +
      '<div class="dl-tl-track">' + ((s.cuts || []).length ? s.cuts.map(c => '<button data-dl="ed-cut" data-id="' + esc(c.id) + '" class="dl-tl-block cut ' + (c.enabled ? '' : 'off') + '" style="left:' + px(c.start) + 'px;width:' + px(Math.max(0.15, c.end - c.start)) + 'px" title="' + esc(c.reason + (c.enabled ? ' · clic para conservar este tramo' : ' · clic para volver a cortarlo')) + '">✂</button>').join('') :
        '<span class="dl-tl-empty">Sin cortes · ' + clock(d) + ' finales</span>') + '</div>' +
      '<div class="dl-tl-track">' + (E.ctaPlan[s.id] || []).map(c => '<button data-dl="ed-cta" data-id="' + esc(c.id) + '" data-source="' + esc(c.source) + '" class="dl-tl-block cta" style="left:' + px(c.start) + 'px;width:' + px(c.end - c.start) + 'px" title="' + esc(c.source + ' · clic para quitarlo') + '">' + ({ suscribir: '🔔 Suscríbete', like: '👍 Like', comentar: '💬 Comenta' }[c.type]) + '</button>').join('') + '</div>' +
      '<div class="dl-tl-playhead" id="ed-playhead" style="left:' + px(S.time) + 'px"></div>' +
      '</div></div></div>' + (styles ? '' : '');
  }

  function groupCues(words) {
    const out = [];
    let cur = [];
    for (const w of words) {
      cur.push(w);
      if (/[.!?…,]$/.test(w.text) || cur.length >= 7) { out.push({ start: cur[0].start, end: cur.at(-1).end, text: cur.map(x => x.text).join(' ') }); cur = []; }
    }
    if (cur.length) out.push({ start: cur[0].start, end: cur.at(-1).end, text: cur.map(x => x.text).join(' ') });
    return out;
  }

  function inspector(seg) {
    if (!seg) return '';
    const p = project();
    const eff = L.effective(seg, hasImage(seg));
    return '<section class="dl-panel"><h2>Tramo ' + clock(seg.start) + ' – ' + clock(seg.end) + (seg.filler ? ' <small>(automático)</small>' : '') + '</h2>' +
      '<div class="dl-layouts">' + Object.entries(L.NAMES).map(([k, v]) => '<button data-dl="ed-layout" data-layout="' + k + '" class="' + (seg.layout === k ? 'active' : '') + '" title="' + esc(v) + '"><span class="dl-lay dl-lay-' + k + '"></span><b>' + k + '</b><small>' + esc(v) + '</small></button>').join('') + '</div>' +
      (eff !== seg.layout ? '<p class="dl-warn">Sin imagen se muestra como «' + esc(L.NAMES[eff]) + '». Elige una imagen abajo.</p>' : '') +
      '<div class="dl-two tight"><label class="dl-field">Inicio (s)<input type="number" id="ed-start" step="0.1" min="0" value="' + seg.start.toFixed(2) + '"></label><label class="dl-field">Fin (s)<input type="number" id="ed-end" step="0.1" min="0" value="' + seg.end.toFixed(2) + '"></label></div>' +
      (seg.layout === 'B' || seg.layout === 'E' ? '<div class="dl-seg">' + ['left', 'right'].map(k => '<button data-dl="ed-side" data-side="' + k + '" class="' + ((seg.side || 'left') === k ? 'active' : '') + '">Presentador a la ' + (k === 'left' ? 'izquierda' : 'derecha') + '</button>').join('') + '</div>' : '') +
      (seg.layout === 'C' ? '<div class="dl-seg">' + [['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']].map(([k, v]) => '<button data-dl="ed-corner" data-corner="' + k + '" class="' + ((seg.corner || 'br') === k ? 'active' : '') + '">' + v + '</button>').join('') + '</div>' : '') +
      (seg.layout !== 'D' ? '<label class="dl-field">Tamaño del presentador <output>' + Math.round((seg.scale || 1) * 100) + '%</output><input type="range" id="ed-scale" min="0.3" max="1.25" step="0.01" value="' + (seg.scale || 1) + '"></label>' +
        '<div class="dl-two tight"><label class="dl-field">Posición horizontal<input type="range" id="ed-ox" min="-0.5" max="0.5" step="0.01" value="' + (seg.offsetX || 0) + '"></label><label class="dl-field">Posición vertical<input type="range" id="ed-oy" min="-0.5" max="0.5" step="0.01" value="' + (seg.offsetY || 0) + '"></label></div>' : '') +
      (seg.layout !== 'A' && seg.layout !== 'E' ? '<label class="dl-field">Imagen<select id="ed-image"><option value="">— Sin imagen —</option>' + p.images.map(i => '<option value="' + esc(i.id) + '"' + (seg.imageId === i.id ? ' selected' : '') + '>' + esc(i.name) + '</option>').join('') + '</select></label>' +
        '<label class="dl-check"><input type="checkbox" id="ed-zoom" ' + (seg.zoom === false ? '' : 'checked') + '> Movimiento suave de la imagen</label>' : '') +
      '<label class="dl-field">Fondo de este tramo<select id="ed-bg"><option value="">El del proyecto</option>' + Object.entries(L.BACKGROUND_NAMES).map(([k, v]) => '<option value="' + k + '"' + (seg.background === k ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select></label>' +
      '<label class="dl-field">Rótulo (opcional)<input id="ed-caption" maxlength="60" value="' + esc(seg.caption || '') + '" placeholder="Ej.: Temporada 2017/18"></label>' +
      (seg.reason ? '<p class="dl-note">Motivo de la propuesta: ' + esc(seg.reason) + '</p>' : '') +
      '<div class="dl-row wrap">' + (seg.filler ? '' : btn('ed-delete', 'Eliminar tramo', 'danger')) + (E.undo.length ? btn('ed-undo', 'Deshacer', 'secondary') : '') + '</div></section>';
  }

  function smart() {
    const prop = S.proposal;
    return '<section class="dl-panel"><h2>Modo inteligente</h2><p class="dl-note">Analiza la narración y propone cambios de composición: presentador grande en noticias, opiniones y llamados a la acción; imagen del jugador cuando se le menciona; gráficos en las estadísticas; presentador reducido en narraciones descriptivas. Son propuestas: tú decides.</p>' +
      btn('ed-propose', 'Proponer composición') +
      (prop ? '<ol class="dl-proposal">' + prop.layouts.map(l => '<li><span class="dl-pill" style="--c:' + COLORS[l.layout] + '">' + l.layout + '</span> ' + clock(l.start) + '–' + clock(l.end) + ' · ' + esc(l.reason || L.NAMES[l.layout]) + '</li>').join('') + '</ol>' +
        prop.notes.map(n => '<p class="dl-note">' + esc(n) + '</p>').join('') + '<div class="dl-row">' + btn('ed-apply', 'Aplicar propuesta') + btn('ed-discard', 'Descartar', 'secondary') + '</div>' : '') + '</section>';
  }

  function imagesPanel() {
    const s = section(), p = project();
    const mine = p.images.filter(i => s.imageIds.includes(i.id));
    const ent = S.entities;
    const search = S.search;
    return '<section class="dl-panel"><h2>Imágenes de la sección</h2>' +
      '<div class="dl-thumbs">' + (mine.length ? mine.map(i => '<figure><img src="' + window.DirectLong.fileUrl(i.file) + '" alt="" loading="lazy"><figcaption>' + esc(i.name) + '<small>' + esc(i.source?.provider === 'Wikimedia Commons' ? i.source.license + ' · ' + i.source.author : i.source?.license || '') + '</small></figcaption>' +
        '<div class="dl-row">' + btn('ed-select-image', 'Usar en el tramo', 'secondary', 'data-id="' + esc(i.id) + '"') + btn('ed-remove-image', '✕', 'danger', 'data-id="' + esc(i.id) + '" title="Quitar"') + '</div></figure>').join('') : '<p class="dl-note">Aún no hay imágenes en esta sección.</p>') + '</div>' +
      '<div class="dl-row wrap">' + btn('ed-own-images', 'Subir fotos propias', 'secondary') + btn('ed-paste-image', 'Pegar imagen', 'secondary') + btn('ed-entities', 'Detectar menciones', 'secondary') + '</div>' +
      (ent ? '<div class="dl-chips">' + ent.entities.map(e => '<button class="dl-chip" data-dl="ed-entity" data-q="' + esc(e.name) + '">' + esc(e.name) + ' <small>' + esc(e.type) + '</small></button>').join('') + (ent.entities.length ? '' : '<span class="dl-note">No se detectaron nombres.</span>') + '</div>' +
        (ent.titles.length ? '<p class="dl-note">Títulos sugeridos: ' + ent.titles.map(esc).join(' · ') + '</p>' : '') : '') +
      '<div class="dl-row"><input id="ed-q" placeholder="Buscar: «Harry Kane Bayern 2024»" value="' + esc(search?.query || '') + '">' + btn('ed-search', 'Buscar') + '</div>' +
      (search ? '<p class="dl-note">' + esc(search.note || '') + '</p><div class="dl-results">' + (search.results.length ? search.results.map(r => '<figure>' + (r.thumb ? '<img src="' + esc(r.thumb) + '" alt="" loading="lazy">' : '<div class="dl-nothumb">Vista previa no disponible</div>') + '<figcaption><strong>' + esc(r.title) + '</strong>' +
        '<small>' + r.width + '×' + r.height + (r.year ? ' · ' + r.year : '') + ' · ' + esc(r.license) + '<br>' + esc(r.author) + '</small>' + (r.restrictions ? '<small class="dl-warn">Restricciones: ' + esc(r.restrictions) + '</small>' : '') + '</figcaption>' +
        '<div class="dl-row">' + btn('ed-use-image', 'Usar', '', 'data-title="' + esc(r.title) + '"') + btn('ed-open-source', 'Fuente', 'secondary', 'data-url="' + esc(r.pageUrl) + '"') + '</div></figure>').join('') : '<p class="dl-note">Sin resultados con licencia libre. Prueba con otras palabras o sube tus fotos.</p>') + '</div>' : '') +
      '<p class="dl-note">Las sugerencias vienen de Wikimedia Commons (requiere internet) y solo incluyen licencias libres. Una imagen en internet no es de uso libre por defecto: revisa licencia, autor y derechos de imagen.</p></section>';
  }

  function transitionPanel() {
    const s = section(), t = s.transition;
    return '<section class="dl-panel"><h2>Transición de entrada</h2>' +
      '<label class="dl-check"><input type="checkbox" id="ed-tr-on" ' + (t.enabled ? 'checked' : '') + '> Mostrar transición antes de esta sección</label>' +
      '<label class="dl-field">Estilo<select id="ed-tr-style"><option value="auto">Automático según el contenido</option>' + Object.entries(L.BACKGROUND_NAMES).map(([k, v]) => '<option value="' + k + '"' + (t.style === k ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select></label>' +
      '<label class="dl-field">Título<input id="ed-tr-title" maxlength="140" value="' + esc(t.title) + '" placeholder="' + esc(s.title) + '"></label>' +
      '<label class="dl-field">Duración <output>' + t.duration + ' s</output><input type="range" id="ed-tr-dur" min="2" max="8" step="0.5" value="' + t.duration + '"></label>' +
      '<div class="dl-two tight"><label class="dl-field">Sonido<select id="ed-tr-sound">' + [['ninguno', 'Sin sonido'], ['impacto', 'Impacto'], ['whoosh', 'Whoosh'], ['estadio', 'Estadio'], ['multitud', 'Multitud'], ['cinematico', 'Cinematográfico'], ['musica', 'Música breve']].map(([k, v]) => '<option value="' + k + '"' + (t.sound === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></label>' +
      '<label class="dl-field">Volumen<input type="range" id="ed-tr-vol" min="0" max="1.5" step="0.05" value="' + t.volume + '"></label></div>' +
      btn('ed-transition-preview', '▶ Ver transición', 'secondary') + '</section>';
  }

  // ── Vista previa ──────────────────────────────────────────────────────────
  function mount(state, helpers) {
    S = state; api = helpers;
    E.canvas = q('#ed-canvas');
    E.video = q('#ed-video');
    if (!E.canvas || !E.video) return;
    E.ctx = E.canvas.getContext('2d');
    const s = section();
    const source = window.DirectLong.fileUrl(s.take.master || s.take.original);
    E.video.src = source;
    E.video.addEventListener('loadeddata', () => { try { E.video.currentTime = Math.min(S.time, duration()); } catch { /* sin datos */ } draw(); }, { once: true });
    E.video.addEventListener('seeked', draw);
    E.video.addEventListener('ended', () => { E.playing = false; updatePlay(); });
    bindTimeline();
    draw();
    loadCtas();
  }

  async function loadCtas() {
    try { E.ctaPlan = await api.call('cta.plan', { id: project().id }); } catch { E.ctaPlan = {}; }
    const tl = q('#ed-timeline');
    if (tl) { const scroll = tl.querySelector('.dl-tl-scroll')?.scrollLeft || 0; tl.outerHTML = timeline(); bindTimeline(); const nt = q('#ed-timeline .dl-tl-scroll'); if (nt) nt.scrollLeft = scroll; }
  }

  function ctaLayer(cta) {
    const key = cta.type + '|' + (cta.text || '');
    if (!E.ctaLayers.has(key)) { E.ctaLayers.set(key, null); api.call('cta.layer', { type: cta.type, text: cta.text }).then(r => { E.ctaLayers.set(key, r); draw(); }).catch(() => {}); }
    return E.ctaLayers.get(key);
  }

  function stop() {
    E.playing = false;
    cancelAnimationFrame(E.frame);
    if (E.video) { E.video.pause(); }
    E.transition = null;
  }

  function takeReady(s) {
    if (window.DirectLong.section()?.id === s.id && E.video && !E.playing) { const t = S.time; E.video.src = window.DirectLong.fileUrl(s.take.master); E.video.addEventListener('loadeddata', () => { E.video.currentTime = t; }, { once: true }); }
  }

  function image(url) {
    if (!E.images.has(url)) { const img = new Image(); img.onload = () => draw(); img.src = url; E.images.set(url, img); }
    const img = E.images.get(url);
    return img.complete && img.naturalWidth ? img : null;
  }

  function layerKey(seg) {
    return JSON.stringify([section().id, seg.layout, seg.side, seg.corner, seg.scale, seg.offsetX, seg.offsetY, hasImage(seg), seg.background || '', seg.caption || '', project().settings.background, section().title, section().number]);
  }

  function layers(seg) {
    const key = layerKey(seg);
    if (E.layers.has(key)) return E.layers.get(key);
    if (!E.pendingLayers.has(key)) {
      E.pendingLayers.set(key, api.call('graphics.layers', { id: project().id, sectionId: section().id, segment: { ...seg, imageId: hasImage(seg) ? seg.imageId : null } })
        .then(result => { E.layers.set(key, result); draw(); }).catch(error => console.error('Capas de vista previa', error)).finally(() => E.pendingLayers.delete(key)));
    }
    return null;
  }

  function rounded(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    const ctx = E.ctx;
    if (!ctx || !section()?.take) return;
    if (E.transition) return drawTransition();
    const k = E.canvas.width / L.W;
    const t = E.video && !isNaN(E.video.currentTime) ? E.video.currentTime : S.time;
    const segs = L.frames(segments(), duration());
    const index = Math.max(0, segs.findIndex(g => t >= g.start && t < g.end));
    const seg = segs[index] || segs[0];
    if (!seg) return;
    const box = L.boxes(seg, hasImage(seg));
    const lay = layers(seg);
    ctx.save();
    ctx.scale(k, k);
    ctx.fillStyle = '#06100a';
    ctx.fillRect(0, 0, L.W, L.H);
    const bg = lay && image(lay.background);
    if (bg) ctx.drawImage(bg, 48 + 44 * Math.sin(t * 0.21), 27 + 24 * Math.cos(t * 0.17), L.W, L.H, 0, 0, L.W, L.H);
    if (box.image && hasImage(seg)) {
      const rec = project().images.find(i => i.id === seg.imageId);
      const img = image(window.DirectLong.fileUrl(rec.file));
      if (img) {
        const zoom = seg.zoom === false ? 1 : 1.08;
        const bw = box.image.w * zoom, bh = box.image.h * zoom;
        const c = L.cover(img.naturalWidth, img.naturalHeight, bw, bh);
        const local = (t - seg.start) / Math.max(0.01, seg.end - seg.start);
        const progress = index % 2 ? 1 - local : local;
        const ox = (bw - box.image.w) * progress, oy = (bh - box.image.h) / 2;
        ctx.save();
        rounded(ctx, box.image.x, box.image.y, box.image.w, box.image.h, box.image.radius || 0.01);
        ctx.clip();
        ctx.drawImage(img, box.image.x + c.x - ox, box.image.y + c.y - oy, c.w, c.h);
        ctx.restore();
      }
    }
    if (box.presenter && E.video?.readyState >= 2) {
      const p = box.presenter, v = E.video;
      const side = Math.min(v.videoWidth, v.videoHeight);
      ctx.save();
      rounded(ctx, p.x, p.y, p.size, p.size, box.radius);
      ctx.clip();
      ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, p.x, p.y, p.size, p.size);
      ctx.restore();
    }
    const fg = lay && image(lay.foreground);
    if (fg) ctx.drawImage(fg, 0, 0, L.W, L.H);
    for (const cta of (E.ctaPlan[section().id] || []).filter(c => t >= c.start && t <= c.end)) {
      const layer = ctaLayer(cta);
      const pos = L.ctaBox(seg, hasImage(seg), cta.type);
      const enter = Math.max(0, 1 - (t - cta.start) / 0.35), leave = Math.max(0, (t - (cta.end - 0.35)) / 0.35);
      const x = pos.x + (pos.from - pos.x) * (enter + leave);
      const img = layer && image(cta.type !== 'comentar' && t >= cta.start + 2.2 && layer.pressed ? layer.pressed : layer.normal);
      if (img) ctx.drawImage(img, x, pos.y);
    }
    drawSubtitle(ctx, t);
    ctx.restore();
    const head = q('#ed-playhead');
    if (head) head.style.left = (t * E.pps).toFixed(1) + 'px';
    const time = q('#ed-time');
    if (time) time.textContent = clock(t) + ' / ' + clock(duration());
    const scrub = q('#ed-scrub');
    if (scrub && E.playing) scrub.value = t;
  }

  function drawSubtitle(ctx, t) {
    const s = section(), st = project().settings.subtitles;
    if (!st.enabled || !st.burn || s.transcript?.takeId !== s.take.id) return;
    const cue = groupCues(s.transcript.words).find(c => t >= c.start && t <= c.end + 0.15);
    if (!cue) return;
    const text = st.style === 'impacto' ? cue.text.toUpperCase() : cue.text;
    ctx.font = (st.style === 'minimal' ? '600 ' : '900 ') + st.size + 'px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center';
    const y = st.position === 'top' ? 140 : st.position === 'middle' ? L.H / 2 : L.H - 90;
    const width = ctx.measureText(text).width;
    if (st.style === 'clasico') { ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fillRect(L.W / 2 - width / 2 - 24, y - st.size, width + 48, st.size * 1.35); }
    ctx.lineWidth = st.style === 'clasico' ? 0 : 10;
    ctx.strokeStyle = '#000';
    if (ctx.lineWidth) ctx.strokeText(text, L.W / 2, y);
    ctx.fillStyle = st.style === 'karaoke' ? '#d4b15f' : '#ffffff';
    ctx.fillText(text, L.W / 2, y);
  }

  function drawTransition() {
    const tr = E.transition, ctx = E.ctx;
    if (!tr || !ctx) return;
    const elapsed = (performance.now() - tr.start) / 1000;
    const d = tr.duration;
    if (elapsed > d) { E.transition = null; draw(); return; }
    const k = E.canvas.width / L.W;
    ctx.save();
    ctx.scale(k, k);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, L.W, L.H);
    const bg = image(tr.layers.background), title = image(tr.layers.title);
    const alpha = Math.min(1, elapsed / 0.3, (d - elapsed) / 0.35);
    ctx.globalAlpha = Math.max(0, alpha);
    if (bg) { const z = 1 + 0.06 * elapsed / d; const w = 2016 / z, h = 1134 / z; ctx.drawImage(bg, (2016 - w) / 2, (1134 - h) / 2, w, h, 0, 0, L.W, L.H); }
    if (title) {
      const a = Math.max(0, Math.min(1, (elapsed - 0.35) / 0.5, (d - 0.85 + 0.5 - elapsed) / 0.5));
      const slide = elapsed < 0.35 ? 220 : elapsed < 0.95 ? 220 * Math.pow(1 - (elapsed - 0.35) / 0.6, 3) : 0;
      ctx.globalAlpha = Math.max(0, a * alpha);
      ctx.drawImage(title, slide, 0, L.W, L.H);
    }
    const sx = -700 + (L.W + 1400) * elapsed / d;
    const grad = ctx.createLinearGradient(sx, 0, sx + 700, 0);
    grad.addColorStop(0, 'rgba(255,246,216,0)'); grad.addColorStop(0.5, 'rgba(255,246,216,.45)'); grad.addColorStop(1, 'rgba(255,246,216,0)');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(sx + 260, 0); ctx.lineTo(sx + 700, 0); ctx.lineTo(sx + 440, L.H); ctx.lineTo(sx, L.H); ctx.closePath(); ctx.fill();
    ctx.restore();
    E.frame = requestAnimationFrame(drawTransition);
  }

  function tick() {
    const ranges = L.kept(section()?.cuts, duration());
    if (E.video && E.playing && ranges.length) {
      const t = E.video.currentTime, to = L.skip(ranges, t);
      if (to - t > 0.04) E.video.currentTime = to;
      if (t >= ranges.at(-1).end - 0.02) { E.video.pause(); E.playing = false; updatePlay(); }
    }
    draw();
    if (E.playing) E.frame = requestAnimationFrame(tick);
  }

  function updatePlay() {
    const b = q('#ed-play');
    if (b) b.textContent = E.playing ? '❚❚ Pausa' : '▶ Reproducir';
    S.time = E.video?.currentTime || S.time;
  }

  function seek(t) {
    S.time = Math.max(0, Math.min(duration(), t));
    if (E.video?.readyState >= 1) E.video.currentTime = S.time;
    draw();
  }

  // ── Edición de tramos ─────────────────────────────────────────────────────
  function materialize() {
    // Convierte los huecos automáticos en tramos reales editables.
    return segments().map(g => ({ ...g, id: g.id || crypto.randomUUID(), filler: undefined }));
  }

  function commit(layouts, keepUndo = true) {
    const s = section();
    if (keepUndo) E.undo.push(JSON.stringify(s.layouts));
    if (E.undo.length > 30) E.undo.shift();
    s.layouts = layouts.map(({ filler, startFrame, frames, ...rest }) => rest);
    rerender();
    clearTimeout(E.saveTimer);
    S.saving = 'Guardando…';
    E.saveTimer = setTimeout(async () => {
      try {
        const saved = await api.call('section.update', { id: project().id, sectionId: s.id, patch: { layouts: s.layouts } });
        const fresh = saved.sections.find(x => x.id === s.id);
        if (fresh) s.layouts = fresh.layouts;
        S.saving = 'Guardado automáticamente';
      } catch (error) { api.toast(error.message, true); }
      const el = q('#dl-save'); if (el) el.textContent = S.saving;
    }, 450);
  }

  function rerender() {
    const side = q('.dl-ed-side'), tl = q('#ed-timeline');
    if (side) side.innerHTML = inspector(current()) + smart() + imagesPanel() + transitionPanel();
    if (tl) { const scroll = tl.querySelector('.dl-tl-scroll')?.scrollLeft || 0; tl.outerHTML = timeline(); bindTimeline(); const nt = q('#ed-timeline .dl-tl-scroll'); if (nt) nt.scrollLeft = scroll; }
    draw();
  }

  function editSelected(patch) {
    const list = materialize();
    const t = S.time;
    let target = list.find(g => g.id === E.segment) || list.find(g => t >= g.start && t < g.end) || list[0];
    Object.assign(target, patch, { source: 'manual' });
    E.segment = target.id;
    commit(list);
  }

  function bindTimeline() {
    const tl = q('#ed-timeline');
    if (!tl) return;
    tl.querySelector('.dl-tl-inner')?.addEventListener('pointerdown', event => {
      const handle = event.target.closest('[data-handle]');
      const inner = tl.querySelector('.dl-tl-inner');
      const rect = inner.getBoundingClientRect();
      if (handle) {
        const index = Number(handle.dataset.handle);
        E.drag = { index };
        const move = e => {
          const time = Math.round(Math.max(0, (e.clientX - rect.left) / E.pps) * 30) / 30;
          const list = materialize();
          const a = list[index], b = list[index + 1];
          if (!a || !b) return;
          const value = Math.max(a.start + 0.5, Math.min(b.end - 0.5, time));
          a.end = b.start = value;
          handle.style.left = (value * E.pps) + 'px';
          E.drag.list = list;
        };
        const up = () => { document.removeEventListener('pointermove', move); if (E.drag?.list) commit(E.drag.list); E.drag = null; };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up, { once: true });
        event.preventDefault();
        return;
      }
      if (!event.target.closest('button')) seek((event.clientX - rect.left) / E.pps);
    });
  }

  // ── Acciones ──────────────────────────────────────────────────────────────
  async function click(action, target) {
    const p = project(), s = section();
    if (action === 'ed-play') {
      if (!E.video) return;
      if (E.playing) { E.video.pause(); E.playing = false; }
      else { await E.video.play(); E.playing = true; tick(); }
      return updatePlay();
    }
    if (action === 'ed-seg') {
      const seg = segments()[Number(target.dataset.index)];
      E.segment = seg.id || null;
      seek(seg.start + 0.01);
      if (!seg.id) { S.time = seg.start + 0.01; }
      return rerender();
    }
    if (action === 'ed-split') {
      const list = materialize();
      const t = Math.round(S.time * 30) / 30;
      const i = list.findIndex(g => t > g.start + 0.5 && t < g.end - 0.5);
      if (i < 0) throw Error('Coloca el cursor dentro de un tramo (a más de 0,5 s de sus bordes)');
      const a = list[i];
      const b = { ...a, id: crypto.randomUUID(), start: t, source: 'manual' };
      a.end = t;
      list.splice(i + 1, 0, b);
      E.segment = b.id;
      return commit(list);
    }
    if (action === 'ed-delete') { const list = materialize().filter(g => g.id !== E.segment); E.segment = null; return commit(list); }
    if (action === 'ed-layout') return editSelected({ layout: target.dataset.layout });
    if (action === 'ed-side') return editSelected({ side: target.dataset.side });
    if (action === 'ed-corner') return editSelected({ corner: target.dataset.corner });
    if (action === 'ed-select-image') {
      const seg = current();
      return editSelected({ imageId: target.dataset.id, layout: seg.layout === 'A' || seg.layout === 'E' ? 'B' : seg.layout });
    }
    if (action === 'ed-undo') { const prev = E.undo.pop(); if (prev) commit(JSON.parse(prev), false); return; }
    if (action === 'ed-propose') {
      target.disabled = true;
      try {
        const result = await api.call('intel.propose', { id: p.id, sectionId: s.id });
        S.project.images = result.project.images;
        S.proposal = result;
      } finally { target.disabled = false; }
      return rerender();
    }
    if (action === 'ed-apply') { const list = S.proposal.layouts.map(l => ({ ...l, id: crypto.randomUUID() })); S.proposal = null; api.toast('Propuesta aplicada. Puedes ajustar cada tramo o deshacer.'); return commit(list); }
    if (action === 'ed-discard') { S.proposal = null; return rerender(); }
    if (action === 'ed-entities') { S.entities = await api.call('intel.entities', { id: p.id, sectionId: s.id }); return rerender(); }
    if (action === 'ed-entity' || action === 'ed-search') {
      const query = action === 'ed-entity' ? target.dataset.q : q('#ed-q').value;
      target.disabled = true;
      try { S.search = await api.call('image.search', { query }); S.search.entity = action === 'ed-entity' ? query : ''; }
      catch (error) { throw Error(error.message + '. Comprueba la conexión a internet o sube tus propias fotos.'); }
      finally { target.disabled = false; }
      return rerender();
    }
    if (action === 'ed-use-image') {
      target.disabled = true; target.textContent = 'Descargando…';
      const result = await api.call('image.download', { id: p.id, title: target.dataset.title, query: S.search?.query, entity: S.search?.entity || S.search?.query, sectionId: s.id });
      S.project.images = result.project.images;
      s.imageIds = result.project.sections.find(x => x.id === s.id).imageIds;
      api.toast('Imagen añadida con su licencia y autor');
      return rerender();
    }
    if (action === 'ed-open-source') return api.call('youtube.open', { url: target.dataset.url }).catch(() => api.toast('Abre la fuente desde el navegador: ' + target.dataset.url));
    if (action === 'ed-own-images') {
      const result = await api.call('image.import', { id: p.id, sectionId: s.id });
      if (result.errors.length) api.toast(result.errors[0], true);
      S.project.images = result.project.images; s.imageIds = result.project.sections.find(x => x.id === s.id).imageIds;
      return rerender();
    }
    if (action === 'ed-paste-image') {
      const result = await api.call('image.paste', { id: p.id });
      const ids = [...s.imageIds, result.image.id];
      const saved = await api.call('section.update', { id: p.id, sectionId: s.id, patch: { imageIds: ids } });
      S.project.images = saved.images; s.imageIds = ids;
      return rerender();
    }
    if (action === 'ed-remove-image') {
      const ids = s.imageIds.filter(x => x !== target.dataset.id);
      await api.call('section.update', { id: p.id, sectionId: s.id, patch: { imageIds: ids } });
      s.imageIds = ids;
      return rerender();
    }
    if (action === 'ed-transition-preview') {
      const layers = await api.call('graphics.transition', { id: p.id, sectionId: s.id });
      image(layers.background); image(layers.title);
      if (E.video) E.video.pause();
      E.playing = false;
      await new Promise(r => setTimeout(r, 250));
      E.transition = { start: performance.now(), duration: s.transition.duration, layers };
      if (s.transition.sound !== 'ninguno') {
        const audio = new Audio(await api.call('audio.sample', { kind: 'sfx', name: s.transition.sound }));
        audio.volume = Math.min(1, s.transition.volume);
        audio.play().catch(() => {});
      }
      return drawTransition();
    }
    if (action === 'ed-cut') {
      const cuts = s.cuts.map(c => c.id === target.dataset.id ? { ...c, enabled: !c.enabled } : c);
      const saved = await api.call('section.update', { id: p.id, sectionId: s.id, patch: { cuts } });
      s.cuts = saved.sections.find(x => x.id === s.id).cuts;
      await loadCtas();
      return rerender();
    }
    if (action === 'ed-cuts-auto') {
      const saved = await api.call('cuts.auto', { id: p.id, sectionId: s.id });
      s.cuts = saved.sections.find(x => x.id === s.id).cuts;
      api.toast(s.cuts.length ? s.cuts.length + ' cortes propuestos · haz clic en uno para conservar ese tramo' : 'No se encontraron silencios ni repeticiones');
      await loadCtas();
      return rerender();
    }
    if (action === 'ed-cta-add') {
      const ctas = [...(s.ctas || []), { type: q('#ed-cta-type').value, start: S.time }];
      const saved = await api.call('section.update', { id: p.id, sectionId: s.id, patch: { ctas } });
      s.ctas = saved.sections.find(x => x.id === s.id).ctas;
      await loadCtas();
      return rerender();
    }
    if (action === 'ed-cta') {
      const id = target.dataset.id;
      const patch = target.dataset.source === 'manual' ? { ctas: (s.ctas || []).filter(c => c.id !== id) } : { ctaOff: [...(s.ctaOff || []), id] };
      const saved = await api.call('section.update', { id: p.id, sectionId: s.id, patch });
      Object.assign(s, { ctas: saved.sections.find(x => x.id === s.id).ctas, ctaOff: saved.sections.find(x => x.id === s.id).ctaOff });
      await loadCtas();
      api.toast('Llamado a la acción quitado');
      return rerender();
    }
    if (action === 'ed-zoom-in' || action === 'ed-zoom-out') { E.pps = Math.max(8, Math.min(160, E.pps * (action === 'ed-zoom-in' ? 1.5 : 1 / 1.5))); return rerender(); }
    if (action === 'ed-transcribe') {
      const result = await api.call('intel.transcribe', { id: p.id, sectionIds: [s.id] });
      api.refresh && await api.refresh();
      S.progress = null;
      api.render();
      return result;
    }
  }

  function input(t) {
    if (!t.id?.startsWith('ed-')) return;
    if (t.id === 'ed-scrub') return seek(Number(t.value));
    const out = t.parentElement?.querySelector('output');
    if (t.id === 'ed-scale') { if (out) out.textContent = Math.round(t.value * 100) + '%'; return liveEdit({ scale: Number(t.value) }); }
    if (t.id === 'ed-ox') return liveEdit({ offsetX: Number(t.value) });
    if (t.id === 'ed-oy') return liveEdit({ offsetY: Number(t.value) });
    if (t.id === 'ed-tr-dur' && out) out.textContent = t.value + ' s';
  }

  // Cambios continuos (deslizadores): se ve al instante y se guarda al soltar.
  function liveEdit(patch) {
    const list = materialize();
    const target = list.find(g => g.id === E.segment) || list.find(g => S.time >= g.start && S.time < g.end) || list[0];
    Object.assign(target, patch);
    E.segment = target.id;
    section().layouts = list.map(({ filler, ...rest }) => rest);
    draw();
  }

  async function change(t) {
    if (!t.id?.startsWith('ed-')) return;
    const p = project(), s = section();
    try {
      if (['ed-scale', 'ed-ox', 'ed-oy'].includes(t.id)) return commit(materialize());
      if (t.id === 'ed-start' || t.id === 'ed-end') {
        const list = materialize();
        const i = list.findIndex(g => g.id === E.segment || (S.time >= g.start && S.time < g.end));
        if (i < 0) return;
        const value = Math.round(Number(t.value) * 30) / 30;
        if (t.id === 'ed-start' && i > 0) { list[i].start = Math.max(list[i - 1].start + 0.5, Math.min(list[i].end - 0.5, value)); list[i - 1].end = list[i].start; }
        if (t.id === 'ed-end' && i < list.length - 1) { list[i].end = Math.max(list[i].start + 0.5, Math.min(list[i + 1].end - 0.5, value)); list[i + 1].start = list[i].end; }
        E.segment = list[i].id;
        return commit(list);
      }
      if (t.id === 'ed-image') return editSelected({ imageId: t.value || null });
      if (t.id === 'ed-zoom') return editSelected({ zoom: t.checked });
      if (t.id === 'ed-bg') return editSelected({ background: t.value });
      if (t.id === 'ed-caption') return editSelected({ caption: t.value });
      if (t.id === 'ed-bg-style' || t.id === 'ed-bg-image') {
        S.project = await api.call('settings.save', { id: p.id, settings: { background: { style: q('#ed-bg-style').value, imageId: q('#ed-bg-image').value || null } } });
        E.layers.clear();
        return draw();
      }
      if (t.id.startsWith('ed-tr-')) {
        const patch = { enabled: q('#ed-tr-on').checked, style: q('#ed-tr-style').value, title: q('#ed-tr-title').value, duration: Number(q('#ed-tr-dur').value), sound: q('#ed-tr-sound').value, volume: Number(q('#ed-tr-vol').value) };
        const saved = await api.call('section.update', { id: p.id, sectionId: s.id, patch: { transition: patch } });
        s.transition = saved.sections.find(x => x.id === s.id).transition;
        const tl = q('#ed-timeline'); if (tl) { tl.outerHTML = timeline(); bindTimeline(); }
      }
    } catch (error) { api.toast(error.message, true); }
  }

  window.DirectEditor = { html, mount, stop, handles: a => ACTIONS.has(a), click, input, change, takeReady };
})();
