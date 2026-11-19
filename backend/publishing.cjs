'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const store = require('./store.cjs');
const production = require('./production.cjs');
const delivery = require('./delivery.cjs');
const clients = require('./network-clients.cjs');
const catalog = require('./catalog.cjs');

const QUEUE = 'cola-publicacion';
const VAULT = 'cuentas-cifradas';
const NETWORKS = delivery.NETWORKS;
const ACCOUNT_NETWORKS = [...NETWORKS, 'facebook'];
const INVENTORY = 'catalogo-estadistico';
const WAIT = 45000;

function dateString(value) {
  if (!value) return '';
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw Error('Fecha de programación inválida');
  return new Date(result).toISOString();
}

function normalizeSecrets(data) {
  const secrets = {};
  for (const key of ['accessToken', 'refreshToken', 'clientId', 'clientSecret', 'profileId']) {
    const value = String(data?.[key] || '').trim();
    if (value.length > 5000 || /[\u0000-\u001f]/.test(value)) throw Error('Dato de acceso inválido');
    secrets[key] = value;
  }
  secrets.provider = data?.provider === 'ayrshare' ? 'ayrshare' : 'direct';
  secrets.expiresAt = secrets.provider === 'ayrshare' ? '' : dateString(data?.expiresAt);
  if (!secrets.accessToken) throw Error('Falta el token de acceso');
  return secrets;
}

function safeLink(network, input) {
  if (!input) return null;
  const url = new URL(input);
  const known = {
    youtube: ['www.youtube.com', 'youtube.com', 'youtu.be'],
    tiktok: ['www.tiktok.com', 'tiktok.com', 'vm.tiktok.com'],
    instagram: ['www.instagram.com', 'instagram.com']
  };
  if (url.protocol !== 'https:' || url.username || url.password || !known[network]?.includes(url.hostname) ||
      url.href.length > 1500) throw Error('Introduce un enlace HTTPS de ' + network);
  return url.href;
}

function validNetwork(network) {
  if (!NETWORKS.includes(network)) throw Error('Red desconocida');
  return network;
}

function extractId(network, url, input) {
  const parsed = new URL(url);
  if (network === 'youtube') {
    const id = parsed.searchParams.get('v') || parsed.pathname.split('/').filter(Boolean).at(-1);
    if (!/^[\w-]{11}$/.test(id || '')) throw Error('Falta un identificador de YouTube válido');
    return id;
  }
  const id = String(input || (network === 'tiktok' ? parsed.pathname.match(/\/video\/(\d+)/)?.[1] : '') || '');
  if (id && !/^\d{1,40}$/.test(id)) throw Error('El identificador del video debe ser numérico');
  return id || null;
}

