'use strict';
/*
 * Publicación automática · publica los videos aprobados en YouTube, TikTok,
 * Instagram y Facebook, adaptados a cada red y sin repetir contenido.
 * La lógica vive en backend/autopublish.cjs; aquí solo se muestra y se configura.
 */
(function () {
  const NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
  const ORDER = ['youtube', 'tiktok', 'instagram', 'facebook'];
  const STATUS = { pendiente: 'Pendiente', programado: 'Programado', enviando: 'Enviando', procesando: 'Procesando',
    publicado: 'Publicado', fallo: 'Falló', revisar: 'Revisar', cancelado: 'Cancelado' };
  let data = null;

  const flow = (action, payload) => StudioWorkflow.flow(action, payload);
  const badge = n => '<span class="st-badge st-' + n + '">' + NAMES[n] + '</span>';
  const when = value => value ? new Date(value).toLocaleString('es-EC', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const minutes = s => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
  const action = (name, label, id, cls = 'secondary') => btn(name, label, cls, id === undefined ? '' : 'data-id="' + esc(id) + '"');
  const field = (label, control) => '<label class="st-field"><span>' + esc(label) + '</span>' + control + '</label>';
  const check = (id, label, on) => '<label class="ap-check"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '> ' + esc(label) + '</label>';
  const value = id => document.getElementById(id)?.value ?? '';
  const checked = id => document.getElementById(id)?.checked === true;

  async function load() { data = await flow('auto.overview'); }

  function page() {
    if (!data) return titlebar('Publicación automática', 'Cargando…');
    const cfg = data.config;
    const running = cfg.enabled && cfg.authorized;
    return '<div class="st ap">' + titlebar('Publicación automática',
      'Studio publica tus videos aprobados en los horarios que elijas, adaptados a cada red y sin repetir contenido.',
      (cfg.authorized ? btn('ap-plan', 'Planificar ahora', 'secondary') +
        btn('ap-toggle', running ? 'Pausar' : 'Activar', running ? 'outline' : '') : '')) +
      statusBar(cfg, running) + '<div class="ap-networks">' + ORDER.map(card).join('') + '</div>' +
      globalPanel(cfg) + upcomingPanel() + matrixPanel() + recentPanel() + '</div>';
  }

  function statusBar(cfg, running) {
    if (!cfg.authorized) {
      return '<section class="st-reader"><h2>Autoriza la publicación automática</h2>' +
        '<p>Studio solo publica videos que tú ya revisaste y aprobaste en la pantalla de entrega. Cada video va una sola vez a cada cuenta, con el texto adaptado a cada red.</p>' +
        check('ap-authorize', 'Autorizo a Studio a publicar automáticamente mis videos aprobados en las redes que active.', false) +
        '<div class="row wrap">' + action('ap-authorize-save', 'Autorizar y activar', '', '') + '</div></section>';
    }
    const ready = ORDER.filter(n => cfg.networks[n].enabled && data.readiness[n].ok).map(n => NAMES[n]);
    return '<div class="st-syncbar"><span><strong class="' + (running ? 'ap-on' : 'ap-off') + '">' + (running ? '● Activa' : '● Pausada') + '</strong></span><i></i>' +
      '<span>Publicando en: <strong>' + esc(ready.join(', ') || 'ninguna red todavía') + '</strong></span><i></i>' +
      '<span>Última planificación: <strong>' + esc(cfg.lastPlanAt ? when(cfg.lastPlanAt) : 'todavía no') + '</strong>' +
      (cfg.lastCreated ? ' · ' + cfg.lastCreated + ' programados' : '') + '</span></div>' +
      (cfg.lastErrors?.length ? '<details class="st-alert"><summary>Avisos de la última planificación (' + cfg.lastErrors.length + ')</summary><ul>' +
        cfg.lastErrors.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></details>' : '');
  }

  function readinessChip(network) {
    const r = data.readiness[network], account = data.accounts[network];
    if (r.browser) return '<span class="st-status on">Lista · navegador</span>';
    if (!account) return '<span class="st-status off">Sin conectar</span>';
    if (r.blocked) return '<span class="st-status warn">Requiere auditoría</span>';
    if (r.note) return '<span class="st-status on">Lista · borrador</span>';
    return '<span class="st-status on">Lista</span>';
  }

  function card(network) {
    const cfg = data.config.networks[network], req = data.requirements[network], r = data.readiness[network], account = data.accounts[network];
    const id = key => 'ap-' + network + '-' + key;
    const privacy = network === 'youtube' ? [['public', 'Público'], ['unlisted', 'No listado'], ['private', 'Privado']] :
      network === 'tiktok' ? [['PUBLIC_TO_EVERYONE', 'Todo el mundo'], ['FOLLOWER_OF_CREATOR', 'Seguidores'], ['MUTUAL_FOLLOW_FRIENDS', 'Amigos'], ['SELF_ONLY', 'Solo yo']] : null;
    const select = (key, options, current) => '<select id="' + id(key) + '">' + options.map(([v, l]) =>
      '<option value="' + v + '"' + (v === current ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>';
    const browser = cfg.method !== 'api';
    const audit = !browser && (network === 'youtube' || network === 'tiktok');
    return '<article class="st-connection st-' + network + ' ap-card"><header>' + badge(network) + readinessChip(network) + '</header>' +
      field('Cómo publicar', select('method', [['browser', 'Navegador (recomendado)'], ['api', 'API oficial']], cfg.method || 'browser')) +
      (!browser ? '<p class="st-account">' + esc(account ? account.label : 'Conecta la cuenta en Estadísticas → Conexiones') + '</p>' : '') +
      (r.reason ? '<p class="st-note' + (r.blocked ? ' ap-warn' : '') + '">' + esc(r.reason) + '</p>' : '') +
      (r.note ? '<p class="st-note">' + esc(r.note) + '</p>' : '') +
      check(id('enabled'), 'Publicar automáticamente en ' + NAMES[network], cfg.enabled) +
      field('Horarios (hora de este equipo)', '<input id="' + id('hours') + '" value="' + esc(cfg.hours.join(', ')) + '" placeholder="12:30, 19:30">') +
      '<div class="ap-row">' + check(id('short'), 'Shorts / Reels', cfg.formats.includes('short')) + check(id('long'), 'Videos largos', cfg.formats.includes('long')) + '</div>' +
      (privacy && (!browser || network === 'youtube') ? field('Visibilidad', select('privacy', privacy, cfg.privacy)) : '') +
      (network === 'tiktok' && !browser ? field('Modo', select('mode', [['inbox', 'Borrador en la app (sin auditoría)'], ['direct', 'Publicación directa (requiere auditoría o Ayrshare)']], cfg.mode)) : '') +
      (network === 'facebook' ? check(id('group'), 'También publicar en mi grupo (solo por navegador)', cfg.groupEnabled) +
        field('Dirección del grupo', '<input id="' + id('groupUrl') + '" value="' + esc(cfg.groupUrl || '') + '" placeholder="https://www.facebook.com/groups/11contra11">') : '') +
      field('Frase final', '<input id="' + id('closing') + '" value="' + esc(cfg.closing) + '" maxlength="200">') +
      (audit ? check(id('audited'), network === 'youtube' ? 'Mi proyecto de Google ya pasó la auditoría de YouTube' : 'Mi app de TikTok ya pasó la auditoría', cfg.audited) +
        '<p class="st-note">' + action('ap-guide', 'Solicitar la auditoría ↗', network + '-audit', 'outline') + '</p>' : '') +
      '<details class="st-details"><summary>Lo que exige ' + NAMES[network] + '</summary><ul class="ap-notes">' +
      req.notes.map(note => '<li>' + esc(note) + '</li>').join('') + '<li>Máximo en Studio: ' + req.daily + ' publicaciones al día.</li></ul></details>' +
      '<div class="row wrap">' + action('ap-save', 'Guardar ' + NAMES[network], network, '') +
      (browser ? action('ap-test', 'Probar sin publicar', network) : '') + '</div></article>';
  }

  function globalPanel(cfg) {
    return '<section class="panel st-panel"><h2>Para todas las redes</h2><div class="st-form-grid">' +
      field('Hashtags fijos (se suman a los del récord)', '<input id="ap-hashtags" value="' + esc(cfg.hashtags) + '" maxlength="300">') +
      field('Separación mínima entre publicaciones de una misma red (minutos)', '<input id="ap-gap" type="number" min="15" max="1440" value="' + cfg.gapMinutes + '">') +
      '</div><p class="st-note">Cada red recibe su propio texto: título ajustado a su límite, #Shorts en YouTube, #Reels en Instagram, su frase final y la cantidad de hashtags que admite.</p>' +
      action('ap-save-global', 'Guardar', '', '') + '</section>';
  }

  function upcomingPanel() {
    return '<section class="panel st-panel"><h2>Próximas publicaciones</h2>' + (data.upcoming.length ? '<ul class="ap-list">' + data.upcoming.map(job =>
      '<li><span class="ap-when">' + esc(when(job.dueAt)) + '</span>' + badge(job.network) + '<span class="ap-title">' + esc(job.title || 'Video') + '</span>' +
      '<span class="st-format">' + (job.method === 'browser' ? 'Navegador' : 'API') + (job.group ? ' + grupo' : '') + '</span><span class="st-format">' + esc(STATUS[job.status] || job.status) + '</span>' +
      (['pendiente', 'programado'].includes(job.status) ? action('ap-cancel', 'Cancelar', job.id, 'outline') : '<span></span>') + '</li>').join('') + '</ul>'
      : '<p class="st-note">Nada programado. Aprueba un video en la pantalla de entrega y activa al menos una red.</p>') + '</section>';
  }

  function cell(info) {
    if (!info) return '<td>—</td>';
    const map = {
      listo: ['ap-ready', 'Listo'], 'en-espera': ['ap-wait', 'En espera'], desactivado: ['ap-wait', 'Desactivado'], 'no-apto': ['ap-bad', 'No apto'], repetido: ['ap-dup', 'Ya publicado'],
      programado: ['ap-sched', when(info.dueAt)], pendiente: ['ap-sched', 'En cola'], enviando: ['ap-sched', 'Enviando'], procesando: ['ap-sched', 'Procesando'],
      publicado: ['ap-done', '✓ Publicado'], fallo: ['ap-bad', 'Falló'], revisar: ['ap-bad', 'Revisar'], cancelado: ['ap-dup', 'Cancelado']
    };
    const [cls, label] = map[info.state] || ['ap-wait', info.state];
    return '<td><span class="ap-chip ' + cls + '"' + (info.reason ? ' title="' + esc(info.reason) + '"' : '') + '>' + esc(label) + '</span>' +
      (info.reason && ['no-apto', 'repetido'].includes(info.state) ? '<small>' + esc(info.reason) + '</small>' : '') + '</td>';
  }

  function matrixPanel() {
    return '<section class="panel st-panel"><h2>Videos aprobados por red</h2><p class="st-note">Un video aparece aquí cuando lo apruebas en la pantalla de entrega. «Ya publicado» evita repetirlo: Studio revisa su cola, la huella del archivo y los títulos que ya existen en cada red.</p>' +
      (data.rows.length ? '<div class="workflow-table st-table"><table><thead><tr><th>Video</th>' + ORDER.map(n => '<th>' + NAMES[n] + '</th>').join('') +
        '</tr></thead><tbody>' + data.rows.map(row => '<tr><th><span class="st-clip">' + esc(row.title) + '</span>' +
          '<span class="st-format st-format-' + row.format + '">' + (row.format === 'short' ? 'Short' : 'Largo') + '</span> <small>' + minutes(row.duration) + '</small></th>' +
          ORDER.map(n => cell(row.networks[n])).join('') + '</tr>').join('') + '</tbody></table></div>'
        : '<p class="st-note">Todavía no hay videos aprobados.</p>') + '</section>';
  }

  function recentPanel() {
    if (!data.recent.length) return '';
    return '<section class="panel st-panel"><h2>Resultados recientes</h2><ul class="ap-list">' + data.recent.map(job =>
      '<li><span class="ap-when">' + esc(when(job.at)) + '</span>' + badge(job.network) + '<span class="ap-title">' + esc(job.title || 'Video') +
      (job.message ? '<small>' + esc(job.message) + '</small>' : '') + '</span><span class="st-format">' + esc(STATUS[job.status] || job.status) + '</span>' +
      (job.url ? btn('publish-open', 'Abrir', 'outline', 'data-url="' + esc(job.url) + '" data-network="' + job.network + '"') :
        job.screenshot ? btn('system-open-data', 'Ver captura', 'outline', 'data-path="' + esc(job.screenshot) + '"') : '<span></span>') + '</li>').join('') + '</ul></section>';
  }

  function networkPatch(network) {
    const id = key => 'ap-' + network + '-' + key;
    const patch = { enabled: checked(id('enabled')), hours: value(id('hours')), closing: value(id('closing')),
      formats: [checked(id('short')) && 'short', checked(id('long')) && 'long'].filter(Boolean) };
    if (document.getElementById(id('privacy'))) patch.privacy = value(id('privacy'));
    if (document.getElementById(id('mode'))) patch.mode = value(id('mode'));
    if (document.getElementById(id('audited'))) patch.audited = checked(id('audited'));
    if (document.getElementById(id('method'))) patch.method = value(id('method'));
    if (document.getElementById(id('groupUrl'))) { patch.groupUrl = value(id('groupUrl')); patch.groupEnabled = checked(id('group')); }
    return patch;
  }

  async function save(patch, message) {
    data = await flow('auto.save', patch);
    render();
    notice(message);
  }

  async function handle(name, element) {
    const id = element.dataset.id;
    if (name === 'autopublish') {
      state.page = 'autopublish';
      await load();
      return render();
    }
    if (name === 'ap-authorize-save') {
      if (!checked('ap-authorize')) return notice('Marca la autorización para continuar', true);
      return save({ authorized: true, enabled: true }, 'Publicación automática activada. Ahora activa las redes que quieras.');
    }
    if (name === 'ap-toggle') return save({ enabled: !data.config.enabled }, data.config.enabled ? 'Publicación automática en pausa' : 'Publicación automática activada');
    if (name === 'ap-save') return save({ networks: { [id]: networkPatch(id) } }, NAMES[id] + ' guardado');
    if (name === 'ap-save-global') return save({ hashtags: value('ap-hashtags'), gapMinutes: Number(value('ap-gap')) }, 'Ajustes guardados');
    if (name === 'ap-guide') return flow('statistics.guide', { key: id });
    if (name === 'ap-test') {
      element.disabled = true;
      element.textContent = 'Ensayando en el navegador…';
      try {
        const result = await flow('auto.test', { network: id });
        notice(NAMES[id] + ': ' + (result.note || 'Ensayo correcto') + ' (video: ' + result.title + ')');
      } finally { element.disabled = false; element.textContent = 'Probar sin publicar'; }
      return;
    }
    if (name === 'ap-plan') {
      element.disabled = true;
      try {
        const result = await flow('auto.plan');
        data = result.overview;
        render();
        notice(result.skipped ? 'Activa la publicación automática para planificar' : result.created.length + ' publicaciones programadas' +
          (result.errors.length ? ' · ' + result.errors[0] : ''), Boolean(result.errors?.length));
      } finally { element.disabled = false; }
      return;
    }
    if (name === 'ap-cancel') {
      await flow('publish.change', { id, action: 'cancelar' });
      await load();
      render();
      return notice('Publicación cancelada. Ese video no se volverá a programar en esa red mientras siga en la lista.');
    }
  }

  document.addEventListener('click', event => {
    const element = event.target.closest('[data-action="autopublish"],[data-action^="ap-"]');
    if (!element) return;
    handle(element.dataset.action, element).catch(error => notice(error.message, true));
  });

  window.AutoPublish = { load, page };
})();
