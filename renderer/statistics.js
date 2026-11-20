'use strict';
/*
 * Estadísticas · sección independiente para medir Shorts y videos largos en
 * YouTube, Instagram, Facebook y TikTok.
 *
 * Pestañas:
 *   Resumen      → cifras clave, comparación Shorts / largos, evolución y lo que funciona.
 *   Videos       → tabla completa con búsqueda, orden y detalle de cada publicación.
 *   Conexiones   → asistente paso a paso para conectar cada red por su API oficial.
 *   Navegador    → lector supervisado para completar lo que la API no entrega.
 */
(function () {
  const NETWORKS = {
    youtube: { name: 'YouTube', short: 'Shorts', long: 'Videos', minutes: 15 },
    instagram: { name: 'Instagram', short: 'Reels', long: 'Videos', minutes: 10 },
    facebook: { name: 'Facebook', short: 'Reels', long: 'Videos', minutes: 15 },
    tiktok: { name: 'TikTok', short: 'Videos cortos', long: 'Videos largos', minutes: 20 }
  };
  const FORMATS = { short: 'Shorts y Reels', long: 'Videos largos' };
  const TABS = [['summary', 'Resumen'], ['videos', 'Videos'], ['connections', 'Conexiones'], ['browser', 'Lector de navegador']];
  const PERIODS = [['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['90', 'Últimos 90 días'], ['365', 'Último año'], ['', 'Todo el historial']];
  const METRIC_LABELS = {
    views: 'Vistas', likes: 'Me gusta', comments: 'Comentarios', shares: 'Compartidos', followers: 'Seguidores de la cuenta',
    retention: 'Porcentaje medio visto', saved: 'Guardados', reach: 'Alcance', averageViewDuration: 'Duración media vista (s)',
    estimatedMinutesWatched: 'Minutos vistos', engagedViews: 'Vistas comprometidas', subscribersGained: 'Suscriptores ganados',
    subscribersLost: 'Suscriptores perdidos', total_interactions: 'Interacciones totales', ig_reels_avg_watch_time: 'Tiempo medio visto (ms)',
    ig_reels_video_view_total_time: 'Tiempo total visto (ms)', averageViewPercentage: 'Porcentaje medio visto'
  };
  const COLUMNS = [
    ['title', 'Video'], ['network', 'Red'], ['publishedAt', 'Publicado'], ['views', 'Vistas'], ['likes', 'Me gusta'],
    ['comments', 'Comentarios'], ['shares', 'Compartidos'], ['engagement', 'Interacción'], ['retention', 'Retención']
  ];

  const view = { tab: 'summary', network: '', format: '', period: '', tag: '', search: '', sort: 'publishedAt', desc: true };
  let rows = [], status = {}, accounts = {}, loaded = false;
  let reader = null, readerTimer = null, readerSeen = '';

  const flow = (action, data) => StudioWorkflow.flow(action, data);

  /* ---------- utilidades ---------- */

  function number(value, digits = 0) {
    return value == null || !Number.isFinite(Number(value)) ? '—'
      : new Intl.NumberFormat('es-EC', { maximumFractionDigits: digits }).format(value);
  }

  function compact(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    const n = Number(value), abs = Math.abs(n);
    if (abs >= 1e6) return number(n / 1e6, 1) + ' M';
    if (abs >= 1e4) return number(n / 1e3, abs >= 1e5 ? 0 : 1) + ' K';
    return number(n);
  }

  function percent(value) {
    return value == null || !Number.isFinite(value) ? '—' : number(value, 1) + ' %';
  }

  function day(value) {
    return value ? new Date(value).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  }

  function moment(value) {
    return value ? new Date(value).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  }

  function sum(list, key) {
    return list.reduce((total, row) => total + (Number(row.metrics?.[key]) || 0), 0);
  }

  function engagement(row) {
    const m = row.metrics || {};
    if (!m.views) return null;
    return 100 * ((m.likes || 0) + (m.comments || 0) + (m.shares || 0)) / m.views;
  }

  function average(list, read) {
    const values = list.map(read).filter(v => v != null && Number.isFinite(v));
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }

  function tags(row) {
    return Object.values(row.tags || {}).flat();
  }

  function weekStart(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return date;
  }

  function field(label, control) {
    return '<label class="st-field"><span>' + esc(label) + '</span>' + control + '</label>';
  }

  function select(id, choices, selected) {
    return '<select id="' + id + '">' + choices.map(([value, label]) =>
      '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(label) + '</option>').join('') + '</select>';
  }

  function action(name, label, id, cls = 'secondary') {
    return btn(name, label, cls, id === undefined ? '' : 'data-id="' + esc(id) + '"');
  }

  function badge(network) {
    return '<span class="st-badge st-' + esc(network) + '">' + esc(NETWORKS[network]?.name || network) + '</span>';
  }

  function formatBadge(format) {
    return format ? '<span class="st-format st-format-' + format + '">' + (format === 'short' ? 'Short' : 'Largo') + '</span>'
      : '<span class="st-format">Sin clasificar</span>';
  }

  function modal(title, body, wide = false) {
    const root = $('#modal-root');
    root.hidden = false;
    root.innerHTML = '<div class="modalback"><div class="modal workflow-modal st-modal' + (wide ? ' st-modal-wide' : '') + '">' +
      '<div class="row between"><h2>' + esc(title) + '</h2>' + btn('modal-close', 'Cerrar', 'secondary') + '</div>' + body + '</div></div>';
  }

  function closeModal() {
    const root = $('#modal-root');
    root.hidden = true;
    root.innerHTML = '';
  }

  function value(id) {
    return $('#' + id)?.value.trim() ?? '';
  }

  /* ---------- datos ---------- */

  async function load() {
    [rows, status, accounts, reader] = await Promise.all([
      flow('statistics.list'), flow('statistics.status'), flow('statistics.accounts'), flow('statistics.browser.state')
    ]);
    loaded = true;
    if (reader && !reader.finished) watchReader();
  }

  function filtered({ ignoreFormat = false } = {}) {
    const since = view.period ? Date.now() - Number(view.period) * 86400000 : null;
    return rows.filter(row =>
      (!view.network || row.network === view.network) &&
      (ignoreFormat || !view.format || row.format === view.format) &&
      (!view.tag || tags(row).includes(view.tag)) &&
      (!since || (row.publishedAt && Date.parse(row.publishedAt) >= since)));
  }

  function followers(network) {
    const latest = rows.filter(row => row.network === network && row.metrics?.followers != null)
      .sort((a, b) => String(b.metricsAt || '').localeCompare(String(a.metricsAt || '')))[0];
    return latest?.metrics.followers ?? accounts[network]?.followers ?? null;
  }

  function connectedCount() {
    return Object.keys(NETWORKS).filter(network => accounts[network]).length;
  }

  /* ---------- estructura general ---------- */

  function page() {
    if (!loaded) return titlebar('Estadísticas', 'Cargando…');
    const header = titlebar('Estadísticas',
      'Rendimiento de tus Shorts y videos largos en YouTube, Instagram, Facebook y TikTok.',
      btn('st-sync', 'Sincronizar ahora') + btn('st-export', 'Exportar para Claude', 'secondary'));
    const tabs = '<nav class="st-tabs" role="tablist">' + TABS.map(([id, label]) =>
      '<button role="tab" data-action="st-tab" data-id="' + id + '" class="st-tab' + (view.tab === id ? ' active' : '') +
      '" aria-selected="' + (view.tab === id) + '">' + esc(label) +
      (id === 'connections' ? ' <small>' + connectedCount() + '/4</small>' : '') +
      (id === 'browser' && reader && !reader.finished ? ' <small class="st-live">en curso</small>' : '') + '</button>').join('') + '</nav>';
    const body = view.tab === 'videos' ? videosTab() : view.tab === 'connections' ? connectionsTab()
      : view.tab === 'browser' ? browserTab() : summaryTab();
    return '<div class="st">' + header + syncBar() + tabs + body + '</div>';
  }

  function syncBar() {
    const parts = ['<span><strong>' + connectedCount() + ' de 4</strong> redes conectadas</span>',
      '<span>Última sincronización: <strong>' + esc(status.at ? moment(status.at) : 'todavía no') + '</strong></span>',
      '<span>' + number(rows.length) + ' publicaciones medidas</span>'];
    const errors = status.errors?.length ? '<details class="st-alert"><summary>La última consulta quedó incompleta (' +
      status.errors.length + ')</summary><ul>' + status.errors.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></details>' : '';
    return '<div class="st-syncbar">' + parts.join('<i></i>') + '</div>' + errors;
  }

  function filters({ format = true } = {}) {
    const allTags = [...new Set(rows.flatMap(tags))].sort((a, b) => a.localeCompare(b, 'es'));
    return '<div class="st-filters">' +
      (format ? '<div class="st-segment" role="group" aria-label="Formato">' + [['', 'Todo'], ['short', 'Shorts y Reels'], ['long', 'Videos largos']]
        .map(([id, label]) => '<button data-action="st-format" data-id="' + id + '" class="' + (view.format === id ? 'active' : '') + '">' +
          esc(label) + '</button>').join('') + '</div>' : '') +
      field('Red', select('st-f-network', [['', 'Todas las redes'], ...Object.entries(NETWORKS).map(([id, n]) => [id, n.name])], view.network)) +
      field('Período de publicación', select('st-f-period', PERIODS, view.period)) +
      (allTags.length ? field('Categoría', select('st-f-tag', [['', 'Todas'], ...allTags.map(t => [t, t])], view.tag)) : '') +
      '</div>';
  }

  function empty(title, text, cta = '') {
    return '<div class="st-empty"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p>' + cta + '</div>';
  }

  /* ---------- Resumen ---------- */

  function summaryTab() {
    if (!rows.length) {
      return empty('Aún no hay datos', 'Conecta tus redes y pulsa Sincronizar ahora. Studio traerá todos tus videos, incluso los publicados antes de usar la app.',
        '<div class="row wrap st-center">' + action('st-tab', 'Conectar mis redes', 'connections', '') +
        action('st-tab', 'Usar el lector de navegador', 'browser') + '</div>');
    }
    const list = filtered();
    return filters() + kpis(list) + '<div class="st-grid-2">' + formatComparison(filtered({ ignoreFormat: true })) + weeklyChart(list) + '</div>' +
      networkCards(list) + '<div class="st-grid-2">' + topVideos(list) + insights(list) + '</div>';
  }

  function kpis(list) {
    const views = sum(list, 'views');
    const totalFollowers = Object.keys(NETWORKS).filter(n => !view.network || n === view.network)
      .map(followers).filter(v => v != null);
    const cards = [
      ['Vistas', compact(views), number(views) + ' en total'],
      ['Publicaciones', number(list.length), list.filter(r => r.format === 'short').length + ' Shorts · ' + list.filter(r => r.format === 'long').length + ' largos'],
      ['Promedio por video', compact(list.length ? views / list.length : null), 'vistas por publicación'],
      ['Interacción', percent(average(list, engagement)), 'interacciones por cada 100 vistas'],
      ['Me gusta', compact(sum(list, 'likes')), number(sum(list, 'comments')) + ' comentarios'],
      ['Seguidores', totalFollowers.length ? compact(totalFollowers.reduce((a, b) => a + b, 0)) : '—', 'último dato de cada cuenta']
    ];
    return '<div class="st-kpis">' + cards.map(([label, big, small]) =>
      '<div class="st-kpi"><span>' + esc(label) + '</span><strong>' + esc(big) + '</strong><small>' + esc(small) + '</small></div>').join('') + '</div>';
  }

  function formatComparison(list) {
    const groups = ['short', 'long'].map(format => {
      const items = list.filter(row => row.format === format);
      const views = sum(items, 'views');
      return { format, items, views, avg: items.length ? views / items.length : null,
        engagement: average(items, engagement), retention: average(items, r => r.metrics?.retention) };
    });
    const maxAvg = Math.max(1, ...groups.map(g => g.avg || 0));
    const unclassified = list.filter(row => !row.format).length;
    return '<section class="panel st-panel"><h2>Shorts frente a videos largos</h2><div class="st-compare">' + groups.map(g =>
      '<div class="st-compare-col st-format-' + g.format + '"><h3>' + esc(FORMATS[g.format]) + '</h3>' +
      '<div class="st-bar"><div style="width:' + (100 * (g.avg || 0) / maxAvg).toFixed(1) + '%"></div></div>' +
      '<dl><div><dt>Publicaciones</dt><dd>' + number(g.items.length) + '</dd></div>' +
      '<div><dt>Vistas</dt><dd>' + compact(g.views) + '</dd></div>' +
      '<div><dt>Promedio</dt><dd>' + compact(g.avg) + '</dd></div>' +
      '<div><dt>Interacción</dt><dd>' + percent(g.engagement) + '</dd></div>' +
      '<div><dt>Retención</dt><dd>' + percent(g.retention) + '</dd></div></dl></div>').join('') + '</div>' +
      '<p class="st-note">Se considera Short o Reel todo video de hasta 3 minutos; los publicados desde Studio usan su tipo real.' +
      (unclassified ? ' ' + unclassified + ' publicaciones sin duración conocida quedan sin clasificar.' : '') + '</p></section>';
  }

  function weeklyChart(list) {
    const weeks = [];
    const current = weekStart(Date.now());
    for (let i = 11; i >= 0; i--) {
      const start = new Date(current);
      start.setDate(start.getDate() - 7 * i);
      weeks.push({ start, short: 0, long: 0, other: 0 });
    }
    for (const row of list) {
      const start = row.publishedAt && weekStart(row.publishedAt);
      const slot = start && weeks.find(w => w.start.getTime() === start.getTime());
      if (slot) slot[row.format || 'other'] += Number(row.metrics?.views) || 0;
    }
    const max = Math.max(1, ...weeks.map(w => w.short + w.long + w.other));
    const bars = weeks.map(w => {
      const total = w.short + w.long + w.other;
      const piece = (key, cls) => w[key] ? '<div class="' + cls + '" style="height:' + (100 * w[key] / max).toFixed(1) + '%"></div>' : '';
      return '<div class="st-week" title="Semana del ' + esc(day(w.start)) + ': ' + esc(number(total)) + ' vistas">' +
        '<div class="st-week-stack">' + piece('other', 'st-seg-other') + piece('long', 'st-seg-long') + piece('short', 'st-seg-short') + '</div>' +
        '<small>' + w.start.getDate() + '/' + (w.start.getMonth() + 1) + '</small></div>';
    }).join('');
    return '<section class="panel st-panel"><h2>Vistas por semana de publicación</h2>' +
      '<div class="st-legend"><span class="st-dot st-seg-short"></span>Shorts y Reels<span class="st-dot st-seg-long"></span>Videos largos</div>' +
      '<div class="st-chart">' + bars + '</div><p class="st-note">Vistas acumuladas por los videos publicados cada semana (últimas 12 semanas).</p></section>';
  }

  function networkCards(list) {
    return '<div class="st-networks">' + Object.entries(NETWORKS).map(([id, n]) => {
      const items = list.filter(row => row.network === id);
      const connected = Boolean(accounts[id]);
      const best = items.slice().sort((a, b) => (b.metrics?.views || 0) - (a.metrics?.views || 0))[0];
      const part = format => {
        const group = items.filter(row => row.format === format);
        return '<div><dt>' + esc(format === 'short' ? n.short : n.long) + '</dt><dd>' + number(group.length) +
          ' · ' + compact(sum(group, 'views')) + ' vistas</dd></div>';
      };
      return '<article class="st-network st-' + id + '"><header>' + badge(id) +
        '<span class="st-status ' + (connected ? 'on' : 'off') + '">' + (connected ? esc(accounts[id].label) : 'Sin conectar') + '</span></header>' +
        (items.length ? '<strong class="st-network-views">' + compact(sum(items, 'views')) + '<small> vistas</small></strong>' +
          '<dl>' + part('short') + part('long') + '<div><dt>Seguidores</dt><dd>' + compact(followers(id)) + '</dd></div></dl>' +
          (best ? '<p class="st-best">Mejor: <button class="st-link" data-action="st-detail" data-id="' + esc(best.id) + '">' + esc(best.title) + '</button></p>' : '')
          : '<p class="st-note">' + (connected ? 'Sin publicaciones en este período.' : 'Conecta la cuenta para ver sus cifras.') + '</p>') +
        (connected ? '' : action('st-wizard', 'Conectar ' + n.name, id)) + '</article>';
    }).join('') + '</div>';
  }

  function topVideos(list) {
    const top = list.filter(row => row.metrics?.views != null).sort((a, b) => b.metrics.views - a.metrics.views).slice(0, 6);
    return '<section class="panel st-panel"><h2>Videos con más vistas</h2>' + (top.length ? '<ol class="st-top">' + top.map(row =>
      '<li><button class="st-link" data-action="st-detail" data-id="' + esc(row.id) + '">' + esc(row.title) + '</button>' +
      '<span>' + badge(row.network) + formatBadge(row.format) + '</span><strong>' + compact(row.metrics.views) + '</strong></li>').join('') + '</ol>'
      : '<p class="st-note">Sin vistas registradas con estos filtros.</p>') + '</section>';
  }

  function insights(list) {
    const rank = (pick, title) => {
      const groups = new Map();
      for (const row of list.filter(r => r.metrics?.views != null)) {
        for (const key of pick(row)) {
          const g = groups.get(key) || { key, views: 0, posts: 0 };
          g.views += row.metrics.views;
          g.posts++;
          groups.set(key, g);
        }
      }
      const items = [...groups.values()].sort((a, b) => b.views / b.posts - a.views / a.posts).slice(0, 4);
      return items.length ? '<h3>' + esc(title) + '</h3><ul class="st-rank">' + items.map(g =>
        '<li><span>' + esc(g.key) + ' <small>· ' + g.posts + ' videos</small></span><strong>' + compact(g.views / g.posts) + ' <small>prom.</small></strong></li>').join('') + '</ul>' : '';
    };
    const content = rank(row => row.tags?.tipos || [], 'Temas') + rank(row => row.tags?.jugadores || [], 'Jugadores') +
      rank(row => row.hook ? [row.hook] : [], 'Ganchos');
    return '<section class="panel st-panel"><h2>Qué funciona mejor</h2>' + (content ||
      '<p class="st-note">Etiqueta tus récords en la ficha (tipo, jugadores) para ver qué temas atraen más vistas.</p>') + '</section>';
  }

  /* ---------- Videos ---------- */

  function sortValue(row, key) {
    if (key === 'title') return String(row.title || '').toLowerCase();
    if (key === 'network') return row.network;
    if (key === 'publishedAt') return row.publishedAt || '';
    if (key === 'engagement') return engagement(row) ?? -1;
    return row.metrics?.[key] ?? -1;
  }

  function videosTab() {
    const term = view.search.toLowerCase();
    const list = filtered().filter(row => !term || String(row.title || '').toLowerCase().includes(term))
      .sort((a, b) => {
        const x = sortValue(a, view.sort), y = sortValue(b, view.sort);
        return (x < y ? -1 : x > y ? 1 : 0) * (view.desc ? -1 : 1);
      });
    const search = '<label class="st-field st-search"><span>Buscar</span><input id="st-search" type="search" placeholder="Título del video" value="' +
      esc(view.search) + '"></label>';
    const head = COLUMNS.map(([key, label]) => '<th><button class="st-sort' + (view.sort === key ? ' active' : '') +
      '" data-action="st-sort" data-id="' + key + '">' + esc(label) + (view.sort === key ? (view.desc ? ' ↓' : ' ↑') : '') + '</button></th>').join('');
    const body = list.map(row => '<tr><th><button class="st-link" data-action="st-detail" data-id="' + esc(row.id) + '">' + esc(row.title) + '</button>' +
      formatBadge(row.format) + (row.metricsError ? '<small class="st-error">' + esc(row.metricsError) + '</small>' : '') + '</th>' +
      '<td>' + badge(row.network) + '</td><td>' + esc(row.publishedAt ? day(row.publishedAt) : row.dateText || '—') + '</td>' +
      ['views', 'likes', 'comments', 'shares'].map(k => '<td>' + number(row.metrics?.[k]) + '</td>').join('') +
      '<td>' + percent(engagement(row)) + '</td><td>' + percent(row.metrics?.retention) + '</td></tr>').join('');
    return filters() + '<section class="panel st-panel"><div class="row between wrap"><h2>' + number(list.length) + ' publicaciones</h2>' + search + '</div>' +
      (list.length ? '<div class="workflow-table st-table"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>'
        : '<p class="st-note">No hay publicaciones con estos filtros.</p>') + '</section>';
  }

  function sparkline(history) {
    const points = (history || []).filter(h => h.metrics?.views != null).map(h => ({ at: Date.parse(h.at), v: h.metrics.views }));
    if (points.length < 2) return '';
    const minT = points[0].at, maxT = points.at(-1).at || minT + 1, maxV = Math.max(1, ...points.map(p => p.v));
    const path = points.map((p, i) => (i ? 'L' : 'M') + (300 * (p.at - minT) / Math.max(1, maxT - minT)).toFixed(1) + ' ' +
      (70 - 64 * p.v / maxV).toFixed(1)).join(' ');
    return '<figure class="st-spark"><svg viewBox="0 0 300 74" role="img" aria-label="Evolución de vistas"><path d="' + path + '"/></svg>' +
      '<figcaption>Vistas en cada medición · de ' + esc(number(points[0].v)) + ' a ' + esc(number(points.at(-1).v)) + '</figcaption></figure>';
  }

  function detail(id) {
    const row = rows.find(item => item.id === id);
    if (!row) return;
    const percentKeys = new Set(['retention', 'averageViewPercentage']);
    const show = (k, v) => esc(v == null ? 'No disponible' : percentKeys.has(k) ? percent(v) : number(v, 2));
    const metricList = (metrics, origins = {}) => '<dl class="st-metrics">' + Object.entries(metrics || {})
      .filter(([k, v]) => !k.endsWith('_series') && typeof v !== 'object')
      .map(([k, v]) => '<div><dt>' + esc(METRIC_LABELS[k] || k) + (origins[k] ? '<small>' + (origins[k].source === 'navegador' ? 'Navegador' : 'API') +
        ' · ' + esc(day(origins[k].at)) + '</small>' : '') + '</dt><dd>' + show(k, v) + '</dd></div>').join('') + '</dl>';
    modal(row.title, '<p class="row wrap">' + badge(row.network) + formatBadge(row.format) +
      '<span class="st-note">Publicado: ' + esc(row.publishedAt ? day(row.publishedAt) : row.dateText || '—') +
      ' · Última medición: ' + esc(moment(row.metricsAt)) + '</span></p>' +
      (row.url ? '<p class="st-note st-url">' + esc(row.url) + '</p>' : '') + sparkline(row.history) +
      metricList(row.metrics, row.metricOrigins) +
      (row.manualMetrics ? '<details class="st-details"><summary>Cifras registradas a mano</summary>' + metricList(row.manualMetrics) + '</details>' : '') +
      ((row.history || []).length ? '<details class="st-details"><summary>Historial de mediciones (' + row.history.length + ')</summary>' +
        row.history.slice().reverse().map(h => '<h4>' + esc(moment(h.at)) + ' · ' + (h.source === 'navegador' ? 'Navegador' : 'API') + '</h4>' +
          metricList(h.metrics)).join('') + '</details>' : '') +
      (row.localJob ? '<div class="row">' + action('st-manual', 'Registrar cifras a mano', row.id) + '</div>' : ''), true);
  }

  function manualDialog(id) {
    const row = rows.find(item => item.id === id);
    if (!row) return;
    const keys = { views: 'Vistas', likes: 'Me gusta', comments: 'Comentarios', retention: 'Retención (%)', followers: 'Seguidores' };
    modal('Registrar cifras a mano', '<p class="st-note">' + esc(row.title) + '</p><div class="st-form-grid">' +
      Object.entries(keys).map(([key, label]) => field(label, '<input id="st-m-' + key + '" type="number" min="0" step="' +
        (key === 'retention' ? '.01' : '1') + '" value="' + esc(row.manualMetrics?.[key] ?? row.metrics?.[key] ?? '') + '">')).join('') +
      '</div>' + action('st-manual-save', 'Guardar cifras', id, ''));
  }

  /* ---------- Conexiones ---------- */

  const GUIDES = {
    youtube: {
      gives: 'Vistas, me gusta, comentarios, compartidos, minutos vistos, retención y suscriptores de Shorts y videos largos.',
      steps: [
        ['Crea un proyecto en Google Cloud', 'Entra con la cuenta de Google dueña del canal y crea un proyecto llamado, por ejemplo, «11 Récords Studio».', 'google-project'],
        ['Activa la API de datos de YouTube', 'Abre YouTube Data API v3 y pulsa Habilitar.', 'google-data-api'],
        ['Activa la API de Analytics de YouTube', 'Abre YouTube Analytics API y pulsa Habilitar. Da los minutos vistos y la retención.', 'google-analytics-api'],
        ['Configura la pantalla de consentimiento', 'Elige tipo Externo, escribe el nombre de la app y tu correo. Después pulsa Publicar aplicación: en modo de prueba, Google obliga a autorizar de nuevo cada 7 días. Como la app es solo tuya, Google mostrará el aviso «app no verificada»: pulsa Configuración avanzada → Ir a la app.', 'google-consent'],
        ['Crea el cliente de escritorio', 'En Credenciales pulsa Crear credenciales → ID de cliente de OAuth → tipo «App de escritorio». Copia el ID de cliente y el secreto.', 'google-credentials']
      ]
    },
    instagram: {
      gives: 'Vistas, alcance, me gusta, comentarios, guardados, compartidos y tiempo medio visto de tus Reels y videos.',
      steps: [
        ['Usa una cuenta profesional', 'En Instagram abre Configuración → Tipo de cuenta y herramientas → Cambiar a cuenta profesional (Creador o Empresa). No necesitas una página de Facebook.'],
        ['Crea una app en Meta for Developers', 'Pulsa Crear app, elige el caso de uso «Administrar mensajes y contenido en Instagram» y termina el asistente.', 'meta-apps'],
        ['Añade tu cuenta como evaluadora', 'En la app abre Instagram → Configuración de la API con inicio de sesión de Instagram → Generar tokens de acceso → Añadir cuenta. Acepta la invitación en Instagram (Configuración → Apps y sitios web → Invitaciones de evaluador).'],
        ['Genera el token', 'Pulsa Generar token junto a tu cuenta y concede instagram_business_basic e instagram_business_manage_insights (y instagram_business_content_publish si publicarás desde Studio). Copia el token: dura 60 días y Studio lo renueva solo.']
      ]
    },
    facebook: {
      gives: 'Vistas, reacciones, comentarios, compartidos y tiempo medio visto de los videos y Reels de tu página.',
      steps: [
        ['Ten a mano tu página de Facebook', 'Las estadísticas se leen de la página donde publicas los videos y Reels. Debes ser administrador.'],
        ['Usa una app de Meta', 'Puedes reutilizar la app creada para Instagram o crear otra con el caso de uso «Administrar todo lo de tu página».', 'meta-apps'],
        ['Obtén el token de la página', 'En el Explorador de la API Graph elige tu app, añade pages_show_list, pages_read_engagement y read_insights, pulsa Generate Access Token y después elige tu página en «Token de página». Copia el token y el ID de la página.', 'meta-explorer'],
        ['Haz que no caduque', 'Pega el token en el Depurador de tokens y pulsa Ampliar token de acceso. El token de página obtenido desde un token ampliado no vence.', 'meta-debugger']
      ]
    },
    tiktok: {
      gives: 'Vistas, me gusta, comentarios y compartidos. TikTok no entrega el tiempo visto por API: compleméntalo con el lector de navegador.',
      steps: [
        ['Crea una app en TikTok for Developers', 'Entra con tu cuenta de TikTok y crea una app de uso personal.', 'tiktok-apps'],
        ['Añade Login Kit y Display API', 'Activa los permisos user.info.basic y video.list (user.info.stats es opcional para los seguidores).', 'tiktok-display'],
        ['Trabaja en modo Sandbox', 'Agrega tu propia cuenta de TikTok como usuario de prueba. Así no necesitas la auditoría pública para leer tus videos.'],
        ['Obtén los tokens', 'Autoriza tu cuenta en la app y copia el token de acceso y el token de renovación junto con el Client key y el Client secret.']
      ]
    }
  };

  function connectionState(network) {
    const account = accounts[network];
    if (!account) return { cls: 'off', text: 'Sin conectar' };
    const expires = account.expiresAt ? Date.parse(account.expiresAt) : null;
    if (expires && expires < Date.now() && account.provider !== 'instagram-login') return { cls: 'warn', text: 'Acceso vencido' };
    if (expires && expires < Date.now()) return { cls: 'warn', text: 'Token vencido: genera uno nuevo' };
    return { cls: 'on', text: 'Conectado' };
  }

  function connectionsTab() {
    return '<p class="st-lead">Conecta cada red una sola vez. Studio guarda los accesos cifrados en este equipo y sincroniza solo una vez por semana con la app abierta, o cuando pulses Sincronizar ahora.</p>' +
      '<div class="st-connections">' + Object.entries(NETWORKS).map(([id, n]) => {
        const account = accounts[id], state = connectionState(id);
        return '<article class="st-connection st-' + id + '"><header>' + badge(id) + '<span class="st-status ' + state.cls + '">' + esc(state.text) + '</span></header>' +
          (account ? '<p class="st-account">' + esc(account.label) + (account.followers != null ? ' <small>· ' + compact(account.followers) + ' seguidores</small>' : '') + '</p>' +
            (account.provider === 'instagram-login' ? '<p class="st-note">Token renovado automáticamente' + (account.expiresAt ? ' · vence ' + esc(day(account.expiresAt)) : '') + '</p>' : '')
            : '<p class="st-note">Configuración única de unos ' + n.minutes + ' minutos.</p>') +
          '<p>' + esc(GUIDES[id].gives) + '</p>' +
          '<div class="row wrap">' + (account
            ? action('st-test', 'Probar conexión', id, '') + action('st-wizard', 'Cambiar cuenta', id) + action('st-disconnect', 'Desconectar', id, 'outline')
            : action('st-wizard', 'Conectar paso a paso', id, '')) + '</div>' +
          (id === 'tiktok' && !account ? '<p class="st-note">¿Prefieres no crear una app? Usa el <button class="st-link" data-action="st-tab" data-id="browser">lector de navegador</button>.</p>' : '') +
          '</article>';
      }).join('') + '</div>' +
      '<section class="panel st-panel st-why"><h2>¿Por qué la conexión oficial?</h2><ul>' +
      '<li><strong>Cifras exactas</strong>: 1.234 vistas, no «1,2 K».</li>' +
      '<li><strong>Todo el catálogo</strong>: incluye los videos publicados fuera de Studio.</li>' +
      '<li><strong>Automática</strong>: no tienes que abrir cada pestaña.</li>' +
      '<li><strong>Segura para tus cuentas</strong>: las redes no la tratan como navegación automatizada.</li></ul>' +
      '<p class="st-note">El lector de navegador sigue disponible para completar lo que una API no entrega.</p></section>';
  }

  function wizard(network) {
    const guide = GUIDES[network], n = NETWORKS[network];
    const steps = guide.steps.map(([title, text, link], i) => '<li><span class="st-step-n">' + (i + 1) + '</span><div><h4>' + esc(title) + '</h4><p>' + esc(text) + '</p>' +
      (link ? action('st-guide', 'Abrir página ↗', link, 'outline') : '') + '</div></li>').join('');
    const finalStep = '<li class="st-step-final"><span class="st-step-n">' + (guide.steps.length + 1) + '</span><div><h4>Conecta con Studio</h4>' + connectForm(network) + '</div></li>';
    modal('Conectar ' + n.name, '<p class="st-note">' + esc(guide.gives) + '</p><ol class="st-steps">' + steps + finalStep + '</ol>', true);
  }

  function secret(id, label, placeholder = '') {
    return field(label, '<input id="' + id + '" type="password" autocomplete="new-password" spellcheck="false" placeholder="' + esc(placeholder) + '">');
  }

  function text(id, label, placeholder = '', attrs = '') {
    return field(label, '<input id="' + id + '" autocomplete="off" spellcheck="false" placeholder="' + esc(placeholder) + '" ' + attrs + '>');
  }

  function connectForm(network) {
    if (network === 'youtube') {
      return '<div class="st-form-grid">' + text('st-c-client', 'ID de cliente', '…apps.googleusercontent.com') + secret('st-c-secret', 'Secreto de cliente') + '</div>' +
        '<p class="st-note">Se abrirá tu navegador para elegir el canal. Studio recibe la autorización en este equipo.</p>' +
        action('st-google', 'Autorizar canal de YouTube', network, '');
    }
    if (network === 'instagram') {
      return secret('st-c-token', 'Token de acceso de Instagram', 'IGAA…') +
        action('st-connect', 'Verificar y conectar', 'instagram', '') +
        '<details class="st-details"><summary>Mi Instagram está enlazado a una página de Facebook (método anterior)</summary>' +
        '<div class="st-form-grid">' + text('st-c-profile', 'ID del perfil profesional', '1784…', 'inputmode="numeric"') + secret('st-c-meta-token', 'Token de Meta') + '</div>' +
        action('st-connect', 'Conectar con Facebook Login', 'instagram-facebook') + '</details>';
    }
    if (network === 'facebook') {
      return '<div class="st-form-grid">' + text('st-c-profile', 'ID de la página', '1000…', 'inputmode="numeric"') + secret('st-c-token', 'Token de la página') + '</div>' +
        action('st-connect', 'Verificar y conectar', 'facebook', '');
    }
    return '<div class="st-form-grid">' + text('st-c-client', 'Client key') + secret('st-c-secret', 'Client secret') +
      secret('st-c-token', 'Token de acceso') + secret('st-c-refresh', 'Token de renovación') + '</div>' +
      action('st-connect', 'Verificar y conectar', 'tiktok', '') +
      '<details class="st-details"><summary>Uso Ayrshare para TikTok</summary>' +
      '<div class="st-form-grid">' + secret('st-c-ayr', 'Clave de API de Ayrshare') + secret('st-c-ayr-profile', 'Profile-Key (opcional)') + '</div>' +
      action('st-connect', 'Conectar con Ayrshare', 'tiktok-ayrshare') + '</details>';
  }

  function connectionData(kind) {
    if (kind === 'instagram') return ['instagram', { provider: 'instagram-login', accessToken: value('st-c-token') }];
    if (kind === 'instagram-facebook') return ['instagram', { provider: 'direct', profileId: value('st-c-profile'), accessToken: value('st-c-meta-token') }];
    if (kind === 'facebook') return ['facebook', { provider: 'direct', profileId: value('st-c-profile'), accessToken: value('st-c-token') }];
    if (kind === 'tiktok-ayrshare') return ['tiktok', { provider: 'ayrshare', accessToken: value('st-c-ayr'), profileId: value('st-c-ayr-profile') }];
    return ['tiktok', { provider: 'direct', clientId: value('st-c-client'), clientSecret: value('st-c-secret'),
      accessToken: value('st-c-token'), refreshToken: value('st-c-refresh') }];
  }

  async function test(network, quiet = false) {
    const result = await flow('statistics.test', { network });
    const message = NETWORKS[network].name + ' conectado como ' + result.label +
      (result.videos ? ' · ' + result.videos + ' videos legibles en la primera página' : ' · aún no se encontraron videos') +
      (result.warning ? ' · Aviso: ' + result.warning : '');
    if (!quiet || result.warning) notice(message, Boolean(result.warning));
    return result;
  }

  async function afterConnect(network) {
    closeModal();
    accounts = await flow('statistics.accounts');
    view.tab = 'connections';
    render();
    try {
      await test(network);
    } catch (error) {
      notice('La cuenta se guardó, pero la prueba falló: ' + error.message, true);
    }
  }

  /* ---------- Lector de navegador ---------- */

  const BROWSER_TIPS = {
    youtube: 'Lee Contenido → Videos y Shorts de YouTube Studio, con vistas, me gusta, comentarios y retención de cada video.',
    instagram: 'Lee la pestaña Reels de tu perfil y las estadísticas de cada Reel.',
    facebook: 'Lee Contenido publicado de Meta Business Suite para tu página.',
    tiktok: 'Lee TikTok Studio → Contenido con las cifras de cada publicación.'
  };

  const READER_STEPS = [['preparing', 'Preparar'], ['opening', 'Abrir navegador'], ['login', 'Sesión'], ['listing', 'Recorrer videos'], ['details', 'Leer cifras']];

  function readerStep(stage) {
    if (stage === 'python' || stage === 'playwright') return 0;
    if (stage === 'navigate') return 3;
    const index = READER_STEPS.findIndex(([id]) => id === stage);
    return index < 0 ? READER_STEPS.length : index;
  }

  function readerPanel() {
    if (!reader) return '';
    const name = NETWORKS[reader.network]?.name || reader.network;
    if (reader.stage === 'done') {
      return '<section class="st-reader st-reader-ok"><h2>Lectura de ' + esc(name) + ' terminada</h2><p>' + number(reader.result?.count) +
        ' videos con cifras' + (reader.result?.missing ? ' · ' + number(reader.result.missing) + ' identificados sin cifras' : '') + '.</p>' +
        '<div class="row wrap">' + action('st-tab', 'Ver videos', 'videos', '') + action('st-reader-clear', 'Cerrar aviso', '') + '</div></section>';
    }
    if (reader.stage === 'error' || reader.stage === 'canceled') {
      return '<section class="st-reader st-reader-bad"><h2>' + (reader.stage === 'canceled' ? 'Lectura cancelada' : 'La lectura de ' + esc(name) + ' no terminó') + '</h2>' +
        (reader.error && reader.stage === 'error' ? '<p>' + esc(reader.error) + '</p>' : '') +
        '<div class="row wrap">' + action('st-browser', 'Intentar de nuevo', reader.network, '') + action('st-reader-clear', 'Cerrar aviso', '') + '</div></section>';
    }
    const current = readerStep(reader.stage);
    const steps = '<ol class="st-reader-steps">' + READER_STEPS.map(([, label], i) =>
      '<li class="' + (i < current ? 'done' : i === current ? 'now' : '') + '">' + esc(label) + '</li>').join('') + '</ol>';
    let body;
    if (reader.stage === 'login') {
      body = '<p class="st-reader-big">Inicia sesión en la ventana del navegador. Si no la ves, búscala en la barra de tareas.</p>' +
        '<p class="st-note">Es una ventana normal de Edge o Chrome con un perfil propio de Studio. Solo hace falta la primera vez: ' +
        'en cuanto entres, Studio abrirá tu contenido y leerá cada video por sí solo.</p>' +
        '<div class="row wrap">' + action('st-reader-stop', 'Cancelar', '') + '</div>';
    } else {
      const detail = reader.stage === 'details' && reader.total
        ? 'Video ' + number(reader.index) + ' de ' + number(reader.total) + ' · ' + number(reader.count) + ' con cifras'
        : reader.stage === 'listing' ? number(reader.found) + ' videos encontrados hasta ahora' : '';
      const progress = reader.stage === 'details' && reader.total
        ? '<div class="st-bar"><div style="width:' + (100 * reader.index / reader.total).toFixed(1) + '%"></div></div>' : '<div class="st-bar st-bar-busy"><div></div></div>';
      body = '<p class="st-reader-big">' + esc(reader.message || 'Trabajando…') + '</p>' + progress +
        (detail ? '<p class="st-note">' + esc(detail) + '</p>' : '') +
        (reader.stage === 'python' || reader.stage === 'playwright' ? '<p class="st-note">Puede tardar unos minutos según tu conexión. Solo ocurre la primera vez.</p>' : '') +
        '<div class="row wrap">' + action('st-reader-stop', 'Cancelar', '') + '</div>';
    }
    return '<section class="st-reader"><h2>Lector de ' + esc(name) + '</h2>' + steps + body + '</section>';
  }

  function watchReader() {
    clearInterval(readerTimer);
    readerTimer = setInterval(async () => {
      try {
        reader = await flow('statistics.browser.state');
      } catch { return; }
      const signature = JSON.stringify(reader);
      if (signature === readerSeen) return;
      readerSeen = signature;
      if (!reader || reader.finished) {
        clearInterval(readerTimer);
        readerTimer = null;
        rows = await flow('statistics.list');
        if (reader?.stage === 'done') notice('Lectura terminada: ' + reader.result.count + ' videos con cifras', !reader.result.count);
        if (reader?.stage === 'error') notice(reader.error, true);
      }
      if (state.page === 'statistics') render();
    }, 900);
  }

  function browserTab() {
    const busy = reader && !reader.finished;
    return readerPanel() +
      '<p class="st-lead">Úsalo para completar lo que la API no entrega (por ejemplo, el tiempo visto en TikTok) o mientras conectas tus cuentas. ' +
      'Se abre un navegador propio de Studio, inicias sesión una vez y la sesión queda guardada por red.</p>' +
      '<div class="st-connections">' + Object.entries(NETWORKS).map(([id]) =>
        '<article class="st-connection st-' + id + '"><header>' + badge(id) + '</header><p>' + esc(BROWSER_TIPS[id]) + '</p>' +
        action('st-browser', 'Leer ' + NETWORKS[id].name + ' automáticamente', id, '') .replace('<button', '<button' + (busy ? ' disabled' : '')) +
        '</article>').join('') + '</div>' +
      '<section class="panel st-panel"><h2>Cómo funciona</h2><ol class="st-plain">' +
      '<li>Pulsa el botón de la red: se abre una ventana normal de Edge o Chrome con un perfil propio de Studio, separado de tu navegador habitual.</li>' +
      '<li>La primera vez inicia sesión. La sesión queda guardada y las siguientes lecturas no te la piden.</li>' +
      '<li>Studio hace el resto solo: abre tu contenido (en YouTube, Videos y Shorts), recorre todas las páginas y lee las cifras de cada video. Verás el avance aquí arriba.</li></ol>' +
      '<p class="st-note">Si un video ya llegó por API, la lectura se suma a la misma ficha y se indica el origen de cada cifra. Las cifras abreviadas («1,2 K») se guardan con su texto original. Los cambios de diseño de cada red pueden afectar a la lectura.</p></section>';
  }

  /* ---------- acciones ---------- */

  async function handle(name, element) {
    const id = element.dataset.id;
    if (name === 'st-tab') { closeModal(); view.tab = id; return render(); }
    if (name === 'st-format') { view.format = id; return render(); }
    if (name === 'st-sort') {
      view.desc = view.sort === id ? !view.desc : id !== 'title' && id !== 'network';
      view.sort = id;
      return render();
    }
    if (name === 'st-detail') return detail(id);
    if (name === 'st-manual') return manualDialog(id);
    if (name === 'st-manual-save') {
      rows = await flow('statistics.manual', { id, values: Object.fromEntries(
        ['views', 'likes', 'comments', 'retention', 'followers'].map(key => [key, value('st-m-' + key)])) });
      closeModal();
      notice('Cifras guardadas');
      return render();
    }
    if (name === 'st-wizard') return wizard(id);
    if (name === 'st-guide') return flow('statistics.guide', { key: id });
    if (name === 'st-google') {
      element.disabled = true;
      element.textContent = 'Esperando la autorización en el navegador…';
      try {
        await flow('accounts.google', { clientId: value('st-c-client'), clientSecret: value('st-c-secret') });
        return await afterConnect('youtube');
      } finally { element.disabled = false; element.textContent = 'Autorizar canal de YouTube'; }
    }
    if (name === 'st-connect') {
      const [network, data] = connectionData(id);
      if (!data.accessToken) return notice('Pega el token de acceso', true);
      if (network === 'facebook' && !data.profileId) return notice('Escribe el ID de la página', true);
      element.disabled = true;
      const label = element.textContent;
      element.textContent = 'Verificando…';
      try {
        await flow('accounts.connect', { network, data });
        return await afterConnect(network);
      } finally { element.disabled = false; element.textContent = label; }
    }
    if (name === 'st-test') {
      element.disabled = true;
      element.textContent = 'Probando…';
      try { await test(id); } finally { element.disabled = false; element.textContent = 'Probar conexión'; }
      return;
    }
    if (name === 'st-disconnect') {
      await flow('accounts.disconnect', { network: id });
      accounts = await flow('statistics.accounts');
      notice(NETWORKS[id].name + ' desconectado. Las cifras ya guardadas se conservan.');
      return render();
    }
    if (name === 'st-sync') {
      if (!connectedCount()) { view.tab = 'connections'; render(); return notice('Primero conecta al menos una red', true); }
      element.disabled = true;
      element.textContent = 'Sincronizando…';
      try {
        const result = await flow('statistics.refresh');
        await load();
        render();
        notice(result.count + ' publicaciones actualizadas' + (result.errors.length ? ' · ' + result.errors[0] : ''), result.errors.length > 0);
      } finally { element.disabled = false; element.textContent = 'Sincronizar ahora'; }
      return;
    }
    if (name === 'st-export') {
      const file = await flow('statistics.export');
      return modal('Datos listos para Claude', '<p class="st-note">' + esc(file) + '</p>' +
        btn('system-open-data', 'Abrir archivo', 'secondary', 'data-path="' + esc(file) + '"'));
    }
    if (name === 'st-browser') {
      reader = await flow('statistics.browser', { network: id });
      readerSeen = '';
      view.tab = 'browser';
      render();
      return watchReader();
    }
    if (name === 'st-reader-stop') {
      element.disabled = true;
      reader = await flow('statistics.browser.stop') || reader;
      return render();
    }
    if (name === 'st-reader-clear') { reader = null; return render(); }
  }

  document.addEventListener('click', event => {
    const element = event.target.closest('[data-action^="st-"]');
    if (!element) return;
    handle(element.dataset.action, element).catch(error => notice(error.message, true));
  });

  document.addEventListener('change', event => {
    const map = { 'st-f-network': 'network', 'st-f-period': 'period', 'st-f-tag': 'tag' };
    if (!map[event.target.id]) return;
    view[map[event.target.id]] = event.target.value;
    render();
  });

  let searchTimer;
  document.addEventListener('input', event => {
    if (event.target.id !== 'st-search') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      view.search = event.target.value;
      const caret = event.target.selectionStart;
      render();
      const box = $('#st-search');
      if (box) { box.focus(); box.setSelectionRange(caret, caret); }
    }, 180);
  });

  /** Abre la sección en la pestaña de conexiones (desde Configuración o Publicación). */
  function openConnections(network) {
    view.tab = 'connections';
    if (network && GUIDES[network]) setTimeout(() => wizard(network), 0);
  }

  window.Statistics = { load, page, openConnections };
})();
