'use strict';
/**
 * Central de datos: convierte las mediciones guardadas en comparaciones y
 * conclusiones que ayudan a decidir qué publicar y dónde.
 *
 * Entrada: filas de publishing.stats() y fotos diarias de publishing.growth().
 * Todo es cálculo puro (sin disco ni red) para poder probarlo y reutilizarlo.
 */

const NETWORKS = ['youtube', 'instagram', 'facebook', 'tiktok'];
const NAMES = { youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAY = 86400000;

const views = row => Number(row?.metrics?.views);
const hasViews = row => Number.isFinite(views(row));

function median(values) {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return null;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
}

function mean(values) {
  const list = values.filter(Number.isFinite);
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

function engagement(row) {
  const m = row.metrics || {};
  if (!m.views) return null;
  return 100 * ((m.likes || 0) + (m.comments || 0) + (m.shares || 0)) / m.views;
}

function compact(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const format = (n, digits) => new Intl.NumberFormat('es-EC', { maximumFractionDigits: digits }).format(n);
  if (abs >= 1e6) return format(value / 1e6, 1) + ' M';
  if (abs >= 1e4) return format(value / 1e3, abs >= 1e5 ? 0 : 1) + ' K';
  return format(Math.round(value), 0);
}

const times = n => new Intl.NumberFormat('es-EC', { maximumFractionDigits: 1 }).format(n) + '×';
const pct = n => (n > 0 ? '+' : '') + new Intl.NumberFormat('es-EC', { maximumFractionDigits: 1 }).format(n) + ' %';

/** Clave para reconocer el mismo récord publicado en varias redes. */
function recordKey(row) {
  if (row.target?.id) return 'p:' + row.target.id;
  const text = String(row.title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter(word => word.length > 1).slice(0, 7).join(' ');
  return text.split(' ').length >= 3 ? 't:' + text : null;
}

/** Vistas ganadas por día entre las dos últimas mediciones (video «en subida»). */
function momentum(row) {
  const points = (row.history || []).filter(h => Number.isFinite(Number(h.metrics?.views)) && Number.isFinite(Date.parse(h.at)));
  if (points.length < 2) return null;
  const last = points.at(-1), previous = points.at(-2);
  const days = (Date.parse(last.at) - Date.parse(previous.at)) / DAY;
  const gained = Number(last.metrics.views) - Number(previous.metrics.views);
  if (days < 0.25 || gained <= 0) return null;
  return { gained, perDay: gained / days, since: previous.at };
}

function growthChange(list, days, key, now) {
  const points = (list || []).filter(p => p[key] != null);
  if (points.length < 2) return null;
  const last = points.at(-1);
  const limit = Date.parse(last.day) - days * DAY;
  const base = [...points].reverse().find(p => Date.parse(p.day) <= limit) || points[0];
  if (base === last) return null;
  const change = last[key] - base[key];
  return { change, percent: base[key] ? 100 * change / base[key] : null, from: base.day, to: last.day,
    days: Math.max(1, Math.round((Date.parse(last.day) - Date.parse(base.day)) / DAY)) };
}

function networkSummary(network, rows, growth, now) {
  const own = rows.filter(row => row.network === network);
  const counted = own.filter(hasViews);
  const byFormat = format => counted.filter(row => row.format === format);
  const best = counted.slice().sort((a, b) => views(b) - views(a))[0];
  const list = growth[network] || [];
  const recent = counted.filter(row => row.publishedAt && now - Date.parse(row.publishedAt) <= 30 * DAY);
  return {
    network, name: NAMES[network], videos: own.length,
    views: counted.reduce((sum, row) => sum + views(row), 0),
    average: mean(counted.map(views)), median: median(counted.map(views)),
    engagement: mean(counted.map(engagement)),
    retention: mean(own.map(row => Number(row.metrics?.retention))),
    averageWatchTime: mean(own.map(row => Number(row.metrics?.averageWatchTime))),
    shorts: { videos: byFormat('short').length, average: mean(byFormat('short').map(views)) },
    long: { videos: byFormat('long').length, average: mean(byFormat('long').map(views)) },
    last30: { videos: recent.length, views: recent.reduce((sum, row) => sum + views(row), 0) },
    followers: list.filter(p => p.followers != null).at(-1)?.followers ?? null,
    followers30: growthChange(list, 30, 'followers', now),
    views30: growthChange(list, 30, 'views', now),
    best: best ? { id: best.id, title: best.title, views: views(best) } : null
  };
}

function byCalendar(rows, read, size) {
  const groups = Array.from({ length: size }, (_, index) => ({ index, videos: 0, average: null, values: [] }));
  for (const row of rows) {
    const index = read(new Date(row.publishedAt));
    if (index == null) continue;
    groups[index].values.push(views(row) / (row._median || 1));
  }
  for (const group of groups) {
    group.videos = group.values.length;
    group.average = mean(group.values);
    delete group.values;
  }
  return groups;
}

function buildCentral(allRows, growth = {}, now = Date.now()) {
  const rows = allRows.filter(row => NETWORKS.includes(row.network));
  const counted = rows.filter(hasViews);
  const medians = Object.fromEntries(NETWORKS.map(n => [n, median(counted.filter(r => r.network === n).map(views))]));
  // Cada video se compara con la mediana de su propia red, para no mezclar escalas.
  const relative = counted.filter(row => medians[row.network]).map(row => ({ ...row, _median: medians[row.network] }));

  const networks = NETWORKS.map(n => networkSummary(n, rows, growth, now)).filter(s => s.videos || s.followers != null);

  // Mismo récord en varias redes.
  const groups = new Map();
  for (const row of counted) {
    const key = recordKey(row);
    if (!key) continue;
    const group = groups.get(key) || { key, title: row.title, networks: {} };
    const current = group.networks[row.network];
    if (!current || views(row) > current.views) group.networks[row.network] = { id: row.id, views: views(row), engagement: engagement(row) };
    if (row.target?.id || String(row.title || '').length < String(group.title || '').length) group.title = row.title;
    groups.set(key, group);
  }
  const crossPosts = [...groups.values()].filter(g => Object.keys(g.networks).length >= 2).map(group => {
    const entries = Object.entries(group.networks).sort((a, b) => b[1].views - a[1].views);
    return { ...group, winner: entries[0][0], total: entries.reduce((sum, [, v]) => sum + v.views, 0) };
  }).sort((a, b) => b.total - a.total).slice(0, 25);

  // Días y horas: solo fechas con hora real (las lecturas del navegador solo traen el día).
  const timed = relative.filter(row => row.publishedAt && row.metricsSource !== 'navegador');
  const weekdays = byCalendar(relative.filter(row => row.publishedAt), date => Number.isFinite(date.getTime()) ? date.getDay() : null, 7);
  const hours = byCalendar(timed, date => Number.isFinite(date.getTime()) ? date.getHours() : null, 24);

  const risers = counted.map(row => ({ row, move: momentum(row) })).filter(x => x.move)
    .sort((a, b) => b.move.perDay - a.move.perDay).slice(0, 8)
    .map(({ row, move }) => ({ id: row.id, title: row.title, network: row.network, format: row.format, views: views(row), ...move }));

  const outliers = relative.filter(row => counted.filter(r => r.network === row.network).length >= 5 && views(row) >= 2.5 * row._median)
    .sort((a, b) => views(b) / b._median - views(a) / a._median).slice(0, 8)
    .map(row => ({ id: row.id, title: row.title, network: row.network, format: row.format, views: views(row), ratio: views(row) / row._median }));

  const recentLow = relative.filter(row => row.publishedAt && now - Date.parse(row.publishedAt) <= 14 * DAY &&
    now - Date.parse(row.publishedAt) >= 2 * DAY && views(row) < 0.5 * row._median);

  const themes = [];
  for (const [field, label] of [['tipos', 'Tema'], ['jugadores', 'Jugador'], ['competiciones', 'Competición']]) {
    const map = new Map();
    for (const row of relative) for (const tag of row.tags?.[field] || []) {
      const item = map.get(tag) || { tag, field: label, values: [] };
      item.values.push(views(row) / row._median);
      map.set(tag, item);
    }
    for (const item of map.values()) if (item.values.length >= 3) themes.push({ tag: item.tag, field: item.field, videos: item.values.length, index: mean(item.values) });
  }
  themes.sort((a, b) => b.index - a.index);

  return { generatedAt: new Date(now).toISOString(), totals: { videos: rows.length, views: counted.reduce((s, r) => s + views(r), 0) },
    networks, growth, crossPosts, weekdays, hours, risers, outliers, themes: themes.slice(0, 12),
    insights: conclusions({ networks, crossPosts, weekdays, hours, outliers, recentLow, themes, risers, relative }) };
}

/** Frases concretas, ordenadas de la más útil a la menos. */
function conclusions({ networks, crossPosts, weekdays, hours, outliers, recentLow, themes, risers, relative }) {
  const list = [];
  const ranked = networks.filter(n => n.videos >= 3 && n.average).sort((a, b) => b.average - a.average);
  if (ranked.length >= 2) {
    const [top, bottom] = [ranked[0], ranked.at(-1)];
    list.push({ kind: 'good', title: top.name + ' es tu red más fuerte',
      text: 'Promedia ' + compact(top.average) + ' vistas por video: ' + times(top.average / bottom.average) + ' lo que promedia ' + bottom.name + '.' });
  }
  const engaged = networks.filter(n => n.videos >= 3 && n.engagement != null).sort((a, b) => b.engagement - a.engagement);
  if (engaged.length >= 2 && engaged[0].network !== ranked[0]?.network) {
    list.push({ kind: 'info', title: 'Donde más interactúan: ' + engaged[0].name,
      text: 'El ' + new Intl.NumberFormat('es-EC', { maximumFractionDigits: 1 }).format(engaged[0].engagement) + ' % de quienes ven tus videos dan me gusta, comentan o comparten.' });
  }
  for (const n of networks) {
    if (n.followers30 && n.followers30.change !== 0) {
      const up = n.followers30.change > 0;
      list.push({ kind: up ? 'good' : 'warn', title: n.name + (up ? ' está creciendo' : ' está perdiendo seguidores'),
        text: (up ? 'Ganó ' : 'Perdió ') + compact(Math.abs(n.followers30.change)) + ' seguidores en ' + n.followers30.days + ' días' +
          (n.followers30.percent != null ? ' (' + pct(n.followers30.percent) + ').' : '.') });
    }
  }
  for (const n of networks) {
    if (n.shorts.videos >= 3 && n.long.videos >= 3 && n.shorts.average && n.long.average) {
      const shortsWin = n.shorts.average >= n.long.average;
      const ratio = shortsWin ? n.shorts.average / n.long.average : n.long.average / n.shorts.average;
      if (ratio >= 1.3) list.push({ kind: 'info', title: 'En ' + n.name + ' rinden más los ' + (shortsWin ? 'Shorts' : 'videos largos'),
        text: 'Promedian ' + compact(shortsWin ? n.shorts.average : n.long.average) + ' vistas frente a ' +
          compact(shortsWin ? n.long.average : n.shorts.average) + ' (' + times(ratio) + ').' });
    }
  }
  if (outliers[0]) {
    const o = outliers[0];
    list.push({ kind: 'good', title: 'Video que despegó', id: o.id,
      text: '«' + o.title + '» logró ' + times(o.ratio) + ' la mediana de ' + NAMES[o.network] + '. Repite su tema o su gancho.' });
  }
  if (risers[0]) {
    const r = risers[0];
    list.push({ kind: 'good', title: 'Ahora mismo está subiendo', id: r.id,
      text: '«' + r.title + '» gana unas ' + compact(r.perDay) + ' vistas por día en ' + NAMES[r.network] + '.' });
  }
  const days = weekdays.filter(d => d.videos >= 3 && d.average);
  if (days.length >= 3 && relative.length >= 15) {
    const best = days.slice().sort((a, b) => b.average - a.average)[0];
    if (best.average >= 1.2) list.push({ kind: 'info', title: 'Mejor día para publicar: ' + WEEKDAYS[best.index],
      text: 'Los videos publicados ese día rinden ' + pct(100 * (best.average - 1)) + ' sobre la mediana de su red.' });
  }
  const slots = hours.filter(h => h.videos >= 3 && h.average);
  if (slots.length >= 3) {
    const best = slots.slice().sort((a, b) => b.average - a.average)[0];
    if (best.average >= 1.2) list.push({ kind: 'info', title: 'Mejor hora: entre las ' + best.index + ':00 y las ' + (best.index + 1) + ':00',
      text: 'Con fecha y hora exactas de la API, esa franja rinde ' + pct(100 * (best.average - 1)) + ' sobre la mediana.' });
  }
  if (themes[0] && themes[0].index >= 1.3) {
    list.push({ kind: 'good', title: themes[0].field + ' que más atrae: ' + themes[0].tag,
      text: 'Sus ' + themes[0].videos + ' videos rinden ' + times(themes[0].index) + ' la mediana de cada red.' });
  }
  const weakest = themes.filter(t => t.index <= 0.6).at(-1);
  if (weakest) list.push({ kind: 'warn', title: weakest.field + ' que menos rinde: ' + weakest.tag,
    text: 'Sus ' + weakest.videos + ' videos se quedan en ' + times(weakest.index) + ' la mediana.' });
  if (crossPosts.length >= 3) {
    const wins = {};
    for (const group of crossPosts) wins[group.winner] = (wins[group.winner] || 0) + 1;
    const [network, count] = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
    list.push({ kind: 'info', title: 'Con el mismo récord, gana ' + NAMES[network],
      text: 'De ' + crossPosts.length + ' récords publicados en varias redes, ' + NAMES[network] + ' tuvo más vistas en ' + count + '.' });
  }
  if (recentLow.length) {
    list.push({ kind: 'warn', title: recentLow.length + (recentLow.length === 1 ? ' video reciente no arranca' : ' videos recientes no arrancan'),
      text: 'Publicados en las últimas dos semanas y por debajo de la mitad de la mediana de su red. Revisa su miniatura, título o gancho.' });
  }
  return list;
}

module.exports = { buildCentral, recordKey, momentum, median };