function createPublishing(root, vault, platform = clients) {
  const queue = () => production.readState(root, QUEUE, []);
  const credentials = () => production.readState(root, VAULT, {});
  const writeQueue = jobs => production.writeState(root, QUEUE, jobs);
  const locks = new Set();
  const refreshes = new Map();
  let running = false;
  let refreshing = false;

  function saveSecret(network, account) {
    if (!vault.isEncryptionAvailable() || vault.getSelectedStorageBackend?.() === 'basic_text') {
      throw Error('El sistema no ofrece cifrado seguro para guardar accesos');
    }
    const saved = credentials();
    saved[network] = {
      cipher: vault.encryptString(JSON.stringify(account)).toString('base64'), identity: account.identity
    };
    production.writeState(root, VAULT, saved);
    return account.identity;
  }

  function accountName(network) {
    if (!ACCOUNT_NETWORKS.includes(network)) throw Error('Red desconocida');
    return network;
  }

  function loadSecret(network) {
    const entry = credentials()[accountName(network)];
    if (!entry) throw Error('Conecta ' + network + ' en Ajustes');
    try {
      return JSON.parse(vault.decryptString(Buffer.from(entry.cipher, 'base64')));
    } catch {
      throw Error('El acceso está cifrado para otro usuario o equipo. Conecta la cuenta otra vez.');
    }
  }

  async function connect(network, data) {
    accountName(network);
    const account = normalizeSecrets(data);
    if (network !== 'tiktok' && account.provider === 'ayrshare') throw Error('Ayrshare está disponible para TikTok');
    account.identity = await platform.verifyAccount(network, account);
    return saveSecret(network, account);
  }

  function disconnect(network) {
    const saved = credentials();
    delete saved[accountName(network)];
    production.writeState(root, VAULT, saved);
    return true;
  }

  function accounts() {
    const saved = credentials();
    return Object.fromEntries(ACCOUNT_NETWORKS.map(network => [network, saved[network]?.identity || null]));
  }

  async function accountFor(network) {
    const account = loadSecret(network);
    if (account.expiresAt && Date.parse(account.expiresAt) - Date.now() < 60000) {
      if (!refreshes.has(network)) {
        refreshes.set(network, platform.refresh(network, account).then(updated => {
          const current = loadSecret(network);
          if (current.identity.id !== account.identity.id) throw Error('La cuenta fue cambiada');
          saveSecret(network, updated);
          return updated;
        }).finally(() => refreshes.delete(network)));
      }
      return refreshes.get(network);
    }
    return account;
  }

  function publicJob(job) {
    const { sha256, thumbnailHash, remote, ...visible } = job;
    return visible;
  }

  function jobsFor(target) {
    const same = job => !target || (job.target.kind === target.kind && job.target.id === target.id &&
      (!target.file || job.target.file === target.file));
    return queue().filter(same).map(publicJob).reverse();
  }

  function updateJob(id, fields) {
    const jobs = queue();
    const job = jobs.find(item => item.id === id);
    if (!job) throw Error('El elemento ya no está en la cola');
    Object.assign(job, fields, { updatedAt: new Date().toISOString() });
    writeQueue(jobs);
    return job;
  }

  async function enqueue({ target, network, dueAt, confirmed }) {
    validNetwork(network);
    if (confirmed !== true) throw Error('Debes confirmar el envío a esta red');
    const scheduled = dateString(dueAt) || new Date().toISOString();
    const account = await accountFor(network);
    const entry = delivery.entryFor(root, target);
    const approved = entry.approval;
    if (!approved || !entry.quality?.ok) throw Error('Primero revisa y aprueba el MP4');
    const file = delivery.resolveOutput(root, target);
    if (await delivery.fingerprint(file) !== approved.sha256) throw Error('El MP4 cambió después de la aprobación');
    const metadata = delivery.normalizeNetwork(network, entry.networks[network]);
    if (!metadata.privacy && network !== 'instagram') throw Error('Selecciona la visibilidad antes de autorizar');
    if (network === 'tiktok' && metadata.branded && !['FOLLOWER_OF_CREATOR', 'PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS'].includes(metadata.privacy)) {
      throw Error('La visibilidad privada no admite la divulgación de contenido patrocinado');
    }
    const thumbnail = network === 'youtube' || account.provider === 'ayrshare' ? delivery.thumbnailPath(root, target, metadata.thumbnail) : null;
    const thumbnailHash = thumbnail ? await delivery.fingerprint(thumbnail) : null;
    const jobs = queue();
    if (jobs.some(job => job.target.file === target.file && job.network === network &&
      job.identity.id === account.identity.id && job.status !== 'cancelado')) {
      throw Error('Este video ya está en la cola de esa cuenta. Usa la acción del elemento existente.');
    }
    const job = {
      id: randomUUID(), target, network, identity: account.identity, metadata, sha256: approved.sha256, thumbnailHash,
      authorizedAt: new Date().toISOString(), dueAt: scheduled, nextAt: scheduled,
      status: Date.parse(scheduled) > Date.now() ? 'programado' : 'pendiente', attempts: 0, remote: {},
      url: null, externalId: null, message: ''
    };
    writeQueue([...jobs, job]);
    return publicJob(job);
  }

  function recover() {
    const jobs = queue();
    let changed = false;
    for (const job of jobs) {
      if (job.status !== 'enviando') continue;
      job.status = 'revisar';
      job.message = 'El proceso se interrumpió. Verifica en la red si recibió el video.';
      changed = true;
    }
    if (changed) writeQueue(jobs);
  }

  async function step(job) {
    locks.add(job.id);
    let started = false;
    try {
      const account = await accountFor(job.network);
      if (account.identity.id !== job.identity.id) throw Error('La cuenta conectada es distinta de la que aprobaste');
      const file = delivery.resolveOutput(root, job.target);
      const entry = delivery.entryFor(root, job.target);
      const thumbnail = job.network === 'youtube' || account.provider === 'ayrshare' ? delivery.thumbnailPath(root, job.target, job.metadata.thumbnail) : null;
      const [actualHash, actualThumbnail] = await Promise.all([
        delivery.fingerprint(file), thumbnail ? delivery.fingerprint(thumbnail) : null
      ]);
      if (actualHash !== job.sha256 || actualThumbnail !== job.thumbnailHash) {
        throw Error('El video o la miniatura cambió. Cancela y crea un envío con la versión nueva.');
      }
      const current = queue().find(item => item.id === job.id);
      if (!current || !['pendiente', 'programado', 'procesando'].includes(current.status)) return;
      updateJob(job.id, { status: 'enviando', message: '', attempts: job.attempts + 1 });
      started = true;
      const remote = { ...job.remote };
      const checkpoint = fields => {
        Object.assign(remote, fields);
        updateJob(job.id, { remote });
      };
      const result = await platform.publish[job.network]({
        token: account.accessToken, account, file, thumbnail, metadata: job.metadata, remote, checkpoint, quality: entry.quality
      });
      if (result.processing) {
        if (job.attempts >= 240) throw Error('La plataforma sigue procesando. Revisa el video en la red.');
        return updateJob(job.id, { status: 'procesando', nextAt: new Date(Date.now() + WAIT).toISOString() });
      }
      const url = safeLink(job.network, result.url);
      const published = updateJob(job.id, { status: 'publicado', externalId: result.id, url,
        publishedAt: new Date().toISOString(), message: result.note || '' });
      if (job.target.kind === 'short') store.saveProject(root, { id: job.target.id, stage: 'publicado' });
      return published;
    } catch (err) {
      const safeError = err instanceof platform.NetworkError ? err.message :
        started ? 'La entrega se interrumpió. Comprueba en la red si recibió el video.' : err.message;
      const status = started && !(err instanceof platform.NetworkError && err.permanent) ? 'revisar' : 'fallo';
      updateJob(job.id, { status, message: safeError.slice(0, 240) });
    } finally {
      locks.delete(job.id);
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      for (const job of queue()) {
        if (['pendiente', 'programado', 'procesando'].includes(job.status) && Date.parse(job.nextAt) <= Date.now()) {
          await step(job);
        }
      }
    } finally {
      running = false;
    }
  }

  function changeJob({ id, action, confirmed }) {
    if (locks.has(id)) throw Error('El elemento está ejecutándose');
    const job = queue().find(item => item.id === id);
    if (!job) throw Error('Publicación no encontrada');
    if (action === 'cancelar') {
      if (!['pendiente', 'programado', 'fallo', 'revisar'].includes(job.status)) throw Error('La plataforma ya ha recibido el archivo');
      if (job.remote.id || job.remote.publishId || job.remote.container || job.remote.ayrId) {
        throw Error('Verifica la publicación existente en la red antes de volver a enviarla');
      }
      return updateJob(id, { status: 'cancelado' });
    }
    if (!['fallo', 'revisar'].includes(job.status) || confirmed !== true) throw Error('Confirma que revisaste el envío antes de reintentar');
    return updateJob(id, { status: 'pendiente', nextAt: new Date().toISOString(), attempts: 0, message: '' });
  }

  function addLink({ target, network, url, externalId, publishedAt, jobId }) {
    const link = safeLink(validNetwork(network), url);
    if (!link) throw Error('Escribe el enlace de la publicación');
    delivery.resolveOutput(root, target);
    const date = dateString(publishedAt) || new Date().toISOString();
    const id = extractId(network, link, externalId);
    const jobs = queue();
    const existing = jobs.find(item => item.id === jobId && item.target.file === target.file && item.network === network);
    if (jobs.some(item => item.url === link && item.id !== jobId)) throw Error('Ese enlace ya existe');
    const info = { url: link, externalId: id, publishedAt: date, status: 'publicado', message: '' };
    if (existing) {
      if (locks.has(existing.id)) throw Error('El elemento está ejecutándose');
      updateJob(existing.id, info);
    } else {
      jobs.push({
        id: randomUUID(), target, network, identity: accounts()[network] || { id: 'manual', label: 'Registrado por ti' },
        metadata: delivery.entryFor(root, target).networks[network], remote: {}, ...info
      });
      writeQueue(jobs);
    }
    if (target.kind === 'short') store.saveProject(root, { id: target.id, stage: 'publicado' });
    return jobsFor(target);
  }

  function manualStats({ id, values }) {
    const job = queue().find(item => item.id === id && item.status === 'publicado');
    if (!job) throw Error('Selecciona una publicación');
    const metrics = Object.fromEntries(['views', 'likes', 'comments', 'followers', 'retention'].map(key => {
      const n = values[key] === '' || values[key] == null ? null : Number(values[key]);
      if (n !== null && (!Number.isFinite(n) || n < 0 || (key !== 'retention' && !Number.isSafeInteger(n)))) {
        throw Error('Métrica inválida');
      }
      return [key, n];
    }));
    updateJob(id, { metrics, metricsAt: new Date().toISOString(), metricsSource: 'manual' });
    return stats();
  }

  function catalogKey(network, video) {
    const match = network === 'instagram' && video.url?.match(/\/reels?\/([\w-]+)/);
    return match ? 'reel:'+match[1] : String(video.externalId);
  }

  function recordReading(inventory, network, identity, video, source, at) {
    const identifier = catalogKey(network,video);
    let key = JSON.stringify([network,identity.id,video.externalId]);
    const previousKey = inventory[key] ? key : Object.keys(inventory).find(k=>{
      const row=inventory[k];
      return row.network===network && (String(row.externalId)===String(video.externalId) || catalogKey(network,row)===identifier);
    });
    const previous = inventory[previousKey] || {};
    if (source==='navegador' && previousKey) key=previousKey;
    if (previousKey && key!==previousKey) delete inventory[previousKey];
    const values=Object.fromEntries(Object.entries(video.metrics||{}).filter(([,v])=>v!=null));
    const origins={...Object.fromEntries(Object.keys(previous.metrics||{}).map(k=>[k,{source:previous.metricsSource||'red',at:previous.metricsAt}])),...previous.metricOrigins};
    for (const k of Object.keys(values)) origins[k]={source,at};
    const history=[...(previous.history||[]),{at,source,metrics:values,...(video.rawMetrics?{rawMetrics:video.rawMetrics}:{})}];
    const metadata=Object.fromEntries(Object.entries(video).filter(([,v])=>v!=null && v!==''));
    const keepOfficial=source==='navegador' && previous.identity?.id && previous.identity.id!=='navegador';
    inventory[key]={...previous,...metadata,externalId:keepOfficial?previous.externalId:video.externalId,
      title:(keepOfficial && previous.title)||video.title||previous.title||video.externalId,
      publishedAt:(keepOfficial && previous.publishedAt)||video.publishedAt||previous.publishedAt||null,
      url:(keepOfficial && previous.url)||video.url||previous.url,
      identity:keepOfficial?previous.identity:identity,network,id:key,metricsAt:at,metricsSource:source,
      metrics:{...previous.metrics,...values},metricOrigins:origins,history};
    return key;
  }

  function browserReading(network,video) {
    const inventory=production.readState(root,INVENTORY,{});
    recordReading(inventory,network,{id:'navegador',label:'Navegador'},video,'navegador',new Date().toISOString());
    production.writeState(root,INVENTORY,inventory);
  }

  async function refreshStats() {
    if (refreshing) throw Error('Ya se están actualizando las estadísticas');
    refreshing = true;
    const errors = [];
    let count = 0;
    try {
      const synced = new Set();

      for (const [network,identity] of Object.entries(accounts())) {
        if (!identity || !platform.catalogPages) continue;
        try {
          const account = await accountFor(network);
          for await (const page of platform.catalogPages(network,account)) {
            if (accounts()[network]?.id !== identity.id) throw Error('La cuenta cambió durante la consulta');
            if (page.warning) errors.push(network+' · '+page.warning);
            const metricsAt = new Date().toISOString();
            const inventory = production.readState(root, INVENTORY, {});
            for (const video of page.videos) {
              synced.add(recordReading(inventory,network,identity,video,'red',metricsAt));
              count++;
            }
            if (page.videos.length) production.writeState(root, INVENTORY, inventory);
          }
        } catch(error) { errors.push(network+' · '+error.message); }
      }
      for (const item of queue().filter(job => job.status === 'publicado' && job.externalId && job.metricsSource !== 'manual')) {
        try {
          const account = await accountFor(item.network);
          if (item.identity.id !== 'manual' && account.identity.id !== item.identity.id) throw Error('Conecta la cuenta que publicó el video');
          if (synced.has(JSON.stringify([item.network,account.identity.id,item.externalId]))) continue;
          const quality = delivery.entryFor(root, item.target).quality;
          const metrics = await platform.metrics(item.network, account, item, quality);
          updateJob(item.id, { metrics, metricsAt: new Date().toISOString(), metricsSource: 'red', metricsError: '' });
          count++;
        } catch (error) {
          const message = item.network + ' · ' + error.message.slice(0, 120);
          errors.push(message);
          updateJob(item.id, { metricsError: message });
        }
      }
      production.writeState(root, 'sincronizacion', { at: new Date().toISOString(), count, errors:[...new Set(errors)] });
      return { count, errors };
    } finally {
      refreshing = false;
    }
  }

  function stats() {
    const projects = new Map(store.listProjects(root).map(project => [project.id, project]));
    const weeks = new Map(store.listWeeks(root).map(week => [week.id, week]));
    const catalogRows = production.readState(root, INVENTORY, {});
    const merged = new Map(Object.entries(catalogRows).map(([key,item])=>[key,{...item,tags:catalog.emptyTags()}]));
    const identities=accounts();
    for(const job of queue().filter(item => item.status === 'publicado')) {
      const project = projects.get(job.target.id);
      const week = weeks.get(job.target.id);
      let key = job.externalId ? JSON.stringify([job.network,job.identity.id==='manual' ? identities[job.network]?.id : job.identity.id,job.externalId]) : job.id;
      if (!catalogRows[key]) key=Object.keys(catalogRows).find(k=>catalogRows[k].network===job.network &&
        (catalogRows[k].externalId===job.externalId || catalogKey(job.network,catalogRows[k])===catalogKey(job.network,job))) || key;
      const remote = catalogRows[key];
      merged.set(key,{...publicJob(job), ...remote, id:job.id, localJob:true,
        ...(job.metricsSource==='manual'?{manualMetrics:job.metrics}:{}),
        title:remote?.title || project?.title || week?.title || job.metadata.title,
        hook:project?.hook || '', tags:project?.tags || (week?.filter ? {[week.filter.field]:[week.filter.value]} : catalog.emptyTags())});

    }
    return [...merged.values()].sort((a,b)=>String(b.publishedAt||'').localeCompare(String(a.publishedAt||'')));
  }

  function exportStats() {
    const directory = path.join(root, 'Exportaciones', 'Estadisticas');
    const file = path.join(directory, 'rendimiento.json');
    store.atomic(file, { exportedAt: new Date().toISOString(), videos: stats().map(({metadata, target, ...video})=>video) });
    return file;
  }

  return { syncStatus:()=>production.readState(root,'sincronizacion',{}), accounts, connect, disconnect, accountFor, jobsFor, enqueue, recover, tick, changeJob, addLink, manualStats, browserReading, refreshStats, stats, exportStats };
}

module.exports = { createPublishing, safeLink };
