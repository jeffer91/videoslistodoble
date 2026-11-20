'use strict';
/**
 * Publicación automática.
 *
 * Toma los videos que el usuario ya revisó y aprobó, los adapta a lo que pide
 * cada red (duración, formato, texto, hashtags, visibilidad) y los programa en
 * los horarios configurados, sin repetir contenido:
 *   1. El mismo archivo (o su huella SHA-256) nunca va dos veces a la misma cuenta.
 *   2. El mismo récord (proyecto) solo se publica una vez por red.
 *   3. Si las estadísticas muestran que ya existe en la red un video con el mismo
 *      título (publicado a mano), tampoco se repite.
 * La cola existente (publishing.cjs) hace la entrega real y sus reintentos.
 */
const path = require('node:path');
const store = require('./store.cjs');
const delivery = require('./delivery.cjs');
const production = require('./production.cjs');
const { recordKey } = require('./insights.cjs');

const STATE = 'publicacion-automatica';
const NETWORKS = ['youtube', 'tiktok', 'instagram', 'facebook'];
const NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTE = 60000;

/** Lo que exige cada red para publicar por API (fuentes oficiales de cada plataforma). */
const REQUIREMENTS = {
  youtube: {
    short: { min: 1, max: 180, vertical: true }, long: { min: 1, max: 43200 },
    title: 100, description: 4700, hashtags: 15, daily: 6,
    notes: ['Shorts: video vertical o cuadrado de hasta 3 minutos; Studio añade #Shorts.',
      'Videos largos: horizontal 16:9, título de hasta 100 caracteres.',
      'Por navegador se publica desde YouTube Studio con tu sesión, como si lo subieras tú.',
      'Por API, un proyecto de Google sin auditar deja los videos bloqueados como privados.']
  },
  tiktok: {
    short: { min: 3, max: 600 }, long: { min: 3, max: 600 },
    title: 100, description: 1950, hashtags: 6, daily: 15,
    notes: ['Texto de hasta 2.200 caracteres; la duración máxima depende de tu cuenta (normalmente 10 min).',
      'Por navegador se publica desde TikTok Studio con tu sesión.',
      'Por API, sin auditoría de TikTok solo se publica en privado: usa el modo borrador o Ayrshare.',
      'TikTok limita las publicaciones por API a unas 15 al día por cuenta.']
  },
  instagram: {
    short: { min: 3, max: 900 }, long: { min: 3, max: 900 },
    title: 100, description: 1950, hashtags: 30, daily: 25,
    notes: ['Todo video se publica como Reel: de 3 segundos a 15 minutos y hasta 1 GB.',
      'Texto de hasta 2.200 caracteres y como máximo 30 hashtags.',
      'Instagram permite unas 50 publicaciones por API cada 24 horas; Studio usa como máximo 25.']
  },
  facebook: {
    short: { min: 3, max: 14400 }, long: { min: 1, max: 14400 },
    title: 100, description: 4700, hashtags: 5, daily: 25,
    notes: ['Reels de página: vertical 9:16, de 3 a 90 segundos (más largos se publican como video).',
      'Videos de página: horizontal, hasta 4 horas.',
      'Por navegador se publica desde Meta Business Suite y, si lo activas, también en tu grupo.',
      'Por API solo páginas: Meta retiró en 2024 la publicación por API en grupos.',
      'Facebook permite 30 Reels por API cada 24 horas; Studio usa como máximo 25.']
  }
};

const CLOSING = {
  youtube: 'Suscríbete para más récords del fútbol.',
  tiktok: 'Síguenos para más récords ⚽',
  instagram: 'Guarda este Reel y síguenos para más récords ⚽',
  facebook: 'Síguenos en la página para más récords del fútbol.'
};

const DEFAULTS = {
  enabled: false, authorized: false, horizonDays: 2, gapMinutes: 90, hashtags: '#futbol #records',
  networks: {
    youtube: { enabled: false, method: 'browser', hours: ['12:30', '19:30'], formats: ['short', 'long'], privacy: 'public', audited: false, closing: CLOSING.youtube },
    tiktok: { enabled: false, method: 'browser', hours: ['13:00', '20:00'], formats: ['short'], privacy: 'PUBLIC_TO_EVERYONE', mode: 'inbox', audited: false, closing: CLOSING.tiktok },
    instagram: { enabled: false, method: 'browser', hours: ['12:00', '19:00'], formats: ['short'], closing: CLOSING.instagram },
    facebook: { enabled: false, method: 'browser', hours: ['12:15', '19:15'], formats: ['short', 'long'], closing: CLOSING.facebook,
      groupEnabled: false, groupUrl: '' }
  }
};

