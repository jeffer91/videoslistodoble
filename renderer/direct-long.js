'use strict';
/**
 * Apartado 3 · Once Records — Videos largos directos.
 * Interfaz independiente: vive en #direct-view y no toca las vistas de
 * Shorts (apartado 1) ni de compilaciones (apartado 2).
 */
(function () {
  const L = window.DirectLayout;
  const S = {
    active: false, page: 'home', tab: 'guion', projects: [], storage: null, project: null, sectionId: null,
    saving: '', progress: null, preview: null, proposal: null, search: null, entities: null, youtube: null, catalog: null, whisper: null,
    pending: [], segmentId: null, time: 0, exportBusy: false, uploadBusy: false
  };
  const TABS = [['guion', '1 · Guion'], ['grabacion', '2 · Grabación'], ['edicion', '3 · Edición'], ['audio', '4 · Música y efectos'], ['subtitulos', '5 · Subtítulos'], ['exportar', '6 · Exportar y publicar']];
  const MOODS = { auto: 'Automática según el contenido', epica: 'Épica', emotiva: 'Emotiva', tension: 'Tensión', ambiental: 'Ambiental deportiva', ninguna: 'Sin música' };
  const SOUND_NAMES = { ninguno: 'Sin sonido', impacto: 'Impacto', whoosh: 'Transición (whoosh)', estadio: 'Sonido de estadio', multitud: 'Multitud que celebra', cinematico: 'Efecto cinematográfico', musica: 'Música deportiva breve' };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const view = () => document.getElementById('direct-view');
  const q = selector => view()?.querySelector(selector);
  const toast = (message, error = false) => (typeof window.notice === 'function' ? window.notice(message, error) : console[error ? 'error' : 'log'](message));
  const clock = s => { const n = Math.max(0, Number(s) || 0); return Math.floor(n / 60) + ':' + String(Math.floor(n % 60)).padStart(2, '0'); };
  const btn = (action, label, cls = '', attrs = '') => '<button data-dl="' + action + '" class="' + cls + '" ' + attrs + '>' + label + '</button>';
  const fileUrl = (rel, project = S.project) => 'records://direct/file/' + encodeURIComponent(project.id) + '/' + rel.split('/').map(encodeURIComponent).join('/');

  async function call(action, data) {
    const response = await window.studio.call('direct:call', { action, data: data || {} });
    if (!response.ok) throw Error(response.error || 'Error desconocido');
    return response.data;
  }

  function section(id = S.sectionId) { return S.project?.sections.find(s => s.id === id) || null; }
  function label(s) { return s.intro ? 'Intro' : String(s.number).padStart(2, '0'); }

  // ── Activación del apartado ────────────────────────────────────────────────
  async function activate() {
    S.active = true;
    document.body.classList.add('direct-active');
    document.getElementById('view').hidden = true;
    view().hidden = false;
    if (S.page === 'home') await loadHome();
    render();
  }

  function deactivate() {
    if (!S.active) return;
    Recorder.close();
    window.DirectEditor?.stop();
    S.active = false;
    document.body.classList.remove('direct-active');
    view().hidden = true;
    document.getElementById('view').hidden = false;
  }

  async function loadHome() {
    const data = await call('list');
    S.projects = data.projects;
    S.storage = data.storage;
  }

  async function openProject(id, tab) {
    S.project = await call('get', { id });
    S.page = 'project';
    S.tab = tab || (S.project.sections.length ? (S.project.sections.every(s => s.take) ? 'edicion' : 'grabacion') : 'guion');
    S.sectionId = S.project.sections.find(s => !s.take)?.id || S.project.sections[0]?.id || null;
    S.pending = await call('take.pending', { id }).catch(() => []);
    S.proposal = S.search = S.entities = null;
    render();
  }

  function setProject(project) {
    S.project = project;
    if (!section()) S.sectionId = project.sections[0]?.id || null;
  }

  async function refresh() { setProject(await call('get', { id: S.project.id })); }

  // ── Vistas ────────────────────────────────────────────────────────────────
  function render() {
    if (!S.active) return;
    const root = view();
    if (S.page === 'home') root.innerHTML = homePage();
    else root.innerHTML = projectPage();
    after();
  }

  function after() {
    if (S.page !== 'project') return;
    if (S.tab === 'grabacion') Recorder.mountStage();
    if (S.tab === 'edicion') window.DirectEditor?.mount(S, { call, refresh, render, toast, section });
  }

  function storagePanel() {
    const st = S.storage;
    if (!st) return '';
    const gb = n => (n / 1073741824).toFixed(1).replace('.', ',') + ' GB';
    return '<section class="dl-panel dl-storage"><div><strong>Almacenamiento local</strong><small>' + esc(st.root) + '</small></div>' +
      (st.free !== null ? '<div class="dl-meter"><span style="width:' + Math.min(100, 100 * (1 - st.free / st.total)).toFixed(1) + '%"></span></div><small>' + gb(st.free) + ' libres de ' + gb(st.total) + '</small>' : '') +
      (st.low ? '<p class="dl-warn">Queda poco espacio. Cada minuto de grabación ocupa unos 50 MB.</p>' : '') +
      '<p class="dl-note">Las grabaciones se guardan en el disco del equipo, no en los datos del navegador. Desinstalar o actualizar la aplicación no las borra; eliminar esa carpeta sí. Usa «Copia de seguridad» para llevar un proyecto a otro disco.</p></section>';
  }

  function homePage() {
    const cards = S.projects.map(p => {
      const pr = p.progress;
      const chips = [['Guion', pr.total > 0], ['Grabado ' + pr.recorded + '/' + pr.total, pr.total > 0 && pr.recorded === pr.total], ['Transcrito', pr.total > 0 && pr.transcribed === pr.total],
        ['Editado', pr.total > 0 && pr.edited === pr.total], ['Exportado', pr.exported]];
      return '<article class="dl-card"><div class="dl-card-head"><span class="dl-badge">' + pr.percent + '%</span><small>' + new Date(p.updatedAt).toLocaleString('es-EC') + '</small></div>' +
        '<h3>' + esc(p.title) + '</h3><div class="dl-progress"><span style="width:' + pr.percent + '%"></span></div>' +
        '<div class="dl-chips">' + chips.map(([text, ok]) => '<span class="dl-chip ' + (ok ? 'ok' : '') + '">' + (ok ? '✓ ' : '') + esc(text) + '</span>').join('') + '</div>' +
        '<small>' + pr.total + ' secciones · ' + clock(pr.duration) + ' grabados' + (p.youtube ? ' · en YouTube' : '') + '</small>' +
        '<div class="dl-row">' + btn('open', 'Abrir', '', 'data-id="' + esc(p.id) + '"') + btn('rename', 'Renombrar', 'secondary', 'data-id="' + esc(p.id) + '"') +
        btn('backup', 'Copia de seguridad', 'secondary', 'data-id="' + esc(p.id) + '"') + btn('delete', 'Eliminar', 'danger', 'data-id="' + esc(p.id) + '"') + '</div></article>';
    }).join('');
    return '<div class="dl-shell"><header class="dl-hero"><div><span class="dl-kicker">ONCE RECORDS · ESTUDIO</span><h1>Videos largos directos</h1>' +
      '<p>Graba tu narración por secciones con teleprompter y conviértela en una producción deportiva 16:9 para YouTube.</p></div>' +
      '<div class="dl-row">' + btn('new', '＋ Nuevo proyecto') + btn('restore', 'Restaurar copia', 'secondary') + '</div></header>' +
      '<section class="dl-panel dl-new" id="dl-new" hidden><label>Título del proyecto<input id="dl-new-title" maxlength="120" placeholder="Harry Kane: la historia completa"></label>' + btn('create', 'Crear proyecto') + '</section>' +
      (cards ? '<div class="dl-grid">' + cards + '</div>' : '<div class="dl-empty"><h2>Tu primer video largo empieza aquí</h2><p>Crea un proyecto, sube tu guion de Once Records y graba sección por sección.</p>' + btn('new', 'Empezar un proyecto') + '</div>') +
      storagePanel() + '</div>';
  }

  function projectHeader() {
    const p = S.project;
    const recorded = p.sections.filter(s => s.take).length;
    return '<header class="dl-top"><div class="dl-row">' + btn('home', '← Proyectos', 'secondary') + '<div><span class="dl-kicker">VIDEOS LARGOS DIRECTOS</span><h1>' + esc(p.title) + '</h1></div></div>' +
      '<div class="dl-top-meta"><span>' + p.sections.length + ' secciones · ' + recorded + ' grabadas · ' + clock(p.sections.reduce((n, s) => n + (s.take?.duration || 0), 0)) + '</span>' +
      '<span class="dl-save" id="dl-save">' + esc(S.saving || 'Guardado automáticamente') + '</span></div></header>' +
      '<nav class="dl-tabs">' + TABS.map(([id, text]) => '<button data-dl="tab" data-tab="' + id + '" class="' + (S.tab === id ? 'active' : '') + '">' + text + '</button>').join('') + '</nav>';
  }

  function projectPage() {
    const body = { guion: scriptTab, grabacion: recordTab, edicion: () => window.DirectEditor ? window.DirectEditor.html(S) : '', audio: audioTab, subtitulos: subtitlesTab, exportar: exportTab }[S.tab]();
    return '<div class="dl-shell">' + projectHeader() + body + progressPanel() + '</div>';
  }

  function progressPanel() {
    const pr = S.progress;
    if (!pr) return '';
    return '<div class="dl-progress-float" role="status"><strong>' + esc(pr.message || 'Procesando…') + '</strong><div class="dl-progress"><span style="width:' + (pr.percent || 0) + '%"></span></div>' +
      (pr.kind === 'export' ? btn('export-cancel', 'Cancelar', 'danger') : '') + '</div>';
  }

  function sectionList(selectable = true) {
    return '<ol class="dl-sections">' + S.project.sections.map(s => '<li class="' + (s.id === S.sectionId ? 'active' : '') + '">' +
      '<button data-dl="select" data-id="' + esc(s.id) + '" ' + (selectable ? '' : 'disabled') + '><span class="dl-num">' + label(s) + '</span><span class="dl-sec-title">' + esc(s.title) + '</span>' +
      '<span class="dl-sec-state ' + (s.take ? 'ok' : '') + '">' + (s.take ? '● ' + clock(s.take.duration) : 'Sin grabar') + '</span></button></li>').join('') + '</ol>';
  }

  function scriptTab() {
    const p = S.project;
    const preview = S.preview;
    const importer = '<section class="dl-panel"><h2>Importar guion</h2><p class="dl-note">PDF, Word (.docx), texto (.txt) o Markdown (.md). Los separadores ━━━ y los encabezados «SECCIÓN 01 · TÍTULO» se reconocen solos y no pasan al teleprompter.</p>' +
      '<div class="dl-row">' + btn('script-file', 'Subir documento') + '</div>' +
      '<label class="dl-field">O pega el guion completo, una sección o un párrafo<textarea id="dl-paste" rows="8" placeholder="━━━━━━━━━━━━━━━━━━\nSECCIÓN 01 · EL COMIENZO\n━━━━━━━━━━━━━━━━━━\n\nDurante años…"></textarea></label>' +
      '<div class="dl-row wrap"><label class="dl-field inline">Cómo añadirlo<select id="dl-mode">' +
      (p.sections.length ? '<option value="append">Como nuevas secciones al final</option><option value="append-text">Al final del texto de la sección seleccionada</option>' : '') +
      '<option value="replace"' + (p.sections.length ? '' : ' selected') + '>Reemplazar todas las secciones</option></select></label>' + btn('script-detect', 'Detectar secciones', 'secondary') + '</div>' +
      (preview ? '<div class="dl-preview-sections"><h3>' + preview.sections.length + ' secciones detectadas' + (preview.name ? ' en ' + esc(preview.name) : '') + '</h3><ol>' +
        preview.sections.map(s => '<li><strong>' + (s.intro ? 'Introducción' : 'Sección ' + String(s.number).padStart(2, '0')) + ' · ' + esc(s.title) + '</strong><small>' + esc(s.text.slice(0, 140)) + (s.text.length > 140 ? '…' : '') + ' · ' + s.text.split(/\s+/).filter(Boolean).length + ' palabras</small></li>').join('') +
        '</ol><div class="dl-row">' + btn('script-apply', 'Aplicar al proyecto') + btn('script-cancel', 'Descartar', 'secondary') + '</div></div>' : '') + '</section>';
    const list = '<section class="dl-panel"><div class="dl-row between"><h2>Secciones</h2>' + btn('section-add', '＋ Añadir sección', 'secondary') + '</div>' +
      (p.sections.length ? p.sections.map((s, i) => '<article class="dl-script-sec" data-section="' + esc(s.id) + '"><div class="dl-row between"><span class="dl-num">' + label(s) + '</span>' +
        '<input class="dl-title-input" data-field="title" value="' + esc(s.title) + '" maxlength="140" aria-label="Título de la sección">' +
        '<div class="dl-row">' + btn('section-up', '↑', 'secondary', 'data-id="' + esc(s.id) + '" ' + (i ? '' : 'disabled') + ' title="Subir"') +
        btn('section-down', '↓', 'secondary', 'data-id="' + esc(s.id) + '" ' + (i < p.sections.length - 1 ? '' : 'disabled') + ' title="Bajar"') +
        btn('section-remove', '✕', 'danger', 'data-id="' + esc(s.id) + '" title="Eliminar sección"') + '</div></div>' +
        '<textarea data-field="text" rows="5" aria-label="Texto narrable">' + esc(s.text) + '</textarea>' +
        '<small>' + s.text.split(/\s+/).filter(Boolean).length + ' palabras · ≈ ' + clock(s.text.split(/\s+/).filter(Boolean).length / 2.5) + ' de lectura' + (s.take ? ' · grabada (' + clock(s.take.duration) + ')' : '') + '</small></article>').join('') :
        '<p class="dl-note">Aún no hay secciones. Importa o pega tu guion.</p>') + '</section>';
    return '<div class="dl-two">' + importer + list + '</div>';
  }

  function recordTab() {
    if (!S.project.sections.length) return '<div class="dl-empty"><h2>Primero importa el guion</h2>' + btn('tab', 'Ir al guion', '', 'data-tab="guion"') + '</div>';
    const s = section();
    const pending = S.pending.filter(t => S.project.sections.some(x => x.id === t.sectionId));
    return '<div class="dl-record">' +
      '<div class="dl-panel">' + '<h2>Secciones</h2>' + sectionList() + (pending.length ? '<div class="dl-recover"><h3>Tomas recuperables</h3>' + pending.map(t => {
        const sec = S.project.sections.find(x => x.id === t.sectionId);
        return '<div class="dl-recover-item"><small>' + esc(sec?.title || '') + ' · ' + new Date(t.at).toLocaleString('es-EC') + '</small><video controls preload="none" src="records://direct/take/' + encodeURIComponent(S.project.id) + '/' + encodeURIComponent(t.id) + '"></video>' +
          '<div class="dl-row">' + btn('recover-use', 'Usar', '', 'data-id="' + esc(t.id) + '"') + btn('recover-discard', 'Descartar', 'secondary', 'data-id="' + esc(t.id) + '"') + '</div></div>';
      }).join('') + '</div>' : '') + '</div>' +
      '<section class="dl-stage-wrap"><div class="dl-row between"><h2>' + esc(label(s) + ' · ' + s.title) + '</h2><span class="dl-take-state">' + (s.take ? 'Toma activa: ' + clock(s.take.duration) + (s.take.master ? '' : ' · preparando copia MP4') : 'Sin toma') + '</span></div>' +
      '<div class="dl-stage" id="dl-stage"><video id="dl-camera" autoplay muted playsinline></video><video id="dl-review" controls playsinline hidden></video>' +
      '<div class="dl-prompter-host" id="dl-prompter-host"></div><div class="dl-rec-badge" id="dl-rec-badge" hidden>● REC <span id="dl-clock">0:00</span></div>' +
      '<div class="dl-stage-empty" id="dl-stage-empty"><p>La cámara se mostrará en formato cuadrado 1:1, centrada.</p>' + btn('camera-on', 'Activar cámara y micrófono') + '</div></div>' +
      '<div class="dl-controls"><div class="dl-row wrap" id="dl-live">' + btn('rec-start', '● Iniciar grabación', 'dl-rec', 'disabled') + btn('rec-stop', '■ Detener', 'danger', 'disabled') +
      '<span class="dl-mic"><meter id="dl-meter" min="0" max="60" low="25" high="55" optimum="45"></meter><small id="dl-meter-text">Micrófono</small></span><small id="dl-write"></small></div>' +
      '<div class="dl-row wrap" id="dl-reviewbar" hidden><strong id="dl-review-info"></strong>' + btn('rec-keep', s.take ? 'Reemplazar la toma activa' : 'Guardar esta toma') + btn('rec-retry', 'Descartar y repetir', 'secondary') + '</div>' +
      (s.take ? '<p class="dl-note">Una sola toma por sección. Si grabas de nuevo, la toma actual se conserva hasta que la nueva quede verificada en el disco.</p>' : '') +
      '<div class="dl-two tight"><label class="dl-field">Cámara<select id="dl-cam"></select></label><label class="dl-field">Micrófono<select id="dl-mic"></select></label></div></div>' +
      (s.take ? '<details class="dl-panel"><summary>Ver la toma activa</summary><video controls preload="metadata" src="' + fileUrl(s.take.master || s.take.original) + '"></video></details>' : '') + '</section>' +
      '<div class="dl-panel dl-prompter-panel"><h2>Teleprompter</h2>' +
      '<div class="dl-seg"><button data-dl="prompter-mode" data-mode="auto" class="' + (DirectPrompter.state().mode === 'auto' ? 'active' : '') + '">A · Automático</button><button data-dl="prompter-mode" data-mode="voice" class="' + (DirectPrompter.state().mode === 'voice' ? 'active' : '') + '">B · Seguimiento por voz</button></div>' +
      '<div class="dl-row wrap">' + btn('prompter-toggle', '▶ Iniciar / pausar', 'secondary') + btn('prompter-back', '⟲ Retroceder', 'secondary') + btn('prompter-forward', 'Avanzar ⟳', 'secondary') + btn('prompter-reset', 'Inicio', 'secondary') + '</div>' +
      '<label class="dl-field">Velocidad<input type="range" id="dl-speed" min="0.5" max="12" step="0.5" value="' + DirectPrompter.state().speed + '"></label>' +
      '<label class="dl-field">Tamaño de letra<input type="range" id="dl-size" min="24" max="110" step="2" value="' + DirectPrompter.state().size + '"></label>' +
      '<label class="dl-field">Opacidad del fondo<input type="range" id="dl-opacity" min="0.2" max="0.95" step="0.05" value="' + DirectPrompter.state().opacity + '"></label>' +
      '<p class="dl-note">El teleprompter es una capa de la pantalla: no se graba ni aparece en el video exportado. Atajos: espacio (pausa), ↑/↓ (retroceder/avanzar). Al iniciar la grabación arranca solo.</p>' +
      '<p class="dl-note">Modo B: se detiene cuando dejas de hablar. Con Whisper instalado (Configuración) reconoce tu voz en el equipo cada 2 s y recoloca el texto, incluso si repites una frase.</p></div></div>';
  }

  function audioTab() {
    const p = S.project, m = p.settings.music;
    const cat = S.catalog || { music: [], sounds: [] };
    const music = p.audio.filter(a => a.kind === 'music');
    return '<div class="dl-two">' +
      '<section class="dl-panel"><h2>Música de fondo</h2>' +
      '<label class="dl-check"><input type="checkbox" id="dl-music-on" ' + (m.enabled ? 'checked' : '') + '> Música durante la narración</label>' +
      '<label class="dl-check"><input type="checkbox" id="dl-ducking" ' + (m.ducking ? 'checked' : '') + '> Ducking automático: baja la música mientras hablas</label>' +
      '<label class="dl-field">Volumen general de la música <output>' + Math.round(m.volume * 100) + '%</output><input type="range" id="dl-music-volume" min="0" max="0.6" step="0.01" value="' + m.volume + '"></label>' +
      '<label class="dl-field">Estilo por defecto<select id="dl-music-default">' + ['epica', 'emotiva', 'tension', 'ambiental'].map(k => '<option value="' + k + '"' + (m.defaultMood === k ? ' selected' : '') + '>' + MOODS[k] + '</option>').join('') + '</select></label>' +
      '<h3>Por sección</h3><table class="dl-table"><thead><tr><th>Sección</th><th>Música</th><th>Volumen</th></tr></thead><tbody>' +
      p.sections.map(s => '<tr data-section="' + esc(s.id) + '"><td>' + esc(label(s) + ' · ' + s.title) + '</td><td><select data-audio="music">' +
        Object.entries(MOODS).map(([k, v]) => '<option value="mood:' + k + '"' + (!s.audio.musicId && s.audio.mood === k ? ' selected' : '') + '>' + esc(v) + '</option>').join('') +
        music.map(a => '<option value="own:' + esc(a.id) + '"' + (s.audio.musicId === a.id ? ' selected' : '') + '>Propia · ' + esc(a.name) + '</option>').join('') + '</select></td>' +
        '<td><input type="number" data-audio="volume" min="0" max="100" step="1" placeholder="General" value="' + (s.audio.volume === null || s.audio.volume === undefined ? '' : Math.round(s.audio.volume * 100)) + '"></td></tr>').join('') + '</tbody></table>' +
      '<p class="dl-note">Entre secciones la música se funde para evitar cortes bruscos. La voz se mantiene protagonista.</p></section>' +
      '<section class="dl-panel"><h2>Biblioteca de audio</h2><p class="dl-note">Música y efectos originales creados por la aplicación en tu equipo: no dependen de licencias de terceros y pueden publicarse en YouTube.</p>' +
      '<h3>Música</h3><div class="dl-audio-list">' + cat.music.map(t => '<div><span>' + esc(t.label) + '</span>' + btn('audio-play', '▶ Escuchar', 'secondary', 'data-kind="music" data-name="' + t.id + '"') + '</div>').join('') + '</div>' +
      '<h3>Efectos de las transiciones</h3><div class="dl-audio-list">' + cat.sounds.map(t => '<div><span>' + esc(t.label) + '</span>' + btn('audio-play', '▶ Escuchar', 'secondary', 'data-kind="sfx" data-name="' + t.id + '"') + '</div>').join('') + '</div>' +
      '<audio id="dl-audio-player" controls hidden></audio>' +
      '<h3>Pistas propias</h3><p class="dl-note">Importa solo música con derechos de uso para YouTube (por ejemplo, de la Biblioteca de audio de YouTube). Indica su licencia:</p>' +
      '<label class="dl-field">Licencia o fuente<input id="dl-license" maxlength="300" placeholder="Biblioteca de audio de YouTube · sin atribución"></label>' + btn('audio-import', 'Importar música', 'secondary') +
      '<ul class="dl-list">' + p.audio.map(a => '<li><span>' + esc(a.name) + ' · ' + clock(a.duration) + '<small>' + esc(a.license) + '</small></span>' + btn('audio-remove', '✕', 'danger', 'data-id="' + esc(a.id) + '"') + '</li>').join('') + '</ul>' +
      '<h3>Voz</h3><label class="dl-field">Ganancia de la voz <output>' + Math.round(p.settings.voice.gain * 100) + '%</output><input type="range" id="dl-voice" min="0.5" max="2" step="0.05" value="' + p.settings.voice.gain + '"></label></section></div>';
  }

  function cueLines(s) {
    if (!s.take || s.transcript?.takeId !== s.take.id) return '';
    const words = s.transcript.words;
    const lines = [];
    let current = [];
    for (const w of words) {
      current.push(w);
      if (/[.!?…]$/.test(w.text) || current.length >= 12) { lines.push(current); current = []; }
    }
    if (current.length) lines.push(current);
    return lines.map((line, i) => '<div class="dl-cue"><span>' + clock(line[0].start) + '</span><input data-cue="' + i + '" value="' + esc(line.map(w => w.text).join(' ')) + '"></div>').join('');
  }

  function subtitlesTab() {
    const st = S.project.settings.subtitles;
    const s = section();
    return '<div class="dl-two"><section class="dl-panel"><h2>Subtítulos automáticos</h2>' +
      '<label class="dl-check"><input type="checkbox" id="dl-sub-on" ' + (st.enabled ? 'checked' : '') + '> Generar subtítulos sincronizados (archivo .srt)</label>' +
      '<label class="dl-check"><input type="checkbox" id="dl-sub-burn" ' + (st.burn ? 'checked' : '') + '> Integrarlos en el video final</label>' +
      '<label class="dl-field">Estilo<select id="dl-sub-style">' + [['impacto', 'Impacto (mayúsculas con resaltado)'], ['clasico', 'Clásico con caja'], ['karaoke', 'Karaoke (relleno progresivo)'], ['minimal', 'Minimalista']].map(([k, v]) => '<option value="' + k + '"' + (st.style === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></label>' +
      '<label class="dl-field">Tamaño <output>' + st.size + '</output><input type="range" id="dl-sub-size" min="30" max="96" step="2" value="' + st.size + '"></label>' +
      '<label class="dl-field">Posición<select id="dl-sub-pos">' + [['bottom', 'Abajo'], ['middle', 'Centro'], ['top', 'Arriba']].map(([k, v]) => '<option value="' + k + '"' + (st.position === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></label>' +
      '<label class="dl-check"><input type="checkbox" id="dl-sub-highlight" ' + (st.highlight ? 'checked' : '') + '> Resaltar la palabra que se pronuncia</label>' +
      '<p class="dl-note">Los subtítulos salen de la transcripción local (Whisper). Corrígela a la derecha; el resultado se usa en el .srt y en el video.</p></section>' +
      '<section class="dl-panel"><div class="dl-row between"><h2>Transcripción editable</h2><select id="dl-sub-section">' + S.project.sections.map(x => '<option value="' + esc(x.id) + '"' + (x.id === S.sectionId ? ' selected' : '') + '>' + esc(label(x) + ' · ' + x.title) + '</option>').join('') + '</select></div>' +
      (!s?.take ? '<p class="dl-note">Graba esta sección para transcribirla.</p>' : s.transcript?.takeId === s.take.id ? '<div class="dl-cues">' + cueLines(s) + '</div>' + btn('cues-save', 'Guardar correcciones') :
        '<p class="dl-note">Sin transcripción.</p>' + btn('transcribe', 'Transcribir esta sección en el equipo', '', 'data-scope="one"')) +
      '<div class="dl-row">' + btn('transcribe', 'Transcribir todas las secciones', 'secondary', 'data-scope="all"') + '</div></section></div>';
  }

  function exportTab() {
    const p = S.project;
    const missing = p.sections.filter(s => !s.take);
    const last = (p.exports || []).at(-1);
    const finals = (p.exports || []).filter(e => e.quality === 'final');
    const yt = S.youtube;
    const chapters = last?.chaptersText ? '<pre class="dl-pre">' + esc(last.chaptersText) + '</pre>' + (last.chaptersValid ? '' : '<p class="dl-warn">' + esc(last.chapterProblems.join(' · ')) + '</p>') : '<p class="dl-note">Se calculan al exportar, con la duración real de cada sección y transición.</p>';
    return '<div class="dl-two"><section class="dl-panel"><h2>Exportar el video</h2>' +
      '<ul class="dl-specs"><li>16:9 · 1920 × 1080 · 30 FPS</li><li>MP4 H.264 + AAC 48 kHz</li><li>Secciones, composiciones, imágenes, títulos y transiciones</li><li>Música con ducking, efectos y subtítulos ' + (p.settings.subtitles.burn ? 'integrados' : 'en .srt') + '</li></ul>' +
      (missing.length ? '<p class="dl-warn">Sin grabar: ' + missing.map(s => esc(s.title)).join(', ') + '. Se exportarán solo las secciones grabadas.</p>' : '') +
      '<div class="dl-row wrap">' + btn('export', 'Vista previa rápida (960 × 540)', 'secondary', 'data-quality="draft"') + btn('export', 'Exportar MP4 final', '', 'data-quality="final"') + '</div>' +
      (last ? '<div class="dl-export"><h3>' + (last.quality === 'final' ? 'Último MP4 final' : 'Última vista previa') + ' · ' + clock(last.duration) + ' · ' + last.width + '×' + last.height + '</h3>' +
        '<video controls preload="metadata" src="' + fileUrl(last.file) + '"></video><div class="dl-row wrap">' + btn('export-show', 'Mostrar en la carpeta', 'secondary', 'data-file="' + esc(last.file) + '"') +
        (last.srt ? btn('export-show', 'Archivo .srt', 'secondary', 'data-file="' + esc(last.srt) + '"') : '') + '</div></div>' : '') +
      '<h3>Capítulos de YouTube</h3>' + chapters + '</section>' +
      '<section class="dl-panel"><h2>Publicar en YouTube</h2>' + (!yt ? '<p class="dl-note">Comprobando la conexión…</p>' : yt.connected ?
        '<p class="dl-ok">Canal conectado: <strong>' + esc(yt.channel.label) + '</strong></p>' :
        '<p class="dl-note">Conecta tu canal con la autorización oficial de Google. Necesitas un proyecto de Google Cloud con YouTube Data API v3 y un cliente OAuth de tipo «App de escritorio». Es la misma conexión de Estadísticas → Conexiones.</p>' +
        '<div class="dl-row wrap">' + btn('yt-guide', 'Abrir Google Cloud', 'secondary', 'data-url="https://console.cloud.google.com/apis/library/youtube.googleapis.com"') + btn('yt-guide', 'Crear cliente OAuth', 'secondary', 'data-url="https://console.cloud.google.com/apis/credentials"') + '</div>' +
        '<label class="dl-field">ID de cliente OAuth<input id="dl-yt-id" placeholder="…apps.googleusercontent.com"></label><label class="dl-field">Secreto de cliente<input id="dl-yt-secret" type="password" autocomplete="off"></label>' + btn('yt-connect', 'Autorizar en el navegador')) +
      '<label class="dl-field">Título<input id="dl-yt-title" maxlength="100" value="' + esc(p.youtube.title || p.title) + '"></label>' +
      '<label class="dl-field">Descripción<textarea id="dl-yt-desc" rows="5" maxlength="4000">' + esc(p.youtube.description || '') + '</textarea></label>' +
      '<p class="dl-note">Se añadirán automáticamente los capítulos y los créditos de las imágenes con licencia.</p>' +
      '<label class="dl-field">Etiquetas (separadas por comas)<input id="dl-yt-tags" value="' + esc((p.youtube.tags || []).join(', ')) + '"></label>' +
      '<div class="dl-two tight"><label class="dl-field">Visibilidad<select id="dl-yt-privacy">' + [['private', 'Privado'], ['unlisted', 'No listado'], ['public', 'Público']].map(([k, v]) => '<option value="' + k + '"' + (p.youtube.privacy === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></label>' +
      '<label class="dl-check"><input type="checkbox" id="dl-yt-kids" ' + (p.youtube.madeForKids ? 'checked' : '') + '> Contenido creado para niños</label></div>' +
      '<div class="dl-row wrap">' + btn('yt-upload', 'Publicar en YouTube', '', (yt?.connected && finals.length && !S.uploadBusy ? '' : 'disabled')) + btn('yt-upload-thumb', 'Publicar con mi miniatura', 'secondary', (yt?.connected && finals.length && !S.uploadBusy ? '' : 'disabled')) + '</div>' +
      (!finals.length ? '<p class="dl-note">Exporta el MP4 final para habilitar la publicación.</p>' : '') +
      (p.youtube.lastUpload ? '<div class="dl-ok"><p>Último envío: <strong>' + esc(p.youtube.lastUpload.title) + '</strong> · ' + esc(p.youtube.lastUpload.privacy) + (p.youtube.lastUpload.processing ? ' · ' + esc(p.youtube.lastUpload.processing) : '') + '</p>' +
        '<div class="dl-row wrap">' + btn('yt-guide', 'Ver en YouTube', 'secondary', 'data-url="' + esc(p.youtube.lastUpload.url) + '"') + btn('yt-guide', 'Abrir en YouTube Studio', 'secondary', 'data-url="' + esc(p.youtube.lastUpload.studio) + '"') + btn('yt-check', 'Comprobar estado', 'secondary') + '</div>' +
        (p.youtube.lastUpload.warnings || []).map(w => '<p class="dl-warn">' + esc(w) + '</p>').join('') + '</div>' : '') +
      '<p class="dl-note">YouTube exige que los proyectos de Google Cloud sin auditoría publiquen como privado; cambia la visibilidad en YouTube Studio o solicita la auditoría de la API.</p></section></div>';
  }

  // ── Grabación ─────────────────────────────────────────────────────────────
  const Recorder = (function () {
    let stream = null, recorder = null, draw = 0, meter = 0, audioCtx = null, take = null, writes = Promise.resolve(), sequence = 0, writeError = null, started = 0, inspecting = false;

    function busy() { return Boolean(recorder); }

    function mountStage() {
      const s = section();
      DirectPrompter.mount(q('#dl-prompter-host'), s?.text || '');
      if (stream) attach();
    }

    async function open() {
      if (!navigator.mediaDevices?.getUserMedia) throw Error('Este equipo no ofrece cámara');
      const cam = q('#dl-cam')?.value, mic = q('#dl-mic')?.value;
      release();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, ...(cam ? { deviceId: { exact: cam } } : {}) },
          audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false, ...(mic ? { deviceId: { exact: mic } } : {}) } });
      } catch (error) {
        const reasons = { NotAllowedError: 'Permiso denegado. Autoriza la cámara y el micrófono para 11 Récords Studio en la configuración de privacidad de Windows.',
          NotFoundError: 'No se encontró cámara o micrófono.', NotReadableError: 'Otra aplicación está usando la cámara o el micrófono.', OverconstrainedError: 'El dispositivo elegido no está disponible.' };
        throw Error(reasons[error.name] || 'Cámara o micrófono: ' + error.message);
      }
      attach();
      const devices = await navigator.mediaDevices.enumerateDevices();
      for (const [id, kind, track] of [['#dl-cam', 'videoinput', stream.getVideoTracks()[0]], ['#dl-mic', 'audioinput', stream.getAudioTracks()[0]]]) {
        const select = q(id);
        if (!select) continue;
        const current = track?.getSettings().deviceId;
        select.innerHTML = devices.filter(d => d.kind === kind).map((d, i) => '<option value="' + esc(d.deviceId) + '"' + (d.deviceId === current ? ' selected' : '') + '>' + esc(d.label || (kind === 'videoinput' ? 'Cámara ' : 'Micrófono ') + (i + 1)) + '</option>').join('');
      }
    }

    function attach() {
      const video = q('#dl-camera');
      if (!video || !stream) return;
      video.srcObject = stream;
      video.play().catch(() => {});
      q('#dl-stage-empty')?.setAttribute('hidden', '');
      const start = q('[data-dl="rec-start"]');
      if (start) start.disabled = false;
      levels();
    }

    function levels() {
      cancelAnimationFrame(meter);
      if (audioCtx) audioCtx.close().catch(() => {});
      audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const tick = () => {
        const m = q('#dl-meter');
        if (!m) return;
        analyser.getFloatTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((a, x) => a + x * x, 0) / data.length);
        const db = Math.max(-60, Math.round(20 * Math.log10(Math.max(0.001, rms))));
        m.value = db + 60;
        q('#dl-meter-text').textContent = db <= -60 ? 'Sin señal' : db + ' dBFS';
        meter = requestAnimationFrame(tick);
      };
      tick();
    }

    function release() {
      clearInterval(draw);
      cancelAnimationFrame(meter);
      if (audioCtx) audioCtx.close().catch(() => {});
      audioCtx = null;
      stream?.getTracks().forEach(t => t.stop());
      stream = null;
    }

    function encode(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        // El tipo MIME contiene comas («codecs=vp8,opus»): se corta tras «;base64,».
        reader.onload = () => { const s = String(reader.result); const at = s.lastIndexOf(';base64,'); at < 0 ? reject(Error('Fragmento inválido')) : resolve(s.slice(at + 8)); };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }

    async function start() {
      if (recorder || inspecting) return;
      if (!stream) await open();
      const camera = q('#dl-camera');
      if (!camera?.videoWidth || !stream.getAudioTracks().length) throw Error('La cámara y el micrófono deben estar listos');
      const s = section();
      take = await call('take.begin', { id: S.project.id, sectionId: s.id });
      sequence = 0; writeError = null; writes = Promise.resolve();
      // Lienzo cuadrado 1080 × 1080: solo recibe la imagen de la cámara (nunca el teleprompter).
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1080;
      const ctx = canvas.getContext('2d', { alpha: false });
      const track = canvas.captureStream(0).getVideoTracks()[0];
      const paint = () => {
        if (camera.readyState < 2) return;
        const side = Math.min(camera.videoWidth, camera.videoHeight);
        ctx.drawImage(camera, (camera.videoWidth - side) / 2, (camera.videoHeight - side) / 2, side, side, 0, 0, 1080, 1080);
        track.requestFrame();
        const c = q('#dl-clock');
        if (c) c.textContent = clock((Date.now() - started) / 1000);
      };
      const mime = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
      recorder = new MediaRecorder(new MediaStream([track, ...stream.getAudioTracks()]), { mimeType: mime, videoBitsPerSecond: 7000000, audioBitsPerSecond: 160000 });
      const draft = take;
      recorder.addEventListener('dataavailable', ({ data }) => {
        if (!data.size || writeError) return;
        const n = sequence++;
        writes = writes.then(async () => {
          if (writeError) return;
          await call('take.append', { id: S.project.id, takeId: draft.id, sequence: n, data: await encode(data) });
          const w = q('#dl-write');
          if (w) w.textContent = 'Guardando en disco · ' + n + ' s';
        }).catch(error => { writeError = error; toast('Se conservó la parte ya escrita. ' + error.message, true); });
      });
      started = Date.now();
      paint();
      draw = setInterval(paint, 1000 / 30);
      recorder.start(1000);
      q('#dl-rec-badge').hidden = false;
      q('[data-dl="rec-start"]').disabled = true;
      q('[data-dl="rec-stop"]').disabled = false;
      for (const id of ['#dl-cam', '#dl-mic']) if (q(id)) q(id).disabled = true;
      if (DirectPrompter.state().mode === 'voice') await DirectPrompter.setMode('voice', stream).catch(e => toast(e.message, true));
      DirectPrompter.start();
    }

    async function stop() {
      const active = recorder;
      if (!active) return;
      inspecting = true;
      const done = new Promise(r => active.addEventListener('stop', r, { once: true }));
      if (active.state === 'recording') active.requestData();
      active.stop();
      await done;
      await writes;
      clearInterval(draw);
      recorder = null;
      DirectPrompter.stop();
      q('#dl-rec-badge').hidden = true;
      q('[data-dl="rec-stop"]').disabled = true;
      try {
        const info = await call('take.inspect', { id: S.project.id, takeId: take.id });
        if (!info.ok) throw Error('La toma no tiene suficiente imagen y sonido. Repite la grabación.');
        q('#dl-live').hidden = true;
        q('#dl-reviewbar').hidden = false;
        q('#dl-review-info').textContent = 'Toma de ' + clock(info.duration) + ' · ' + Math.round(info.size / 1048576) + ' MB';
        const review = q('#dl-review');
        q('#dl-camera').hidden = true;
        review.hidden = false;
        review.src = 'records://direct/take/' + encodeURIComponent(S.project.id) + '/' + encodeURIComponent(take.id);
      } finally { inspecting = false; }
    }

    async function keep() {
      if (!take) return;
      const current = take;
      S.saving = 'Verificando y guardando la toma…';
      const el = q('[data-dl="rec-keep"]');
      if (el) el.disabled = true;
      const result = await call('take.commit', { id: S.project.id, takeId: current.id });
      take = null;
      setProject(result.project);
      S.saving = 'Toma guardada';
      const next = S.project.sections.find(s => !s.take);
      toast('Toma guardada' + (next ? '. Siguiente: ' + next.title : '. ¡Todas las secciones están grabadas!'));
      if (next) S.sectionId = next.id;
      closeReview();
      render();
    }

    async function retry() {
      if (take) await call('take.discard', { id: S.project.id, takeId: take.id }).catch(() => {});
      take = null;
      closeReview();
      DirectPrompter.reset();
      render();
    }

    function closeReview() {
      const review = q('#dl-review');
      if (review) { review.pause(); review.removeAttribute('src'); }
    }

    function close() {
      if (recorder) { try { recorder.stop(); } catch { /* detenido */ } recorder = null; }
      clearInterval(draw);
      release();
      DirectPrompter.unmount();
      // Una toma sin confirmar no se borra: queda en «Tomas recuperables».
      take = null;
    }

    return { mountStage, open, start, stop, keep, retry, close, busy, stream: () => stream };
  })();

  // ── Eventos ───────────────────────────────────────────────────────────────
  async function onClick(target) {
    const action = target.dataset.dl;
    const id = target.dataset.id;
    if (action === 'home') { if (Recorder.busy()) throw Error('Detén la grabación antes de salir'); Recorder.close(); window.DirectEditor?.stop(); S.page = 'home'; S.project = null; await loadHome(); return render(); }
    if (action === 'new') { const panel = q('#dl-new'); panel.hidden = false; return q('#dl-new-title').focus(); }
    if (action === 'create') { const p = await call('create', { title: q('#dl-new-title').value }); return openProject(p.id, 'guion'); }
    if (action === 'open') return openProject(id);
    if (action === 'rename') return modalRename(id);
    if (action === 'delete') return modalDelete(id);
    if (action === 'backup') { const r = await call('backup.export', { id }); if (r) toast('Copia guardada: ' + r.file); return; }
    if (action === 'restore') { const r = await call('backup.import'); if (r) { toast('Proyecto restaurado: ' + r.title); await loadHome(); render(); } return; }
    if (action === 'tab') {
      if (Recorder.busy()) throw Error('Detén la grabación antes de cambiar de pestaña');
      if (S.tab === 'grabacion') Recorder.close();
      window.DirectEditor?.stop();
      S.tab = target.dataset.tab;
      if (S.tab === 'audio' && !S.catalog) S.catalog = await call('audio.catalog');
      if (S.tab === 'grabacion') S.pending = await call('take.pending', { id: S.project.id }).catch(() => []);
      if (S.tab === 'exportar') { S.youtube = null; call('youtube.status').then(y => { S.youtube = y; if (S.tab === 'exportar') render(); }).catch(() => {}); }
      return render();
    }
    if (action === 'select') {
      if (Recorder.busy()) throw Error('Detén la grabación antes de cambiar de sección');
      S.sectionId = id; S.proposal = null; S.entities = null; S.search = null; S.time = 0;
      if (S.tab === 'grabacion') { const live = Recorder.stream(); render(); if (live) Recorder.open().catch(e => toast(e.message, true)); return; }
      return render();
    }
    // Guion
    if (action === 'script-file') { const r = await call('script.file'); if (r) { S.preview = r; q('#dl-paste').value = r.text; render(); q('#dl-paste').value = r.text; } return; }
    if (action === 'script-detect') {
      const text = q('#dl-paste').value;
      if (!text.trim()) throw Error('Pega o sube un guion primero');
      S.preview = { text, name: S.preview?.name || '', format: S.preview?.format || 'pegado', sections: await call('script.parse', { text }) };
      const mode = q('#dl-mode').value;
      render();
      q('#dl-paste').value = text; q('#dl-mode').value = mode;
      return;
    }
    if (action === 'script-apply') {
      const mode = q('#dl-mode')?.value || 'replace';
      setProject(await call('script.apply', { id: S.project.id, text: S.preview.text, mode, at: S.sectionId, source: { name: S.preview.name, format: S.preview.format } }));
      S.preview = null;
      toast('Guion aplicado');
      return render();
    }
    if (action === 'script-cancel') { S.preview = null; return render(); }
    if (action === 'section-add') { setProject(await call('section.add', { id: S.project.id, title: 'Nueva sección', text: '' })); return render(); }
    if (action === 'section-up' || action === 'section-down') { setProject(await call('section.move', { id: S.project.id, sectionId: id, delta: action === 'section-up' ? -1 : 1 })); return render(); }
    if (action === 'section-remove') {
      const s = section(id);
      if (!confirm('¿Eliminar la sección «' + s.title + '»' + (s.take ? ' y su grabación' : '') + '?')) return;
      setProject(await call('section.remove', { id: S.project.id, sectionId: id, confirm: true }));
      return render();
    }
    // Grabación
    if (action === 'camera-on') return Recorder.open();
    if (action === 'rec-start') return Recorder.start();
    if (action === 'rec-stop') return Recorder.stop();
    if (action === 'rec-keep') return Recorder.keep();
    if (action === 'rec-retry') return Recorder.retry();
    if (action === 'recover-use') { const r = await call('take.commit', { id: S.project.id, takeId: id }); setProject(r.project); S.pending = await call('take.pending', { id: S.project.id }); toast('Toma recuperada'); return render(); }
    if (action === 'recover-discard') { await call('take.discard', { id: S.project.id, takeId: id }); S.pending = await call('take.pending', { id: S.project.id }); return render(); }
    if (action === 'prompter-mode') {
      const mode = target.dataset.mode;
      await DirectPrompter.setMode(mode, Recorder.stream()).catch(e => { toast(e.message, true); return DirectPrompter.setMode('auto'); });
      view().querySelectorAll('[data-dl="prompter-mode"]').forEach(b => b.classList.toggle('active', b.dataset.mode === DirectPrompter.state().mode));
      return;
    }
    if (action === 'prompter-toggle') return DirectPrompter.toggle();
    if (action === 'prompter-back') return DirectPrompter.jump(-3);
    if (action === 'prompter-forward') return DirectPrompter.jump(3);
    if (action === 'prompter-reset') return DirectPrompter.reset();
    // Audio
    if (action === 'audio-play') {
      target.disabled = true;
      try { const player = q('#dl-audio-player'); player.hidden = false; player.src = await call('audio.sample', { kind: target.dataset.kind, name: target.dataset.name }); await player.play(); }
      finally { target.disabled = false; }
      return;
    }
    if (action === 'audio-import') { const r = await call('audio.import', { id: S.project.id, kind: 'music', license: q('#dl-license').value }); if (r) { setProject(r.project); render(); } return; }
    if (action === 'audio-remove') { setProject(await call('audio.remove', { id: S.project.id, audioId: id })); return render(); }
    // Subtítulos
    if (action === 'transcribe') {
      const scope = target.dataset.scope;
      const r = await call('intel.transcribe', { id: S.project.id, sectionIds: scope === 'one' ? [S.sectionId] : null });
      setProject(r.project); S.progress = null; toast(r.sections.length + ' sección(es) transcritas en el equipo');
      return render();
    }
    if (action === 'cues-save') return saveCues();
    // Exportar
    if (action === 'export') {
      if (S.exportBusy) return;
      S.exportBusy = true;
      S.progress = { kind: 'export', percent: 0, message: 'Preparando la exportación' };
      render();
      try {
        const entry = await call('export.start', { id: S.project.id, quality: target.dataset.quality });
        await refresh();
        toast((entry.quality === 'final' ? 'MP4 final listo · ' : 'Vista previa lista · ') + clock(entry.duration));
      } finally { S.exportBusy = false; S.progress = null; render(); }
      return;
    }
    if (action === 'export-cancel') return call('export.cancel');
    if (action === 'export-show') return call('open.export', { id: S.project.id, file: target.dataset.file });
    if (action === 'yt-guide') return call('youtube.open', { url: target.dataset.url });
    if (action === 'yt-connect') { S.youtube = await call('youtube.connect', { clientId: q('#dl-yt-id').value, clientSecret: q('#dl-yt-secret').value }); toast('YouTube conectado'); return render(); }
    if (action === 'yt-upload' || action === 'yt-upload-thumb') {
      await saveYouTube();
      S.uploadBusy = true;
      S.progress = { kind: 'youtube', percent: 0, message: 'Conectando con YouTube' };
      render();
      try {
        const result = await call('youtube.upload', { id: S.project.id, withThumbnail: action === 'yt-upload-thumb' });
        if (result) toast('Publicado en YouTube: ' + result.url);
        await refresh();
      } finally { S.uploadBusy = false; S.progress = null; render(); }
      return;
    }
    if (action === 'yt-check') { await call('youtube.check', { id: S.project.id }); await refresh(); return render(); }
    if (window.DirectEditor?.handles(action)) return window.DirectEditor.click(action, target);
  }

  async function saveYouTube() {
    if (!q('#dl-yt-title')) return;
    setProject(await call('youtube.save', { id: S.project.id, youtube: { title: q('#dl-yt-title').value, description: q('#dl-yt-desc').value,
      tags: q('#dl-yt-tags').value.split(','), privacy: q('#dl-yt-privacy').value, madeForKids: q('#dl-yt-kids').checked } }));
  }

  async function saveCues() {
    const s = section();
    const lines = [];
    let current = [];
    for (const w of s.transcript.words) { current.push(w); if (/[.!?…]$/.test(w.text) || current.length >= 12) { lines.push(current); current = []; } }
    if (current.length) lines.push(current);
    const words = [];
    view().querySelectorAll('[data-cue]').forEach(input => {
      const line = lines[Number(input.dataset.cue)];
      if (!line) return;
      const parts = input.value.trim().split(/\s+/).filter(Boolean);
      const start = line[0].start, end = line.at(-1).end;
      // Reparte las palabras corregidas en el tiempo original de la línea.
      parts.forEach((text, i) => words.push({ text, start: start + (end - start) * i / parts.length, end: start + (end - start) * (i + 1) / parts.length - 0.01 }));
      if (parts.length === line.length) parts.forEach((text, i) => Object.assign(words[words.length - parts.length + i], { start: line[i].start, end: line[i].end }));
    });
    setProject(await call('section.update', { id: S.project.id, sectionId: s.id, patch: { transcript: { takeId: s.take.id, words } } }));
    toast('Transcripción corregida');
    render();
  }

  function modal(html) {
    const root = document.getElementById('modal-root');
    root.hidden = false;
    root.innerHTML = '<div class="modalback"><div class="modal dl-modal">' + html + '</div></div>';
    return root;
  }
  function closeModal() { const root = document.getElementById('modal-root'); root.hidden = true; root.innerHTML = ''; }

  function modalRename(id) {
    const p = S.projects.find(x => x.id === id);
    const root = modal('<h2>Renombrar proyecto</h2><label class="dl-field">Título<input id="dl-rename" maxlength="120" value="' + esc(p.title) + '"></label><div class="dl-row">' +
      '<button id="dl-rename-ok">Guardar</button><button class="secondary" id="dl-modal-close">Cancelar</button></div>');
    root.querySelector('#dl-rename-ok').onclick = async () => { try { await call('rename', { id, title: root.querySelector('#dl-rename').value }); closeModal(); await loadHome(); render(); } catch (e) { toast(e.message, true); } };
    root.querySelector('#dl-modal-close').onclick = closeModal;
  }

  function modalDelete(id) {
    const p = S.projects.find(x => x.id === id);
    const root = modal('<h2>Eliminar proyecto</h2><p>Se borrarán el guion, las grabaciones, las imágenes y las exportaciones de <strong>' + esc(p.title) + '</strong>. No se puede deshacer.</p>' +
      '<label class="dl-field">Escribe el título para confirmar<input id="dl-confirm" autocomplete="off"></label><div class="dl-row"><button class="danger" id="dl-delete-ok" disabled>Eliminar definitivamente</button><button class="secondary" id="dl-modal-close">Cancelar</button></div>');
    const input = root.querySelector('#dl-confirm'), ok = root.querySelector('#dl-delete-ok');
    input.oninput = () => { ok.disabled = input.value !== p.title; };
    ok.onclick = async () => { try { await call('delete', { id, confirm: input.value }); closeModal(); await loadHome(); render(); toast('Proyecto eliminado'); } catch (e) { toast(e.message, true); } };
    root.querySelector('#dl-modal-close').onclick = closeModal;
  }

  // Guardado automático del guion (título y texto de cada sección).
  const timers = new Map();
  function autosave(sectionId, patch) {
    S.saving = 'Guardando…';
    const el = q('#dl-save'); if (el) el.textContent = S.saving;
    clearTimeout(timers.get(sectionId));
    timers.set(sectionId, setTimeout(async () => {
      try {
        const updated = await call('section.update', { id: S.project.id, sectionId, patch });
        const fresh = updated.sections.find(s => s.id === sectionId);
        const local = section(sectionId);
        if (local && fresh) Object.assign(local, { title: fresh.title, text: fresh.text });
        S.saving = 'Guardado automáticamente · ' + new Date().toLocaleTimeString('es-EC');
      } catch (error) { S.saving = 'No se pudo guardar: ' + error.message; toast(error.message, true); }
      const el2 = q('#dl-save'); if (el2) el2.textContent = S.saving;
    }, 600));
  }

  function settingsPatch(path, value) {
    const [group, key] = path;
    return call('settings.save', { id: S.project.id, settings: { [group]: { [key]: value } } }).then(p => { setProject(p); S.saving = 'Guardado automáticamente'; });
  }

  document.addEventListener('click', event => {
    const nav = event.target.closest('#sidebar [data-action]');
    if (nav) {
      if (nav.dataset.action === 'direct-long') { event.preventDefault(); activate().catch(e => toast(e.message, true)); return; }
      if (Recorder.busy()) { event.stopImmediatePropagation(); event.preventDefault(); toast('Detén la grabación antes de salir de Videos largos directos', true); return; }
      deactivate();
      return;
    }
    if (!S.active) return;
    if (event.target.id === 'dl-modal-close') return;
    const target = event.target.closest('[data-dl]');
    if (!target || !view().contains(target)) return;
    onClick(target).catch(error => { toast(error.message, true); console.error(error); });
  }, true);

  document.addEventListener('input', event => {
    if (!S.active || !view().contains(event.target)) return;
    const t = event.target;
    const sec = t.closest('[data-section]');
    if (S.tab === 'guion' && sec && t.dataset.field) {
      const s = section(sec.dataset.section);
      if (t.dataset.field === 'title') s.title = t.value; else s.text = t.value;
      return autosave(s.id, { title: s.title, text: s.text });
    }
    if (t.id === 'dl-speed') DirectPrompter.setSpeed(t.value);
    if (t.id === 'dl-size') DirectPrompter.setSize(t.value);
    if (t.id === 'dl-opacity') DirectPrompter.setOpacity(t.value);
    const out = t.parentElement?.querySelector('output');
    if (out && t.type === 'range') out.textContent = t.id === 'dl-sub-size' ? t.value : Math.round(t.value * 100) + '%';
    window.DirectEditor?.input(t);
  });

  document.addEventListener('change', event => {
    if (!S.active || !view().contains(event.target)) return;
    const t = event.target;
    const run = promise => promise.catch(error => toast(error.message, true));
    if (t.id === 'dl-cam' || t.id === 'dl-mic') return run(Recorder.open());
    if (t.id === 'dl-music-on') return run(settingsPatch(['music', 'enabled'], t.checked));
    if (t.id === 'dl-ducking') return run(settingsPatch(['music', 'ducking'], t.checked));
    if (t.id === 'dl-music-volume') return run(settingsPatch(['music', 'volume'], Number(t.value)));
    if (t.id === 'dl-music-default') return run(settingsPatch(['music', 'defaultMood'], t.value));
    if (t.id === 'dl-voice') return run(settingsPatch(['voice', 'gain'], Number(t.value)));
    if (t.id === 'dl-sub-on') return run(settingsPatch(['subtitles', 'enabled'], t.checked));
    if (t.id === 'dl-sub-burn') return run(settingsPatch(['subtitles', 'burn'], t.checked));
    if (t.id === 'dl-sub-style') return run(settingsPatch(['subtitles', 'style'], t.value));
    if (t.id === 'dl-sub-size') return run(settingsPatch(['subtitles', 'size'], Number(t.value)));
    if (t.id === 'dl-sub-pos') return run(settingsPatch(['subtitles', 'position'], t.value));
    if (t.id === 'dl-sub-highlight') return run(settingsPatch(['subtitles', 'highlight'], t.checked));
    if (t.id === 'dl-sub-section') { S.sectionId = t.value; return render(); }
    if (['dl-yt-title', 'dl-yt-desc', 'dl-yt-tags', 'dl-yt-privacy', 'dl-yt-kids'].includes(t.id)) return run(saveYouTube());
    const row = t.closest('tr[data-section]');
    if (row && t.dataset.audio) {
      const sectionId = row.dataset.section;
      let patch;
      if (t.dataset.audio === 'music') patch = t.value.startsWith('own:') ? { musicId: t.value.slice(4) } : { musicId: null, mood: t.value.slice(5) };
      else patch = { volume: t.value === '' ? null : Number(t.value) / 100 };
      return run(call('section.update', { id: S.project.id, sectionId, patch: { audio: patch } }).then(setProject));
    }
    window.DirectEditor?.change(t);
  });

  document.addEventListener('keydown', event => {
    if (!S.active || S.tab !== 'grabacion' || /input|textarea|select/i.test(event.target.tagName)) return;
    if (event.code === 'Space') { event.preventDefault(); DirectPrompter.toggle(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); DirectPrompter.jump(-1); }
    if (event.key === 'ArrowDown') { event.preventDefault(); DirectPrompter.jump(1); }
  });

  window.studio?.onDirectProgress?.(detail => {
    if (!S.active) return;
    if (detail.kind === 'master') {
      const s = S.project?.sections.find(x => x.id === detail.sectionId);
      if (s && detail.state === 'ready' && detail.take && s.take?.id === detail.take.id) { s.take = detail.take; if (S.tab === 'edicion') window.DirectEditor?.takeReady(s); }
      return;
    }
    if (detail.id && S.project && detail.id !== S.project.id) return;
    S.progress = { kind: detail.kind, percent: detail.percent || 0, message: detail.message };
    const float = view().querySelector('.dl-progress-float');
    if (float) { float.querySelector('strong').textContent = detail.message || ''; float.querySelector('.dl-progress span').style.width = (detail.percent || 0) + '%'; }
    else if (S.page === 'project') { view().querySelector('.dl-shell')?.insertAdjacentHTML('beforeend', progressPanel()); }
  });

  window.DirectLong = { activate, deactivate, state: S, call, render, refresh, section, fileUrl, esc, clock, btn, label, toast };
})();
