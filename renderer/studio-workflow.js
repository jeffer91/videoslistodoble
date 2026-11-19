'use strict';
(function () {
  const brands = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };
  const statuses = {
    pendiente: 'Pendiente', programado: 'Programado', enviando: 'Enviando', procesando: 'Procesando en la red',
    publicado: 'Publicado', fallo: 'Falló', revisar: 'Revisar en la red', cancelado: 'Cancelado'
  };
  const privacyLabels = {
    private: 'Privado', unlisted: 'No listado', public: 'Público', SELF_ONLY: 'Solo yo',
    PUBLIC_TO_EVERYONE: 'Todo el mundo', MUTUAL_FOLLOW_FRIENDS: 'Amigos', FOLLOWER_OF_CREATOR: 'Seguidores'
  };
  const statsBrands = {...brands,facebook:"Facebook"};
  let syncStatus = {};
  let ideas = [], jobs = [], stats = [], accountData = {};
  let backup, editConfig, updateConfig, delivery, creator, loading;
  let projectLinks = [], linksProjectId, logTarget;
  let currentNetwork = 'youtube', currentScene = 'hook', month = '', activeTask = '';
  const statsFilters = { network: '', tag: '', week: '' };

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
    return panel('Cuentas conectadas', Object.entries(statsBrands).map(([network, name]) =>
      '<div class="asset"><div><strong>' + name + '</strong><small>' + esc(accountData[network]?.label || 'Sin conectar') +
      '</small></div><div class="row wrap">' + action('account-open', accountData[network] ? 'Cambiar' : 'Conectar', network) +
      (accountData[network] ? action('account-disconnect', 'Desconectar', network) : '') + '</div></div>').join(''));
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

  function accountModal(network) {
    const youtube = network === 'youtube';
    const meta = network === 'instagram' || network === 'facebook';
    const intro = youtube ? 'Usa un cliente OAuth de escritorio con YouTube Data API y YouTube Analytics activos. Tu navegador solicitará elegir el canal.' :
      network === 'facebook' ? 'Introduce el ID y el token de tu página con pages_read_engagement, pages_manage_engagement y read_insights para consultar sus videos.' :
      meta ? 'Usa el ID de tu perfil profesional enlazado y un token de Meta con permisos de publicación y estadísticas.' :
        'Para estadísticas, autoriza video.list en tu cliente de TikTok. Para publicar, añade video.publish. La visibilidad depende de la aprobación que otorgue TikTok.';
    modal('Conectar ' + statsBrands[network], '<p>' + esc(intro) + '</p>' +
      (!meta ? field(youtube ? 'Client ID de Google' : 'Client key de TikTok', input('auth-client', '', 'autocomplete="off"')) +
        field('Client secret', input('auth-secret', '', 'type="password" autocomplete="new-password"')) :
        field(network==='facebook'?'ID de la página':'ID del perfil profesional', input('auth-profile', '', 'inputmode="numeric"'))) +
      (youtube ? action('account-google', 'Autorizar canal en Google', network, '') : '') +
      (network === 'tiktok' ? field('Servicio', select('auth-provider', [
        ['ayrshare', 'Ayrshare · cuenta ya vinculada'], ['direct', 'TikTok Direct Post · cliente propio']
      ], 'direct')) + '<p class="muted mini">Para Ayrshare introduce la clave del servicio en el campo de acceso y el Profile-Key (si usas un perfil secundario).</p>' +
        field('Profile-Key de Ayrshare (opcional)', input('auth-profile', '', 'type="password" autocomplete="new-password"')) : '') +
      '<details ' + (youtube ? '' : 'open') + '><summary>Conectar con token existente</summary>' +
      field('Token de acceso', input('auth-token', '', 'type="password" autocomplete="new-password"')) +
      (!meta ? field('Token de renovación', input('auth-refresh', '', 'type="password" autocomplete="new-password"')) : '') +
      field('Vence el (opcional)', input('auth-expires', '', 'type="datetime-local"')) +
      action('account-connect', 'Verificar y conectar', network, '') + '</details>');
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
        btn('delivery-approve', 'Aprobar MP4', '', quality?.ok ? '' : 'disabled'))) +
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
        '<p class="mini">' + esc(accountData[currentNetwork]?.label || 'Conecta la cuenta en Configuración.') + '</p>' +
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

  function weekOf(value) {
    if(!value || !Number.isFinite(Date.parse(value)))return '';
    const date = new Date(value);
    date.setDate(date.getDate() - (date.getDay() + 6) % 7);
    return localDay(date);
  }

  function tagList(item) {
    return Object.values(item.tags || {}).flat();
  }

  function rank(rows, keys, title) {
    const groups = new Map();
    for (const row of rows.filter(item => item.metrics)) {
      for (const key of keys(row)) {
        const value = groups.get(key) || { label: key, views: 0, posts: 0, retention: 0, samples: 0 };
        value.posts++;
        value.views += row.metrics.views || 0;
        if (row.metrics.retention !== null && row.metrics.retention !== undefined) {
          value.samples++;
          value.retention += row.metrics.retention;
        }
        groups.set(key, value);
      }
    }
    const items = [...groups.values()].sort((a, b) => b.views - a.views).slice(0, 8);
    return panel(title, items.length ? items.map(item => '<div class="asset"><span>' + esc(item.label) +
      '<small> · ' + item.posts + ' publicaciones</small></span><strong>' + number(item.views) + ' vistas' +
      (item.samples ? ' · ' + number(item.retention / item.samples, true) : '') + '</strong></div>').join('') :
      '<p class="muted mini">Sin métricas para esos filtros.</p>');
  }

  function number(value, percent = false) {
    const digits = percent ? 1 : 0;
    return value == null ? '—' : new Intl.NumberFormat('es-EC', { maximumFractionDigits: digits }).format(value) + (percent ? ' %' : '');
  }

  function statsPage() {
    const tags = [...new Set(stats.flatMap(tagList))].sort((a, b) => a.localeCompare(b, 'es'));
    const weeks = [...new Set(stats.map(item => weekOf(item.publishedAt)).filter(Boolean))].sort().reverse();
    const rows = stats.filter(item => (!statsFilters.network || item.network === statsFilters.network) &&
      (!statsFilters.tag || tagList(item).includes(statsFilters.tag)) && (!statsFilters.week || weekOf(item.publishedAt) === statsFilters.week));
    const metrics = ['views', 'likes', 'comments', 'shares'];
    return titlebar('Estadísticas', '', btn('stats-refresh', 'Sincronizar por API') + btn('stats-browser','Leer desde navegador','secondary') + btn('settings','Conectar cuentas','secondary') + btn('stats-export', 'Exportar datos para Claude', 'secondary')) +
      (syncStatus.at?'<p>Última consulta: '+esc(when(syncStatus.at))+'</p>':'') +
      (syncStatus.errors?.length?'<details class="warning"><summary>Consulta incompleta</summary>'+syncStatus.errors.map(esc).join('<br>')+'</details>':'') +
      panel('Rendimiento por video', '<div class="workflow-filters">' +
        field('Red', select('stats-network', [['', 'Todas'], ...Object.entries(statsBrands)], statsFilters.network)) +
        field('Categoría', select('stats-tag', [['', 'Todas'], ...tags.map(tag => [tag, tag])], statsFilters.tag)) +
        field('Semana del', select('stats-week', [['', 'Todas'], ...weeks.map(week => [week, week])], statsFilters.week)) + '</div>' +
        (rows.length ? '<div class="workflow-table"><table><thead><tr><th>Video</th><th>Red</th><th>Publicado</th><th>Vistas</th><th>Me gusta</th>' +
        '<th>Comentarios</th><th>Compartidos</th><th>Datos</th></tr></thead><tbody>' + rows.map(item =>
          '<tr><th>' + esc(item.title) + '</th><td>' + statsBrands[item.network] + '</td><td>' + esc(item.publishedAt?when(item.publishedAt):item.dateText||'—')+'</td>' +
          metrics.map(key => '<td>' + number(item.metrics?.[key], key === 'retention') + '</td>').join('') +
          '<td>' + action('stats-detail', 'Ver detalle', item.id) + (item.localJob?action('stats-manual-dialog', 'Editar métricas', item.id):'') +
          (item.metricsError ? '<small class="muted">' + esc(item.metricsError) + '</small>' : '') + '</td></tr>').join('') +
        '</tbody></table></div>' : '<p class="muted">Conecta una cuenta para sincronizar por API o elige Leer desde navegador.</p>')) +
      '<div class="workflow-columns">' + rank(rows, row => row.hook ? [row.hook] : [], 'Ganchos con más vistas') +
      rank(rows, row => row.tags.tipos || [], 'Temas con más vistas') +
      rank(rows, row => row.tags.jugadores || [], 'Jugadores con más vistas') + '</div>';
  }

  function statsModal(id) {
    const job = stats.find(item => item.id === id);
    const labels = { views: 'Vistas', likes: 'Me gusta', comments: 'Comentarios', retention: 'Retención (%)', followers: 'Seguidores' };
    modal('Métricas registradas por ti', '<p>' + esc(job.title) + ' · ' + esc(brands[job.network]) + '</p>' +
      Object.entries(labels).map(([key, label]) => field(label, input('metric-' + key, job.metrics?.[key] ?? '',
        'type="number" min="0" step="' + (key === 'retention' ? '.01' : '1') + '"'))).join('') +
      action('stats-manual-save', 'Guardar cifras', id, ''));
  }

  async function navigateTo(page) {
    state.page = page;
    loading = page;
    try {
      if (page === 'dashboard') await loadLibrary();
      state.status = '';
      if (page === 'ideas') ideas = await flow('idea.list');
      if (page === 'publication') jobs = await flow('publish.list');
      if (page === 'statistics') [stats,syncStatus] = await Promise.all([flow('statistics.list'),flow('statistics.status')]);
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
    [delivery, accountData] = await Promise.all([flow('export.entry', { target }), flow('accounts.list')]);
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
    if (name === 'account-open') return accountModal(id);
    if (name === 'account-connect' || name === 'account-google') {
      const data = { clientId: valueOf('auth-client'), clientSecret: valueOf('auth-secret'),
        provider: valueOf('auth-provider'), profileId: valueOf('auth-profile'), accessToken: valueOf('auth-token'),
        refreshToken: valueOf('auth-refresh'), expiresAt: valueOf('auth-expires') };
      element.disabled = true;
      try {
        if (name === 'account-google') {
          notice('Elige tu canal en el navegador');
          await flow('accounts.google', data);
        } else await flow('accounts.connect', { network: id, data });
        await Recording.close();
        await navigateTo('settings');
        notice('Cuenta verificada y guardada con cifrado del equipo');
      } finally {
        element.disabled = false;
      }
      return;
    }
    if (name === 'account-disconnect') {
      await flow('accounts.disconnect', { network: id });
      return navigateTo('settings');
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
    if (name === 'studio-handoff' || name === 'stats-export') {
      const file = await flow(name === 'stats-export' ? 'statistics.export' : 'edit.handoff', { id: state.project?.id });
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
    if (name === 'stats-detail') {
      const row=stats.find(v=>v.id===id);
      if(!row)return;
      const show=value=>esc(value==null?'No disponible':typeof value==='object'?JSON.stringify(value):String(value));
      const labels={views:'Vistas',likes:'Me gusta',comments:'Comentarios',shares:'Compartidos',followers:'Seguidores de la cuenta',
        retention:'Porcentaje medio visto',saved:'Guardados',reach:'Alcance',averageViewDuration:'Duración media vista (s)',
        estimatedMinutesWatched:'Minutos vistos',ig_reels_avg_watch_time:'Tiempo medio visto (ms)'};
      const entries=(metrics,origins={})=>Object.entries(metrics||{}).map(([k,v])=>'<div class="asset"><span>'+esc(labels[k]||k)+(origins[k]?' · '+esc(origins[k].source==='red'?'API':'Navegador')+' · '+esc(when(origins[k].at)):'')+'</span><strong>'+show(v)+'</strong></div>').join('');
      modal(row.title,'<p>'+esc(statsBrands[row.network])+' · '+esc(row.identity?.label)+' · Publicado: '+esc(row.publishedAt?when(row.publishedAt):row.dateText||'—')+'</p>'+
        (row.url?'<p>'+esc(row.url)+'</p>':'')+entries(row.metrics,row.metricOrigins)+
        (row.manualMetrics?'<details><summary>Cifras manuales</summary>'+entries(row.manualMetrics)+'</details>':'')+
        '<h3>Historial de mediciones</h3>'+(row.history||[]).slice().reverse().map(h=>'<details><summary>'+esc(when(h.at))+' · '+(h.source==='navegador'?'Navegador':'API')+'</summary>'+entries(h.metrics)+'</details>').join(''));
      return;
    }
    if (name === 'stats-browser') {
      return modal('Leer desde navegador','<p>Elige una red. Se abrirá un navegador para que selecciones tu cuenta y tu listado de videos.</p>'+
        Object.entries(statsBrands).map(([key,label])=>action('stats-browser-open',label,key)).join(''));
    }
    if (name === 'stats-browser-open') {
      const buttons=element.parentElement.querySelectorAll('button');
      buttons.forEach(b=>b.disabled=true);
      element.textContent='Preparando navegador…';
      try {
        const result=await flow('statistics.browser',{network:id});
        await Recording.close();
        await navigateTo('statistics');
        if (!result.canceled) notice(result.count+' videos con métricas · '+result.missing+' identificados sin cifras. La lectura depende del listado visible.', !result.count || result.missing>0);
      } finally {buttons.forEach(b=>b.disabled=false);element.textContent=statsBrands[id];}
      return;
    }
    if (name === 'stats-refresh') {
      element.disabled = true;
      element.textContent = 'Consultando cuentas y videos…';
      try {
        const result = await flow('statistics.refresh');
        await navigateTo('statistics');
        notice(result.count + ' publicaciones actualizadas' + (result.errors.length ? ' · ' + result.errors[0] : ''), result.errors.length > 0);
      } finally {
        element.disabled = false; element.textContent='Sincronizar por API';
      }
      return;
    }
    if (name === 'stats-manual-dialog') return statsModal(id);
    if (name === 'stats-manual-save') {
      stats = await flow('statistics.manual', { id, values: Object.fromEntries(
        ['views', 'likes', 'comments', 'retention', 'followers'].map(key => [key, valueOf('metric-' + key)])
      ) });
      await Recording.close();
      return render();
    }
  }

  const recognized = new Set(['dashboard', 'ideas', 'publication', 'statistics', 'settings', 'idea-add', 'idea-import', 'idea-approve',
    'idea-discard', 'idea-reactivate', 'project-square', 'system-open-data', 'whisper-choose', 'whisper-install']);
  const prefixes = ['backup-', 'account-', 'updates-', 'studio-', 'plan-', 'transcript-', 'delivery-', 'publish-', 'stats-'];
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
    if (id.startsWith('stats-') && Object.hasOwn(statsFilters, id.slice(6))) {
      statsFilters[id.slice(6)] = current;
      render();
    }
  });

  function page(name) {
    const pages = { dashboard, ideas: ideasPage, 'studio-editing': planPage, publication: queuePage, statistics: statsPage, delivery: deliveryPage };
    if (loading === name) return titlebar('Cargando…', '');
    return pages[name]?.() || '';
  }

  window.StudioWorkflow = { page, readyPanel, settingsExtension, refreshProjectLinks, projectDeliveries, weekDeliveries, flow, activity };
})();