function merged(saved) {
  const base = structuredClone(DEFAULTS);
  const value = { ...base, ...(saved || {}), networks: { ...base.networks } };
  for (const network of NETWORKS) value.networks[network] = { ...base.networks[network], ...(saved?.networks?.[network] || {}) };
  return value;
}

function cleanText(value, max) {
  const text = String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  if (text.length > max) throw Error('Texto demasiado largo (máximo ' + max + ' caracteres)');
  return text;
}

function hashtagWords(text) {
  return String(text || '').split(/[\s,]+/).map(word => word.replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean);
}

/** Etiqueta de récord → hashtag sin espacios ni acentos raros: «Pelé» → «Pele», «Liga Pro» → «LigaPro». */
function tagWord(value) {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join('').slice(0, 50);
}

function clip(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, '').trim() + '…';
}

function createAutopublish(root, publishing, now = () => Date.now()) {
  const config = () => merged(production.readState(root, STATE, null));

  function saveConfig(patch = {}) {
    const current = config();
    const next = merged(current);
    if (patch.enabled !== undefined) next.enabled = patch.enabled === true;
    if (patch.authorized !== undefined) next.authorized = patch.authorized === true;
    if (patch.hashtags !== undefined) next.hashtags = cleanText(patch.hashtags, 300);
    if (patch.gapMinutes !== undefined) {
      const gap = Number(patch.gapMinutes);
      if (!Number.isInteger(gap) || gap < 15 || gap > 1440) throw Error('La separación debe estar entre 15 y 1440 minutos');
      next.gapMinutes = gap;
    }
    for (const [network, value] of Object.entries(patch.networks || {})) {
      if (!NETWORKS.includes(network)) throw Error('Red desconocida');
      const target = next.networks[network];
      if (value.enabled !== undefined) target.enabled = value.enabled === true;
      if (value.audited !== undefined) target.audited = value.audited === true;
      if (value.hours !== undefined) {
        const hours = [...new Set((Array.isArray(value.hours) ? value.hours : String(value.hours).split(/[\s,;]+/)).map(h => String(h).trim()).filter(Boolean))].sort();
        if (hours.length > 8 || hours.some(h => !HOUR.test(h))) throw Error('Escribe hasta 8 horas con el formato 12:30');
        target.hours = hours;
      }
      if (value.formats !== undefined) {
        const formats = [...new Set(value.formats)].filter(f => ['short', 'long'].includes(f));
        target.formats = formats;
      }
      if (value.closing !== undefined) target.closing = cleanText(value.closing, 200);
      if (value.privacy !== undefined) {
        const options = network === 'youtube' ? ['public', 'unlisted', 'private'] :
          network === 'tiktok' ? ['PUBLIC_TO_EVERYONE', 'FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'] : [];
        if (!options.includes(value.privacy)) throw Error('Visibilidad inválida para ' + NAMES[network]);
        target.privacy = value.privacy;
      }
      if (value.mode !== undefined && network === 'tiktok') target.mode = value.mode === 'direct' ? 'direct' : 'inbox';
      if (value.method !== undefined) target.method = value.method === 'api' ? 'api' : 'browser';
      if (network === 'facebook' && value.groupUrl !== undefined) {
        const url = String(value.groupUrl || '').trim();
        if (url) {
          let parsed;
          try { parsed = new URL(url); } catch { throw Error('Escribe la dirección completa del grupo, por ejemplo https://www.facebook.com/groups/11contra11'); }
          if (parsed.protocol !== 'https:' || !/(^|\.)facebook\.com$/.test(parsed.hostname) || !/^\/groups\/[\w.-]+\/?$/.test(parsed.pathname)) {
            throw Error('La dirección del grupo debe ser https://www.facebook.com/groups/…');
          }
          target.groupUrl = 'https://www.facebook.com' + parsed.pathname.replace(/\/$/, '');
        } else target.groupUrl = '';
      }
      if (network === 'facebook' && value.groupEnabled !== undefined) target.groupEnabled = value.groupEnabled === true;
    }
    if (next.enabled && !next.authorized) throw Error('Marca la autorización antes de activar la publicación automática');
    production.writeState(root, STATE, next);
    return next;
  }

  /** ¿Puede esta red publicar sola hoy? */
  function readiness(network, cfg = config(), accounts = publishing.accountDetails()) {
    if (cfg.networks[network].method !== 'api') {
      return { ok: true, browser: true, note: 'Publica desde la web de ' + NAMES[network] + ' con la sesión del lector de navegador. Inicia sesión allí una vez.' };
    }
    const account = accounts[network];
    if (!account) return { ok: false, reason: 'Conecta la cuenta en Estadísticas → Conexiones.' };
    const settings = cfg.networks[network];
    if (network === 'youtube' && !settings.audited) {
      return { ok: false, blocked: true, reason: 'YouTube bloquea como privados los videos subidos con un proyecto de Google sin auditar. Solicita la auditoría y márcala cuando la aprueben.' };
    }
    if (network === 'tiktok' && account.provider !== 'ayrshare' && settings.mode === 'direct' && !settings.audited) {
      return { ok: false, blocked: true, reason: 'Sin auditoría de TikTok, la publicación directa solo funciona en privado. Usa el modo borrador o Ayrshare.' };
    }
    if (network === 'tiktok' && settings.mode === 'inbox' && account.provider !== 'ayrshare') {
      return { ok: true, note: 'Llega a tus borradores de TikTok: ábrelo en la app y pulsa Publicar.' };
    }
    return { ok: true };
  }

  /** Videos aprobados y con control de calidad superado, del más antiguo al más reciente. */
  function candidates() {
    const list = [];
    const add = (kind, id, title, files, extra) => {
      for (const full of files) {
        const target = { kind, id, file: path.basename(full) };
        let entry;
        try { entry = delivery.entryFor(root, target); } catch { continue; }
        if (!entry.approval || !entry.quality?.ok) continue;
        list.push({ target, entry, title, format: kind === 'short' ? 'short' : 'long', sha256: entry.approval.sha256,
          approvedAt: entry.approval.at, duration: Number(entry.quality.duration) || 0,
          width: Number(entry.quality.width) || 0, height: Number(entry.quality.height) || 0, ...extra });
      }
    };
    for (const project of store.listProjects(root)) {
      if (project.status === 'auxiliary') continue;
      add('short', project.id, project.title, delivery.outputs(root, 'short', project.id), { tags: project.tags || {} });
    }
    for (const week of store.listWeeks(root)) add('week', week.id, week.title, week.outputs || [], { tags: {} });
    return list.sort((a, b) => String(a.approvedAt).localeCompare(String(b.approvedAt)));
  }

  /** Qué hay ya en cada red: cola de Studio + catálogo de estadísticas (videos subidos a mano). */
  function usage(accounts) {
    // Un envío automático que el usuario canceló cuenta como «no publicar aquí»: no se vuelve a programar.
    const jobs = publishing.jobsRaw().filter(job => job.status !== 'cancelado' || job.auto);
    const rows = publishing.stats();
    const result = {};
    for (const network of NETWORKS) {
      // Una cuenta por red: lo enviado por API o por navegador cuenta igual para no repetir.
      const own = jobs.filter(job => job.network === network);
      result[network] = {
        jobs: own,
        active: own.filter(job => job.status !== 'cancelado'),
        sha: new Set(own.map(job => job.sha256)),
        files: new Set(own.map(job => job.target.kind + ':' + job.target.file)),
        records: new Set(own.map(job => job.target.kind + ':' + job.target.id)),
        titles: new Set(rows.filter(row => row.network === network && !row.localJob).map(recordKey).filter(Boolean))
      };
    }
    return result;
  }

  function fits(candidate, network, cfg) {
    const settings = cfg.networks[network];
    if (!settings.formats.includes(candidate.format)) {
      return { ok: false, off: true, reason: candidate.format === 'short' ? 'Shorts desactivados en esta red' : 'Videos largos desactivados en esta red' };
    }
    const rule = REQUIREMENTS[network][candidate.format];
    if (candidate.duration < rule.min) return { ok: false, reason: 'Dura menos de ' + rule.min + ' s' };
    if (candidate.duration > rule.max) return { ok: false, reason: 'Supera ' + Math.round(rule.max / 60) + ' min, el máximo de ' + NAMES[network] };
    if (rule.vertical && candidate.width > candidate.height) return { ok: false, reason: 'Un Short debe ser vertical o cuadrado' };
    return { ok: true };
  }

  function duplicate(candidate, used) {
    if (used.sha.has(candidate.sha256) || used.files.has(candidate.target.kind + ':' + candidate.target.file)) return 'Este mismo video ya se envió a esta cuenta';
    if (candidate.target.kind === 'short' && used.records.has('short:' + candidate.target.id)) return 'Este récord ya se publicó en esta red';
    const key = recordKey({ title: candidate.title });
    if (key && used.titles.has(key)) return 'Ya hay en la red un video con este mismo título';
    return null;
  }

  /** Texto, hashtags y opciones adaptados a cada red. Cada red recibe su propio cierre y su propia selección de hashtags. */
  function adapt(candidate, network, cfg = config()) {
    const rule = REQUIREMENTS[network];
    const settings = cfg.networks[network];
    const base = candidate.entry.networks?.[network] || {};
    const title = clip(String(base.title || candidate.title || '').trim() || 'Récord de fútbol', rule.title);
    const fromRecord = Object.values(candidate.tags || {}).flat().map(tagWord);
    const words = [...new Set([...hashtagWords(cfg.hashtags), ...(base.tags || []).map(tagWord), ...fromRecord]
      .map(word => word.slice(0, 50)).filter(Boolean))];
    if (network === 'youtube' && candidate.format === 'short' && !words.some(w => w.toLowerCase() === 'shorts')) words.unshift('Shorts');
    if (network === 'instagram' && candidate.format === 'short' && !words.some(w => w.toLowerCase() === 'reels')) words.push('Reels');
    const tags = [];
    for (const word of words) {
      if (tags.length >= Math.min(rule.hashtags, 25)) break;
      if ([...tags, word].join(',').length > 440) break;
      tags.push(word);
    }
    const description = clip([String(base.description || '').trim(), settings.closing].filter(Boolean).join('\n\n'), rule.description - 50);
    return {
      title, description, tags, coverTime: Number(base.coverTime) || 0, thumbnail: 0,
      privacy: network === 'youtube' || network === 'tiktok' ? settings.privacy : '',
      mode: network === 'tiktok' ? settings.mode : undefined,
      comments: true, duet: true, stitch: true, madeForKids: false, branded: false, ownBrand: false
    };
  }

  function slots(settings, from, days) {
    const list = [];
    for (let day = 0; day <= days; day++) {
      for (const hour of settings.hours) {
        const [h, m] = hour.split(':').map(Number);
        const date = new Date(from);
        date.setDate(date.getDate() + day);
        date.setHours(h, m, 0, 0);
        if (date.getTime() > from + 5 * MINUTE) list.push(date);
      }
    }
    return list.sort((a, b) => a - b);
  }

  const dayKey = date => { const d = new Date(date); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

  /** Rellena los próximos horarios libres de cada red con el siguiente video apto y no repetido. */
  async function plan() {
    const cfg = config();
    if (!cfg.enabled || !cfg.authorized) return { skipped: true, created: [], errors: [] };
    const accounts = publishing.accountDetails();
    const used = usage(accounts);
    const pool = candidates();
    const created = [], errors = [];
    const start = now();
    for (const network of NETWORKS) {
      const settings = cfg.networks[network];
      if (!settings.enabled || !settings.hours.length || !readiness(network, cfg, accounts).ok) continue;
      const taken = used[network].active.map(job => Date.parse(job.dueAt)).filter(Number.isFinite);
      const perDay = new Map();
      for (const time of taken) perDay.set(dayKey(time), (perDay.get(dayKey(time)) || 0) + 1);
      const skip = new Set();
      for (const slot of slots(settings, start, cfg.horizonDays)) {
        const time = slot.getTime();
        if (taken.some(other => Math.abs(other - time) < cfg.gapMinutes * MINUTE)) continue;
        if ((perDay.get(dayKey(time)) || 0) >= Math.min(REQUIREMENTS[network].daily, settings.hours.length)) continue;
        const next = pool.find(item => !skip.has(item.sha256) && fits(item, network, cfg).ok && !duplicate(item, used[network]));
        if (!next) break;
        skip.add(next.sha256);
        try {
          const job = await publishing.enqueue({ target: next.target, network, dueAt: slot.toISOString(), confirmed: true,
            metadata: adapt(next, network, cfg), auto: true, method: settings.method,
            groupUrl: network === 'facebook' && settings.groupEnabled ? settings.groupUrl : '' });
          created.push({ network, title: next.title, dueAt: job.dueAt });
          used[network].sha.add(next.sha256);
          used[network].files.add(next.target.kind + ':' + next.target.file);
          used[network].records.add(next.target.kind + ':' + next.target.id);
          taken.push(time);
          perDay.set(dayKey(time), (perDay.get(dayKey(time)) || 0) + 1);
        } catch (error) {
          errors.push(NAMES[network] + ' · ' + next.title + ': ' + error.message);
        }
      }
    }
    production.writeState(root, STATE, { ...cfg, lastPlanAt: new Date(start).toISOString(), lastCreated: created.length, lastErrors: errors.slice(0, 20) });
    return { created, errors };
  }

  /** Estado completo para la pantalla: configuración, requisitos, cola próxima y matriz video × red. */
  function overview() {
    const cfg = config();
    const accounts = publishing.accountDetails();
    const used = usage(accounts);
    const ready = Object.fromEntries(NETWORKS.map(network => [network, readiness(network, cfg, accounts)]));
    const rows = candidates().reverse().slice(0, 60).map(item => ({
      title: item.title, target: item.target, format: item.format, duration: item.duration, approvedAt: item.approvedAt,
      networks: Object.fromEntries(NETWORKS.map(network => {
        const job = used[network].jobs.find(j => j.sha256 === item.sha256 || (j.target.kind === item.target.kind && j.target.file === item.target.file));
        if (job) return [network, { state: job.status, dueAt: job.dueAt, url: job.url || null, auto: Boolean(job.auto) }];
        const dup = duplicate(item, used[network]);
        if (dup) return [network, { state: 'repetido', reason: dup }];
        const fit = fits(item, network, cfg);
        if (!fit.ok) return [network, { state: fit.off ? 'desactivado' : 'no-apto', reason: fit.reason }];
        if (!cfg.networks[network].enabled || !ready[network].ok) return [network, { state: 'en-espera', reason: ready[network].reason || 'Red desactivada' }];
        return [network, { state: 'listo' }];
      }))
    }));
    const upcoming = publishing.jobsRaw().filter(job => ['pendiente', 'programado', 'procesando', 'enviando'].includes(job.status))
      .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt))).slice(0, 30)
      .map(job => ({ id: job.id, network: job.network, title: job.metadata?.title, dueAt: job.dueAt, status: job.status, auto: Boolean(job.auto),
        method: job.method || 'api', group: Boolean(job.groupUrl), target: job.target }));
    const recent = publishing.jobsRaw().filter(job => ['publicado', 'fallo', 'revisar'].includes(job.status))
      .sort((a, b) => String(b.updatedAt || b.dueAt).localeCompare(String(a.updatedAt || a.dueAt))).slice(0, 15)
      .map(job => ({ id: job.id, network: job.network, title: job.metadata?.title, at: job.publishedAt || job.updatedAt, status: job.status,
        url: job.url, message: job.message, auto: Boolean(job.auto), method: job.method || 'api', screenshot: job.screenshot || null }));
    return { config: cfg, requirements: REQUIREMENTS, readiness: ready, accounts: Object.fromEntries(NETWORKS.map(n => [n, accounts[n] ? { label: accounts[n].label, provider: accounts[n].provider } : null])),
      rows, upcoming, recent };
  }

  return { config, saveConfig, readiness, candidates, adapt, plan, overview };
}

module.exports = { createAutopublish, REQUIREMENTS, NETWORKS, tagWord };
