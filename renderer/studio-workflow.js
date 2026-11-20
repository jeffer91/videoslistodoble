'use strict';
(function () {
  const brands = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
  const statuses = {
    pendiente: 'Pendiente', programado: 'Programado', enviando: 'Enviando', procesando: 'Procesando en la red',
    publicado: 'Publicado', fallo: 'Falló', revisar: 'Revisar en la red', cancelado: 'Cancelado'
  };
  const privacyLabels = {
    private: 'Privado', unlisted: 'No listado', public: 'Público', SELF_ONLY: 'Solo yo',
    PUBLIC_TO_EVERYONE: 'Todo el mundo', MUTUAL_FOLLOW_FRIENDS: 'Amigos', FOLLOWER_OF_CREATOR: 'Seguidores'
  };
  const statsBrands = {...brands,facebook:"Facebook"};
  let ideas = [], jobs = [], accountData = {};
  let backup, editConfig, updateConfig, delivery, creator, loading, sheetData, sheetTab = "youtube";
  let projectLinks = [], linksProjectId, logTarget;
  let currentNetwork = 'youtube', currentScene = 'hook', month = '', activeTask = '';

  function flow(action, data = {}) {
    return api('studio:flow', { action, data });
  }

  function field(label, input) {
    return '<label class="field"><span>' + esc(label) + '</span>' + input + '</label>';
  }

  function select(id, choices, selected = '', attrs = '') {
    return '<select id="' + id + '" ' + attrs + '>' + choices.map(([value, label]) =>
      '<option value="' + esc(value) + '"' + (selected === value ? ' selected' : '') + '>' + esc(label) + '</option>'
    ).join('') + '</select>';
  }

  function input(id, val = '', attrs = '') {
    return '<input id="' + id + '" value="' + esc(val) + '" ' + attrs + '>';
  }

  function textarea(id, val = '', attrs = '') {
    return '<textarea id="' + id + '" ' + attrs + '>' + esc(val) + '</textarea>';
  }

  function checked(id, label, active, enabled = true) {
    return '<label class="workflow-checkbox"><input type="checkbox" id="' + id + '"' +
      (active ? ' checked' : '') + (enabled ? '' : ' disabled') + '> ' + esc(label) + '</label>';
  }

  function action(name, label, value, cls = 'secondary') {
    return btn(name, label, cls, value === undefined ? '' : 'data-id="' + esc(value) + '"');
  }

  function valueOf(id) {
    return $('#' + id)?.value ?? '';
  }

  function isChecked(id) {
    return $('#' + id)?.checked === true;
  }

  function localDay(date = new Date()) {
    const pad = digit => String(digit).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function fileName(file) {
    return String(file).split(/[\\/]/).at(-1);
  }

  function when(date) {
    return date ? new Date(date).toLocaleString('es-EC') : '—';
  }

  function panel(title, body) {
    return '<section class="panel workflow-panel"><h2>' + esc(title) + '</h2>' + body + '</section>';
  }

  function modal(title, body) {
    const container = $('#modal-root');
    container.hidden = false;
    container.innerHTML = '<div class="modalback"><div class="modal workflow-modal"><div class="row between">' +
      '<h2>' + esc(title) + '</h2>' + btn('modal-close', 'Cerrar', 'secondary') + '</div>' + body + '</div></div>';
  }

  function activity(message, percent) {
    const item = $('#studio-activity');
    if (!item || !activeTask) return;
    item.hidden = false;
    item.innerHTML = '<div class="row between wrap"><span>' + esc(message || activeTask) + '</span>' +
      btn('cancel-render', 'Cancelar', 'secondary') + '</div><progress aria-label="Avance de la operación" max="100"' +
      (Number.isFinite(percent) ? ' value="' + percent + '"' : '') + '></progress>';
  }

  async function run(label, procedure) {
    if (activeTask) throw Error('Espera a que termine la operación actual');
    activeTask = label;
    activity(label, 0);
    try {
      return await procedure();
    } finally {
      activeTask = '';
      const item = $('#studio-activity');
      if (item) item.hidden = true;
    }
  }

  function readyPanel() {
    const status = state.readiness;
    if (!status) return '';
    const entries = [
      ...(status.weekly >= 480 ? [{ text: 'Semanal · ' + fmt(status.weekly), action: btn('new-week', 'Crear video semanal') }] : []),
      ...status.categories.slice(0, 5).map(item => ({
        text: item.value + ' · ' + fmt(item.seconds),
        action: btn('quick-category', 'Crear video por categoría', 'secondary',
          'data-field="' + esc(item.field) + '" data-value="' + esc(item.value) + '"')
      }))
    ];
    return entries.length ? panel('Material para compilar', entries.map(entry =>
      '<div class="asset"><strong>' + esc(entry.text) + '</strong>' + entry.action + '</div>').join('')) : '';
  }

  function dashboard() {
    const today = localDay();
    const selected = month || today.slice(0, 7);
    const days = new Map();
    for (const project of state.projects.filter(item => item.status !== 'auxiliary' && item.plannedDate?.startsWith(selected))) {
      if (!days.has(project.plannedDate)) days.set(project.plannedDate, []);
      days.get(project.plannedDate).push(project);
    }
    const cards = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, projects]) =>
      '<div class="calendar-day"><strong>' + esc(new Date(date + 'T12:00:00').toLocaleDateString('es-EC',
        { weekday: 'long', day: 'numeric', month: 'long' })) + (date === today ? ' · Hoy' : '') + '</strong>' +
      projects.map(project => '<div class="asset"><span>' + esc(project.title) + ' <small>· ' +
        esc(Catalog.STAGE_LABELS[project.stage]) + '</small></span>' + action('open-record-card', 'Abrir', project.id) + '</div>').join('') + '</div>'
    ).join('');
    return titlebar('Calendario de producción', '', btn('new', 'Nuevo récord') + btn('ideas', 'Bandeja de ideas', 'secondary')) +
      readyPanel() + panel('Récords programados', field('Mes', input('calendar-month', selected, 'type="month"')) +
        (cards || '<div class="empty">Asigna una fecha desde la ficha del récord para añadirlo al calendario.</div>'));
  }

  function ideasPage() {
    return titlebar('Ideas', '', btn('idea-import', 'Importar ideas JSON', 'secondary')) +
      '<div class="workflow-columns">' + panel('Añadir una idea',
        field('Título del récord', input('idea-title', '', 'maxlength="120"')) +
        field('Fuente o enlace', input('idea-source', '', 'maxlength="1000"')) +
        field('Fecha de la fuente', input('idea-date', localDay(), 'type="date"')) +
        field('Notas', textarea('idea-notes', '', 'rows="3" maxlength="4000"')) + btn('idea-add', 'Guardar idea')) +
      panel('Bandeja', field('Fecha de producción para la siguiente idea aprobada', input('idea-planned', localDay(), 'type="date"')) +
        (ideas.length ? ideas.map(idea => '<article class="workflow-item"><div class="row between"><strong>' + esc(idea.title) +
          '</strong><span class="pill">' + esc(idea.status) + '</span></div><p class="muted mini">' + esc(idea.source) + ' · ' +
          esc(idea.date) + '</p>' + (idea.notes ? '<p>' + esc(idea.notes) + '</p>' : '') + '<div class="row wrap">' +
          (idea.status === 'aprobada' ? action('open-record-card', 'Abrir ficha', idea.projectId) :
            action('idea-approve', 'Aprobar', idea.id, '') + (idea.status === 'descartada' ?
              action('idea-reactivate', 'Volver a la bandeja', idea.id) : action('idea-discard', 'Descartar', idea.id))) + '</div></article>').join('') :
          '<div class="empty">Añade o importa ideas para revisarlas aquí.</div>')) + '</div>';
  }

  function reviewOutputOptions(kind, id, files) {
    const options = files.filter(Boolean).slice().reverse().map(file =>
      '<div class="asset"><span>' + esc(fileName(file)) + '</span><div class="row wrap">' +
      btn('delivery-open', 'Revisar MP4', 'secondary', 'data-kind="' + kind + '" data-id="' + esc(id) +
        '" data-file="' + esc(fileName(file)) + '"') + '</div></div>').join('');
    return options || '<p class="muted mini">Exporta el montaje para revisar el MP4 y preparar su publicación.</p>';
  }

  async function refreshProjectLinks(id) {
    const linked = await flow('publish.list', { target: { kind: 'short', id } });
    linksProjectId = id;
    projectLinks = linked;
  }

  function projectDeliveries(project) {
    const files = (project.exports || []).map(item => item.file);
    return panel('Exportaciones y publicaciones', reviewOutputOptions('short', project.id, files) +
      (linksProjectId === project.id ? projectLinks.filter(job => job.url).map(job =>
        '<div class="asset"><span>' + esc(brands[job.network]) + ' · ' + esc(when(job.publishedAt)) + '</span>' +
        btn('publish-open', 'Ver publicación', 'secondary', 'data-url="' + esc(job.url) + '" data-network="' + job.network + '"') +
        '</div>').join('') : ''));
  }

  function weekDeliveries(week) {
    return panel('Exportaciones y capítulos', reviewOutputOptions('week', week.id, week.outputs || []));
  }

  function backupPanel() {
    const backupValue = backup || {};
    return panel('Respaldo de la biblioteca', '<p>' + esc(backupValue.directory || 'Selecciona una carpeta fuera de la biblioteca.') + '</p>' +
      field('Intervalo (horas)', input('backup-hours', backupValue.hours || 24, 'type="number" min="1" max="168"')) +
      '<div class="row wrap">' + btn('backup-choose', 'Elegir destino') +
      (backupValue.directory ? btn('backup-schedule', 'Guardar intervalo', 'secondary') + btn('backup-run', 'Respaldar ahora', 'secondary') +
        btn('backup-disable', 'Desactivar', 'secondary') : '') + '</div>' +
      (backupValue.lastAt ? '<p class="muted mini">Último respaldo · ' + esc(when(backupValue.lastAt)) + '<br>' + esc(backupValue.lastPath) + '</p>' : '') +
      (backupValue.error ? '<p class="warning">' + esc(backupValue.error) + '</p>' : ''));
  }

  function accountsPanel() {
    return panel('Cuentas conectadas', '<p class="muted mini">Las mismas conexiones sirven para publicar y para medir. Se gestionan en Estadísticas → Conexiones.</p>' +
      Object.entries(statsBrands).map(([network, name]) =>
      '<div class="asset"><div><strong>' + name + '</strong><small>' + esc(accountData[network]?.label || 'Sin conectar') +
      '</small></div><div class="row wrap">' + action('account-open', accountData[network] ? 'Gestionar' : 'Conectar', network) + '</div></div>').join(''));
  }

  function settingsExtension() {
    return '<div class="workflow-columns">' + panel('Transcripción local',
      '<p class="muted mini">Whisper usa el micrófono de las tomas guardadas. Descarga una vez el motor y el modelo multilingüe (142 MiB).</p>' +
      '<p class="mini">' + esc(editConfig?.whisper || 'Motor pendiente') + '<br>' + esc(editConfig?.model || 'Modelo pendiente') + '</p>' +
      '<div class="row wrap">' + btn('whisper-install', 'Instalar Whisper') + action('whisper-choose', 'Elegir motor', 'whisper') +
      action('whisper-choose', 'Elegir modelo', 'model') + '</div>') + backupPanel() + accountsPanel() +
      panel('Actualizaciones', '<p>' + esc((updateConfig?.installed || '') + ' · ' + (updateConfig?.status || '')) + '</p>' +
        checked('update-auto', 'Buscar y descargar automáticamente', updateConfig?.automatic !== false) +
        (updateConfig?.message ? '<p class="muted mini">' + esc(updateConfig.message) + '</p>' : '') +
        '<div class="row wrap">' + btn('updates-check', 'Buscar actualización', 'secondary') +
        (updateConfig?.status === 'actualización disponible' ? btn('updates-download', 'Descargar', 'secondary') : '') +
        (updateConfig?.status === 'lista para instalar' ? btn('updates-install', 'Reiniciar e instalar') : '') + '</div>') + '</div>';
  }

  function workingPlan() {
    return structuredClone(state.project.editingPlan || { version: 1, source: 'manual', voice: 'original', captions: true, scenes: {} });
  }

  function planPage() {
    const project = state.project;
    const plan = workingPlan();
    const entry = plan.scenes[currentScene] || {};
    const track = project.transcripts?.[currentScene];
    const video = project.scenes[currentScene]?.video;
    const transcript = track?.assetId === video && track?.words ?
      track.words.map(word => word.start.toFixed(3) + ' | ' + word.end.toFixed(3) + ' | ' + word.text).join('\n') : '';
    const resources = project.assets.filter(asset => ['image', 'video'].includes(asset.type));
    const list = Object.entries({ texts: 'Rótulo', graphics: 'Gráfico', memes: 'Meme', cuts: 'Corte importado' })
      .flatMap(([key, label]) => (entry[key] || []).map((item, index) => '<div class="asset"><span><strong>' +
        esc(label) + '</strong> · ' + (item.start ?? item.at) + ' s ' +
        esc(item.text || resources.find(asset => asset.id === item.assetId)?.name || item.mode || '') + '</span>' +
        btn('plan-remove-item', 'Quitar', 'secondary', 'data-type="' + key + '" data-index="' + index + '"') + '</div>')).join('');
    return titlebar('Transcripción y plan de edición', project.title,
      action('open-record-card', 'Volver a la ficha', project.id) +
      btn('studio-transcribe', 'Transcribir') + btn('studio-plan-import', 'Importar plan JSON', 'secondary') +
      btn('studio-handoff', 'Exportar transcripción para Claude', 'secondary')) +
      '<div class="workflow-columns">' +
      panel('Plan de edición', '<div class="two">' + field('Escena', select('plan-scene', Object.entries(names), currentScene)) +
        field('Perfil de voz', select('plan-voice', [['original', 'Original'], ['limpia', 'Voz limpia'], ['podcast', 'Estudio'], ['exterior', 'Exterior']], plan.voice)) + '</div>' +
        checked('plan-captions', 'Mostrar subtítulos resaltados', plan.captions !== false) +
        field('Palabras para resaltar (separadas por comas)', input('plan-highlight', (entry.highlights || []).join(', '), 'maxlength="1000"')) +
        btn('plan-save-style', 'Guardar ajustes de edición', 'secondary') +
        '<p class="muted mini">Origen del plan · ' + (plan.source === 'claude' ? 'Claude' : 'Manual') + '</p>' +
        '<div class="list">' + list + '</div>' +
        '<div class="row wrap">' + action('plan-add-item', 'Añadir rótulo', 'texts') +
        action('plan-add-item', 'Añadir gráfico', 'graphics') + action('plan-add-item', 'Añadir meme', 'memes') + '</div>') +
      panel('Palabras y tiempos', '<p class="muted mini">Cada línea conserva el inicio y final en segundos del clip original.</p>' +
        textarea('transcription-times', transcript, 'rows="14" aria-label="Palabras con tiempos" spellcheck="false"') +
        btn('transcript-save', 'Guardar corrección', 'secondary', video ? '' : 'disabled')) + '</div>';
  }

  function itemModal(type) {
    const meme = type === 'memes';
    const graphics = type === 'graphics';
    const resources = state.project.assets.filter(asset => graphics ? asset.type === 'video' && /\.(webm|mov)$/i.test(asset.file) :
      ['video', 'image'].includes(asset.type));
    modal(meme ? 'Insertar meme' : graphics ? 'Insertar gráfico' : 'Añadir rótulo',
      '<p>Escena · ' + esc(names[currentScene]) + '</p><div class="two">' +
      field(meme ? 'Pausar en el segundo' : 'Aparece en el segundo', input('plan-item-start', '0', 'type="number" min="0" step=".01"')) +
      field(meme ? 'Duración de la pausa (s)' : 'Termina en el segundo', input('plan-item-end', '2', 'type="number" min=".1" step=".01"')) +
      '</div>' + (!meme ? field('Texto', input('plan-item-text', '', 'maxlength="63"')) : '') +
      (meme || graphics ? field(meme ? 'Imagen o clip del proyecto' : 'Video transparente de HyperFrames (opcional)',
        select('plan-item-asset', [['', 'Elegir recurso'], ...resources.map(asset => [asset.id, asset.name])])) : '') +
      action('plan-confirm-item', 'Guardar en esta escena', type, ''));
  }

  function queuePage() {
    return titlebar('Publicación', '', btn('publish-refresh', 'Actualizar cola', 'secondary')) +
      (jobs.length ? jobs.map(job => panel((job.metadata?.title || 'Video') + ' · ' + brands[job.network],
        '<div class="row between"><span class="pill">' + esc(statuses[job.status] || job.status) + '</span>' +
        '<small>' + esc(job.publishedAt ? when(job.publishedAt) : job.dueAt ? when(job.dueAt) : '') + '</small></div>' +
        (job.message ? '<p>' + esc(job.message) + '</p>' : '') + '<div class="row wrap">' +
        btn('delivery-open', 'Ver video y texto', 'secondary', 'data-kind="' + job.target.kind + '" data-id="' + esc(job.target.id) +
          '" data-file="' + esc(job.target.file) + '"') +
        (job.url ? btn('publish-open', 'Abrir en la red', 'secondary', 'data-url="' + esc(job.url) + '" data-network="' + job.network + '"') : '') +
        (['revisar', 'fallo'].includes(job.status) ? action('publish-retry-dialog', 'Reintentar', job.id) : '') +
        (['pendiente', 'programado', 'fallo', 'revisar'].includes(job.status) ? action('publish-cancel', 'Cancelar envío', job.id) : '') +
        (['publicado', 'revisar', 'fallo'].includes(job.status) ? action('publish-link-dialog', 'Registrar enlace', job.id) : '') + '</div>')).join('') :
        panel('Cola', '<p class="muted">Abre una exportación para preparar y aprobar su publicación.</p>'));
  }

  function deliveryPage() {
    if (!delivery) return titlebar('Entrega', 'Cargando exportación…');
    const { target, quality, approval, thumbnails, networks } = delivery;
    const base = [target.kind, target.id, target.file].map(encodeURIComponent).join('/');
    const video = 'records://output/' + base;
    const before = target.kind === 'short' ? action('open-record-card', 'Volver a la ficha', target.id) :
      action('open-week', 'Volver al video largo', target.id);
    const chosen = networks[currentNetwork];
    const isYouTube = currentNetwork === 'youtube';
    const isTikTok = currentNetwork === 'tiktok';
    const options = isYouTube ? ['private', 'unlisted', 'public'] : isTikTok ? creator?.privacy || [] : [];
    const canSend = approval && accountData[currentNetwork] && (!isTikTok || options.length);
    return titlebar('Revisar exportación', target.file, before + btn('publication', 'Cola', 'secondary')) +
      '<div class="workflow-columns">' + panel('Video y control de calidad',
        '<video controls preload="metadata" class="delivery-video ' + (target.kind === 'short' ? 'portrait' : '') +
        '" src="' + video + '"></video>' +
        (quality ? '<div class="list">' + quality.checks.map(check =>
          '<div class="asset"><span>' + esc(check.label) + '</span><strong class="' + (check.ok ? 'review-ok' : 'warning') +
          '">' + (check.ok ? '✓ ' : '') + esc(check.value) + '</strong></div>').join('') + '</div>' : '') +
        '<div class="row wrap">' + btn('delivery-quality', 'Verificar MP4', 'secondary') +
        (target.kind === 'week' ? btn('delivery-chapters', 'Ver capítulos', 'secondary') : '') + '</div>' +
        (approval ? '<p class="success">Video aprobado · ' + esc(when(approval.at)) + '</p>' :
        checked('delivery-confirm', 'Revisé el video y autorizo el uso de este archivo.', false) +
        btn('delivery-approve', 'Aprobar MP4', '', quality?.ok ? '' : 'disabled')) +
        sheetPanel()) +
      '<div>' + panel('Miniaturas',
        field('Texto de portada', input('cover-title', chosen.title, 'maxlength="120"')) +
        field('Segundo del fotograma', input('cover-time', chosen.coverTime, 'type="number" min="0" step=".1"')) +
        (target.kind === 'short' ? field('Imagen de apoyo (opcional)', select('cover-image', [['', 'Fotograma del video'],
          ...(state.project?.id === target.id ? state.project.assets.filter(item => item.type === 'image').map(item => [item.id, item.name]) : [])])) : '') +
        btn('delivery-thumbnails', 'Generar 3 variantes', 'secondary') +
        (thumbnails.length ? '<div class="thumbnail-grid">' + thumbnails.map((_, index) =>
          '<figure><img src="records://thumbnail/' + base + '/' + (index + 1) + '" alt="Miniatura ' + (index + 1) +
          '"><figcaption>Variante ' + (index + 1) + '</figcaption></figure>').join('') + '</div>' : '')) +
      panel('Publicación por red', field('Red', select('delivery-network', Object.entries(brands), currentNetwork)) +
        '<p class="mini">' + esc(accountData[currentNetwork]?.label || 'Conecta la cuenta en Estadísticas → Conexiones.') + '</p>' +
        field('Título', input('post-title', chosen.title, 'maxlength="100"')) +
        field('Descripción', textarea('post-description', chosen.description, 'rows="6" maxlength="' + (isYouTube ? 4700 : 1950) + '"')) +
        field('Etiquetas', input('post-tags', (chosen.tags || []).join(', '), 'maxlength="440"')) +
        (options.length ? field('Visibilidad', select('post-privacy', [['', 'Elige visibilidad'], ...options.map(key => [key, privacyLabels[key] || key])], chosen.privacy || '')) : '') +
        ((isYouTube || creator?.provider === 'ayrshare') ? field('Miniatura', select('post-thumbnail', [['0', 'Sin miniatura personalizada'],
          ...thumbnails.map((_, index) => [String(index + 1), 'Variante ' + (index + 1)])], String(chosen.thumbnail || 0))) +
          (isYouTube ? checked('post-kids', 'El contenido está dirigido a niños', chosen.madeForKids) : '') : '') +
        (!isYouTube ? field('Portada · segundo del video', input('post-cover-time', chosen.coverTime, 'type="number" min="0" step=".1"')) : '') +
        (currentNetwork === 'instagram' ? field('URL HTTPS de la portada (opcional)', input('post-cover-url', chosen.coverUrl || '', 'type="url"')) : '') +
        (isTikTok ? checked('post-comments', 'Permitir comentarios', chosen.comments, creator?.comments === true) +
          checked('post-duet', 'Permitir dúo', chosen.duet, creator?.duet === true) +
          checked('post-stitch', 'Permitir pegar', chosen.stitch, creator?.stitch === true) +
          checked('post-branded', 'Contenido patrocinado', chosen.branded) +
          checked('post-own-brand', 'Promociono mi propia marca', chosen.ownBrand) : '') +
        '<div class="row wrap">' + btn('delivery-metadata', 'Guardar texto', 'secondary') +
        action('publish-link-dialog', 'Registrar un enlace ya publicado') + '</div>' +
        (canSend ? '<div class="divider"></div>' + field('Programar (hora de este equipo)', input('post-schedule', '', 'type="datetime-local"')) +
          '<p class="muted mini">La aplicación debe estar abierta al llegar la hora. El envío se inicia tras tu autorización.</p>' +
          checked('post-confirm', 'Autorizo enviar este MP4 con estos datos a ' + brands[currentNetwork] + (creator?.provider === 'ayrshare' ? ' mediante Ayrshare.' : '.'), false) +
          btn('delivery-enqueue', 'Confirmar publicación') : '')) + '</div></div>';
  }

  const sheetNetworks = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };

  /** Ficha de publicación: se completa una vez y Studio la adapta a cada red. */
  function sheetPanel() {
    if (!sheetData) return '';
    const { sheet, saved, preview } = sheetData;
    const tab = sheetNetworks[sheetTab] ? sheetTab : 'youtube';
    const shown = preview?.[tab];
    return '<div class="divider"></div><div class="sheet-box"><div class="row between"><h3>Ficha de publicación</h3>' +
      (saved ? '<span class="pill ok-pill">Lista</span>' : '<span class="pill warn-pill">Obligatoria para publicar</span>') + '</div>' +
      (sheet.suggested ? '<p class="muted mini">Propuesta a partir del guion y las etiquetas del récord. Corrígela antes de guardar.</p>' : '') +
      field('Gancho (primera línea, lo que se ve sin abrir el texto)', input('sheet-hook', sheet.hook, 'maxlength="150"')) +
      field('Descripción', textarea('sheet-description', sheet.description, 'rows="3" maxlength="1500"')) +
      field('Hashtags específicos (3 a 5, separados por espacios)', input('sheet-hashtags', sheet.hashtags.map(tag => '#' + tag).join(' '), 'maxlength="220"')) +
      checked('sheet-ai', 'Tiene imágenes o voces generadas con IA que parecen reales (se declara en YouTube y TikTok)', sheet.aiRealistic) +
      field('Texto al compartir en el grupo de Facebook (opcional)', input('sheet-group', sheet.groupText, 'maxlength="500"')) +
      '<div class="row wrap">' + btn('delivery-sheet', saved ? 'Actualizar ficha' : 'Guardar ficha') + '</div>' +
      (preview ? '<div class="sheet-tabs">' + Object.entries(sheetNetworks).map(([key, label]) =>
        '<button type="button" data-action="sheet-tab" data-id="' + key + '" class="' + (key === tab ? 'active' : '') + '">' + label + '</button>').join('') + '</div>' +
        '<pre class="sheet-preview">' + esc(shown.text) + '</pre>' +
        '<p class="mini muted">' + shown.characters + ' caracteres · ' + shown.hashtags + ' de ' + shown.limit + ' hashtags permitidos' +
        (tab === 'youtube' ? ' · Título: ' + esc(shown.title) : '') + '</p>' : '') + '</div>';
  }

  function linkDialog(id) {
    const job = jobs.find(item => item.id === id);
    logTarget = job ? { target: job.target, network: job.network, jobId: id } :
      { target: delivery.target, network: currentNetwork };
    modal('Registrar publicación en ' + brands[logTarget.network],
      field('Enlace al video publicado', input('external-url', job?.url || '', 'type="url"')) +
      (logTarget.network !== 'youtube' ? field('ID del video para estadísticas (si lo tienes)', input('external-id', job?.externalId || '', 'inputmode="numeric"')) : '') +
      field('Fecha y hora de publicación', input('external-date', '', 'type="datetime-local"')) +
      btn('publish-save-link', 'Guardar enlace'));
  }

  async function navigateTo(page) {
    state.page = page;
    loading = page;
    try {
      if (page === 'dashboard') await loadLibrary();
      state.status = '';
      if (page === 'ideas') ideas = await flow('idea.list');
      if (page === 'publication') jobs = await flow('publish.list');
      if (page === 'statistics') await Statistics.load();
      if (page === 'settings') {
        [backup, editConfig, updateConfig, accountData] = await Promise.all([
          flow('backup.status'), flow('edit.settings'), flow('updates.status'), flow('accounts.list')
        ]);
      }
    } finally {
      loading = '';
      render();
    }
  }

  async function setNetwork(network) {
    currentNetwork = network;
    creator = null;
    if (network === 'tiktok' && accountData.tiktok) {
      try {
        creator = await flow('accounts.tiktok');
      } catch (error) {
        notice(error.message, true);
      }
    }
    render();
  }

  async function openDelivery(target) {
    [delivery, accountData, sheetData] = await Promise.all([flow('export.entry', { target }), flow('accounts.list'), flow('export.sheet', { target })]);
    if (target.kind === 'short' && target.id !== state.project?.id) state.project = await api('projects:get', { id: target.id });
    state.page = 'delivery';
    await setNetwork('youtube');
  }

  async function saveText() {
    const data = {
      title: valueOf('post-title'), description: valueOf('post-description'), tags: valueOf('post-tags'),
      privacy: currentNetwork === 'instagram' ? 'public' : valueOf('post-privacy'),
      thumbnail: valueOf('post-thumbnail'), coverUrl: valueOf('post-cover-url'),
      coverTime: valueOf('post-cover-time'), madeForKids: isChecked('post-kids'),
      comments: isChecked('post-comments'), duet: isChecked('post-duet'), stitch: isChecked('post-stitch'),
      branded: isChecked('post-branded'), ownBrand: isChecked('post-own-brand')
    };
    delivery = await flow('export.metadata', { target: delivery.target, network: currentNetwork, value: data });
  }

  async function reloadProject() {
    state.project = await api('projects:get', { id: state.project.id });
    await loadLibrary();
  }

  async function savePlan(plan) {
    await flow('edit.plan', { id: state.project.id, value: plan });
    await reloadProject();
    render();
  }

  async function handle(name, element) {
    const id = element.dataset.id;
    if (['dashboard', 'ideas', 'publication', 'statistics', 'settings'].includes(name)) return navigateTo(name);
    if (name === 'idea-add' || name === 'idea-import') {
      if (name === 'idea-import') await flow('idea.import');
      else await flow('idea.add', { value: { title: valueOf('idea-title'), source: valueOf('idea-source'),
        date: valueOf('idea-date'), notes: valueOf('idea-notes') } });
      return navigateTo('ideas');
    }
    if (['idea-approve', 'idea-discard', 'idea-reactivate'].includes(name)) {
      const decision = { 'idea-approve': 'aprobada', 'idea-discard': 'descartada', 'idea-reactivate': 'pendiente' }[name];
      const decided = await flow('idea.decide', { id, decision, plannedDate: valueOf('idea-planned') });
      await loadLibrary();
      if (decided.projectId) return Factory.openRecordCard(decided.projectId);
      return navigateTo('ideas');
    }
    if (name === 'project-square') {
      await run('Convirtiendo a cuadrado', () => flow('square', { projectId: state.project.id, assetId: id }));
      await refreshProjectAssets();
      return notice('Copia cuadrada disponible en los recursos');
    }
    if (name === 'backup-choose' || name === 'backup-schedule' || name === 'backup-run' || name === 'backup-disable') {
      const operation = { 'backup-choose': 'backup.choose', 'backup-schedule': 'backup.schedule',
        'backup-run': 'backup.run', 'backup-disable': 'backup.schedule' }[name];
      element.disabled = true;
      try {
        backup = await flow(operation, { hours: Number(valueOf('backup-hours')), enabled: name !== 'backup-disable' });
        render();
      } finally {
        element.disabled = false;
      }
      return;
    }
    if (name === 'account-open') {
      Statistics.openConnections(id);
      return navigateTo('statistics');
    }
    if (name.startsWith('updates-')) {
      if (name === 'updates-install') return flow('updates.install');
      const method = name === 'updates-check' ? 'updates.check' : 'updates.download';
      element.disabled = true;
      try {
        await flow(method);
        updateConfig = await flow('updates.status');
        render();
      } finally {
        element.disabled = false;
      }
      return;
    }
    if (name === 'whisper-choose' || name === 'whisper-install') {
      editConfig = name === 'whisper-choose' ? await flow('edit.choose', { type: id }) :
        await run('Instalando Whisper', () => flow('edit.install'));
      render();
      return;
    }
    if (name === 'studio-editing') {
      if (state.page === 'record-card') await Factory.saveCard(true);
      currentScene = state.scene;
      state.page = 'studio-editing';
      return render();
    }
    if (name === 'studio-script-import') {
      if (state.page === 'record-card') await Factory.saveCard(true);
      const imported = await flow('edit.script', { id: state.project.id });
      if (imported) await Factory.openRecordCard(state.project.id);
      return;
    }
    if (name === 'studio-transcribe') {
      await run('Transcribiendo los videos originales', () => flow('edit.transcribe', { id: state.project.id }));
      await reloadProject();
      return render();
    }
    if (name === 'studio-plan-import') {
      if (await flow('edit.plan', { id: state.project.id })) {
        await reloadProject();
        render();
      }
      return;
    }
    if (name === 'studio-week-import') {
      if (await flow('edit.week', { id: state.week.id })) await openWeek(state.week.id);
      return;
    }
    if (name === 'studio-handoff') {
      const file = await flow('edit.handoff', { id: state.project?.id });
      return modal('Archivo listo', '<p>' + esc(file) + '</p>' +
        btn('system-open-data', 'Abrir archivo', 'secondary', 'data-path="' + esc(file) + '"'));
    }
    if (name === 'system-open-data') return api('system:open-path', { path: element.dataset.path });
    if (name === 'plan-save-style') {
      const plan = workingPlan();
      plan.voice = valueOf('plan-voice');
      plan.captions = isChecked('plan-captions');
      plan.scenes[currentScene] ||= {};
      plan.scenes[currentScene].highlights = valueOf('plan-highlight').split(',').map(text => text.trim()).filter(Boolean);
      return savePlan(plan);
    }
    if (name === 'plan-add-item') return itemModal(id);
    if (name === 'plan-remove-item') {
      const plan = workingPlan();
      plan.scenes[currentScene][element.dataset.type].splice(Number(element.dataset.index), 1);
      return savePlan(plan);
    }
    if (name === 'plan-confirm-item') {
      const plan = workingPlan();
      const entry = plan.scenes[currentScene] ||= {};
      const start = Number(valueOf('plan-item-start'));
      const end = Number(valueOf('plan-item-end'));
      const assetId = valueOf('plan-item-asset');
      const text = valueOf('plan-item-text');
      if (id === 'memes' && !assetId || id !== 'memes' && !assetId && !text.trim()) throw Error('Elige un recurso o escribe el rótulo');
      (entry[id] ||= []).push(id === 'memes' ? { at: start, duration: end, assetId } : { start, end, text, assetId });
      await savePlan(plan);
      return Recording.close();
    }
    if (name === 'transcript-save') {
      const words = valueOf('transcription-times').trim().split(/\r?\n/).filter(Boolean).map(line => {
        const [start, end, ...pieces] = line.split('|');
        return { start: Number(start), end: Number(end), text: pieces.join('|').trim() };
      });
      await flow('edit.transcript', { id: state.project.id, scene: currentScene,
        assetId: state.project.scenes[currentScene].video, words });
      await reloadProject();
      return render();
    }
    if (name === 'delivery-open') {
      return openDelivery({ kind: element.dataset.kind, id, file: element.dataset.file });
    }
    if (name === 'delivery-quality') {
      await run('Comprobando todo el video', () => flow('export.quality', { target: delivery.target }));
      delivery = await flow('export.entry', { target: delivery.target });
      return render();
    }
    if (name === 'delivery-approve') {
      delivery = await run('Verificando el MP4 aprobado', () => flow('export.approve',
        { target: delivery.target, confirmed: isChecked('delivery-confirm') }));
      return render();
    }
    if (name === 'delivery-sheet') {
      sheetData = await run('Guardando la ficha', () => flow('export.saveSheet', { target: delivery.target, value: {
        hook: valueOf('sheet-hook'), description: valueOf('sheet-description'), hashtags: valueOf('sheet-hashtags'),
        aiRealistic: isChecked('sheet-ai'), groupText: valueOf('sheet-group') } }));
      notice('Ficha guardada. Así se verá en cada red.');
      return render();
    }
    if (name === 'sheet-tab') {
      sheetTab = id;
      return render();
    }
    if (name === 'delivery-chapters') {
      const chapters = await flow('export.chapters', { target: delivery.target });
      return modal('Capítulos para la descripción', textarea('chapters-copy', chapters, 'rows="10" readonly'));
    }
    if (name === 'delivery-thumbnails') {
      delivery = await run('Generando las tres portadas', () => flow('export.thumbnails', { target: delivery.target,
        values: { title: valueOf('cover-title'), time: Number(valueOf('cover-time')), assetId: valueOf('cover-image') } }));
      return render();
    }
    if (name === 'delivery-metadata') {
      await saveText();
      return notice('Texto guardado junto al video');
    }
    if (name === 'delivery-enqueue') {
      const confirmed = isChecked('post-confirm');
      if (!confirmed) throw Error('Autoriza el envío a la cuenta mostrada');
      element.disabled = true;
      const date = valueOf('post-schedule');
      try {
        await saveText();
        await flow('publish.add', { target: delivery.target, network: currentNetwork, dueAt: date, confirmed });
        await navigateTo('publication');
      } finally {
        element.disabled = false;
      }
      return;
    }
    if (name === 'publish-refresh') return navigateTo('publication');
    if (name === 'publish-open') return flow('publish.open', { network: element.dataset.network, url: element.dataset.url });
    if (name === 'publish-cancel') {
      await flow('publish.change', { id, action: 'cancelar' });
      return navigateTo('publication');
    }
    if (name === 'publish-retry-dialog') {
      return modal('Reintentar entrega', '<p>Revisa la cuenta antes de repetir una entrega cuyo estado figura como desconocido.</p>' +
        checked('retry-confirm', 'Verifiqué la publicación y autorizo el reintento.', false) + action('publish-retry', 'Reintentar', id, ''));
    }
    if (name === 'publish-retry') {
      await flow('publish.change', { id, action: 'reintentar', confirmed: isChecked('retry-confirm') });
      await Recording.close();
      return navigateTo('publication');
    }
    if (name === 'publish-link-dialog') return linkDialog(id);
    if (name === 'publish-save-link') {
      await flow('publish.link', { ...logTarget, url: valueOf('external-url'), externalId: valueOf('external-id'), publishedAt: valueOf('external-date') });
      await Recording.close();
      return navigateTo('publication');
    }
  }

  const recognized = new Set(['dashboard', 'ideas', 'publication', 'statistics', 'settings', 'idea-add', 'idea-import', 'idea-approve',
    'idea-discard', 'idea-reactivate', 'project-square', 'system-open-data', 'whisper-choose', 'whisper-install']);
  const prefixes = ['backup-', 'account-', 'updates-', 'studio-', 'plan-', 'transcript-', 'delivery-', 'publish-'];
  document.addEventListener('click', event => {
    const element = event.target.closest('[data-action]');
    const name = element?.dataset.action;
    if (!name || !(recognized.has(name) || prefixes.some(prefix => name.startsWith(prefix)))) return;
    handle(name, element).catch(error => notice(error.message, true));
  });

  document.addEventListener('change', event => {
    const id = event.target.id;
    const current = event.target.value;
    if (id === 'calendar-month') { month = current; render(); }
    if (id === 'plan-scene') { currentScene = current; render(); }
    if (id === 'delivery-network') setNetwork(current).catch(error => notice(error.message, true));
    if (id === 'update-auto') flow('updates.enable', { automatic: event.target.checked }).catch(error => notice(error.message, true));
  });

  function page(name) {
    const pages = { dashboard, ideas: ideasPage, 'studio-editing': planPage, publication: queuePage, statistics: () => Statistics.page(), autopublish: () => AutoPublish.page(), delivery: deliveryPage };
    if (loading === name) return titlebar('Cargando…', '');
    return pages[name]?.() || '';
  }

  window.StudioWorkflow = { page, readyPanel, settingsExtension, refreshProjectLinks, projectDeliveries, weekDeliveries, flow, activity };
})();
