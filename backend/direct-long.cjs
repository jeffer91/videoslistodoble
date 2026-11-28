'use strict';
/**
 * Videos largos directos · puente entre la interfaz y el sistema.
 * Módulo independiente: un único canal IPC («direct:call»), su propio evento
 * de progreso («direct:progress») y su propia ruta records://direct/…
 * No modifica los proyectos de Shorts ni las compilaciones de videos largos.
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const directStore = require('./direct-store.cjs');
const scripts = require('./direct-script.cjs');
const intel = require('./direct-intel.cjs');
const graphics = require('./direct-graphics.cjs');
const audio = require('./direct-audio.cjs');
const narrator = require('./direct-narrator.cjs');
const render = require('./direct-render.cjs');
const { createYouTube } = require('./direct-youtube.cjs');
const auto = require('./direct-auto.cjs');
const Layout = require('../renderer/direct-layout.js');
const library = require('./direct-library.cjs');

const TYPES = { '.webm': 'video/webm', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.srt': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

function streamFile(file, request) {
  const stat = fs.statSync(file), total = stat.size;
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = request.headers.get('range');
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = 0, end = total - 1, status = 200;
  if (range) {
    if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + total } });
    if (match[1] === '' && match[2] !== '') start = Math.max(0, total - Number(match[2]));
    else { start = Number(match[1]); end = match[2] === '' ? total - 1 : Math.min(total - 1, Number(match[2])); }
    if (!Number.isSafeInteger(start) || start >= total || end < start) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + total } });
    status = 206;
  }
  const body = total ? require('node:stream').Readable.toWeb(fs.createReadStream(file, { start, end })) : null;
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(total ? end - start + 1 : 0), 'Cache-Control': 'no-store' };
  if (status === 206) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + total;
  return new Response(body, { status, headers });
}

function install({ app, root, register, dialog, shell, clipboard, safeStorage, window }) {
  const media = require('./media.cjs');
  const send = detail => { const win = window(); if (win && !win.isDestroyed()) win.webContents.send('direct:progress', detail); };
  const clients = require('./network-clients.cjs');
  const { createPublishing } = require('./publishing.cjs');
  // Misma bóveda cifrada que Estadísticas → Conexiones: un canal conectado sirve en ambos sitios.
  const publishing = createPublishing(root, safeStorage, clients);
  const youtube = createYouTube(root, publishing, { open: url => shell.openExternal(url), oauth: clients.googleOAuth });
  let exportJob = null;
  let transcribeJob = null;
  const masters = { queue: [], running: false };

  function queueMaster(id, sectionId) {
    if (!masters.queue.some(x => x.id === id && x.sectionId === sectionId)) masters.queue.push({ id, sectionId });
    if (masters.running) return;
    masters.running = true;
    (async () => {
      while (masters.queue.length) {
        const next = masters.queue.shift();
        try {
          send({ kind: 'master', id: next.id, sectionId: next.sectionId, state: 'working' });
          const take = await directStore.prepareMaster(root, next, new AbortController().signal, media);
          send({ kind: 'master', id: next.id, sectionId: next.sectionId, state: 'ready', take });
        } catch (error) {
          send({ kind: 'master', id: next.id, sectionId: next.sectionId, state: 'error', message: String(error.message || error).slice(0, 300) });
        }
      }
      masters.running = false;
    })();
  }

  async function pick(options) {
    const result = await dialog.showOpenDialog(window(), options);
    return result.canceled ? [] : result.filePaths;
  }

  async function statImages(project, section) {
    const map = {};
    for (const stat of intel.statistics(section)) {
      const key = stat.value + '|' + stat.label;
      let image = project.images.find(i => i.source?.stat === key);
      if (!image) {
        const file = await graphics.statCard(root, stat);
        const saved = await directStore.saveImage(root, project.id, file, { name: 'Gráfico · ' + stat.value + ' ' + stat.label,
          source: { provider: 'Once Records', license: 'Gráfico original generado por la aplicación', attribution: '', stat: key } });
        image = saved.image;
        project = saved.project;
      }
      map[key] = image.id;
    }
    return { map, project: directStore.read(root, project.id) };
  }

  async function transcribeSection(id, sectionId) {
    const project = directStore.read(root, id);
    const section = project.sections.find(s => s.id === sectionId);
    if (!section?.take) return false;
    const file = directStore.resolveFile(root, id, section.take.master || section.take.original);
    const words = await intel.transcribeFile(root, file, new AbortController().signal, media);
    const latest = directStore.read(root, id);
    const current = latest.sections.find(s => s.id === sectionId);
    if (current?.take?.id !== section.take.id) return false;
    current.transcript = { takeId: section.take.id, words: directStore.normalizeWords(words, section.take.duration + 1), edited: false, engine: 'whisper.cpp' };
    directStore.write(root, latest);
    return true;
  }

  /** Copia una foto de la biblioteca al proyecto (una sola vez). */
  async function fromLibrary(id, item, tags) {
    const project = directStore.read(root, id);
    const existing = project.images.find(i => i.libraryId === item.id);
    if (existing) return existing;
    const saved = await directStore.saveImage(root, id, library.resolve(root, item.id), { name: item.name, source: item.source });
    const latest = saved.project;
    const image = latest.images.find(i => i.id === saved.image.id);
    image.libraryId = item.id;
    image.tags = [...new Set([...(item.tags || []), ...tags])];
    directStore.write(root, latest);
    library.used(root, item.id);
    return image;
  }

  /** Busca una imagen para un nombre: primero la biblioteca propia, después Wikimedia Commons. */
  function transitionQuery(project, section) {
    const mark = Layout.marks(section.text).marks.find(m => m.type === 'imagen' && m.value.trim());
    if (mark) return mark.value.trim();
    const known = intel.entities(Layout.stripMarks(section.title + ' ' + section.text)).find(e => e.known);
    if (known) return known.name;
    return section.intro ? project.title : section.title;
  }

  async function imageFor(id, query, notes) {
    const project = directStore.read(root, id);
    const tagged = auto.imageTagged(project, query);
    if (tagged) return tagged;
    const own = library.find(root, query, project.images.map(i => i.libraryId).filter(Boolean))[0];
    if (own) return fromLibrary(id, own, [query]);
    try {
      const found = await intel.searchImages(query, { limit: 3 });
      const best = found.results[0];
      if (!best) { notes.push('Sin foto libre para «' + query + '»'); return null; }
      const { buffer, item } = await intel.downloadImage({ title: best.title });
      const source = { provider: item.provider, title: item.title, pageUrl: item.pageUrl, author: item.author, license: item.license, licenseUrl: item.licenseUrl,
        restrictions: item.restrictions, attribution: intel.attribution(item), query, year: item.year };
      const entry = await library.add(root, buffer, { name: item.title, tags: [query], source }).catch(() => null);
      const saved = await directStore.saveImage(root, id, buffer, { name: item.title, source });
      const latest = saved.project;
      const image = latest.images.find(i => i.id === saved.image.id);
      image.tags = [query];
      if (entry) image.libraryId = entry.id;
      directStore.write(root, latest);
      return image;
    } catch (error) {
      notes.push('Imágenes de internet no disponibles (' + String(error.message).slice(0, 80) + ')');
      return null;
    }
  }

  // ── Piloto automático ───────────────────────────────────────────────────
  const pilot = { queue: [], running: false, current: null };
  function queuePilot(id, sectionId) {
    if (!pilot.queue.some(x => x.id === id && x.sectionId === sectionId)) pilot.queue.push({ id, sectionId });
    if (pilot.running) return;
    pilot.running = true;
    (async () => {
      while (pilot.queue.length) {
        const next = pilot.queue.shift();
        pilot.current = next;
        try { await autopilotSection(next.id, next.sectionId); }
        catch (error) {
          try {
            const p = directStore.read(root, next.id);
            const s = p.sections.find(x => x.id === next.sectionId);
            if (s) { s.auto = { state: 'error', at: new Date().toISOString(), notes: [String(error.message || error).slice(0, 300)] }; directStore.write(root, p); }
          } catch { /* proyecto eliminado */ }
          send({ kind: 'auto', id: next.id, sectionId: next.sectionId, state: 'error', message: 'Piloto automático: ' + String(error.message || error).slice(0, 200) });
        }
        if (!pilot.queue.some(x => x.id === next.id)) await autopilotProject(next.id).catch(error => send({ kind: 'auto', id: next.id, state: 'error', message: 'Piloto automático: ' + error.message }));
      }
      pilot.current = null;
      pilot.running = false;
    })();
  }

  async function autopilotSection(id, sectionId) {
    const notes = [];
    const step = (message, percent) => send({ kind: 'auto', id, sectionId, state: 'working', percent, message });
    const mark = (state) => { const p = directStore.read(root, id); const s = p.sections.find(x => x.id === sectionId); if (s) { s.auto = { state, at: new Date().toISOString(), notes }; directStore.write(root, p); } return p; };
    let project = directStore.read(root, id);
    let section = project.sections.find(s => s.id === sectionId);
    if (!section?.take) return;
    const settings = project.settings.autopilot;
    mark('trabajando');
    step('Preparando la toma de «' + section.title + '»', 5);
    await directStore.prepareMaster(root, { id, sectionId }, new AbortController().signal, media);
    if (intel.whisperConfig(root).ready) {
      step('Transcribiendo «' + section.title + '» en tu PC', 20);
      await transcribeSection(id, sectionId);
    } else notes.push('Instala Whisper en Configuración para transcribir, cortar errores y subtitular automáticamente.');
    project = directStore.read(root, id);
    section = project.sections.find(s => s.id === sectionId);
    if (settings.cuts && section.transcript?.takeId === section.take.id) {
      step('Quitando silencios y frases repetidas', 45);
      const manual = (section.cuts || []).filter(c => !c.auto);
      const cuts = [...manual, ...auto.autocut(section)];
      project = directStore.updateSection(root, { id, sectionId, patch: { cuts } });
      section = project.sections.find(s => s.id === sectionId);
      const removed = Layout.keptDuration([], section.take.duration) - Layout.keptDuration(section.cuts, section.take.duration);
      if (removed > 0.2) notes.push('Recortados ' + removed.toFixed(1).replace('.', ',') + ' s de silencios y repeticiones');
    }
    if (settings.images) {
      step('Buscando imágenes de lo que mencionas', 60);
      const marks = Layout.marks(section.text).marks;
      const queries = [...marks.filter(m => m.type === 'imagen').map(m => m.value)];
      const spoken = section.transcript?.takeId === section.take.id ? section.transcript.words.map(w => w.text).join(' ') : '';
      const names = intel.entities(Layout.stripMarks(section.text) + ' ' + spoken).filter(e => e.known && e.type !== 'competicion');
      for (const e of names) if (!queries.some(q => Layout.normalize(q).includes(Layout.normalize(e.name)))) queries.push(e.name);
      const ids = [];
      for (const query of queries.slice(0, 6)) {
        const image = await imageFor(id, query, notes);
        if (image) ids.push(image.id);
      }
      for (const m of marks.filter(x => x.type === 'dato')) {
        const stat = auto.markStat(m.value);
        project = directStore.read(root, id);
        if (!project.images.some(i => i.source?.stat === auto.statKey(stat))) {
          const file = await graphics.statCard(root, stat);
          const saved = await directStore.saveImage(root, id, file, { name: 'Gráfico · ' + m.value, source: { provider: 'Once Records', license: 'Gráfico original generado por la aplicación', attribution: '', stat: auto.statKey(stat) } });
          ids.push(saved.image.id);
        }
      }
      project = directStore.read(root, id);
      section = project.sections.find(s => s.id === sectionId);
      if (ids.length) project = directStore.updateSection(root, { id, sectionId, patch: { imageIds: [...new Set([...section.imageIds, ...ids])] } });
    }
    step('Componiendo la sección', 80);
    project = directStore.read(root, id);
    section = project.sections.find(s => s.id === sectionId);
    if (!section.layouts.length || section.layouts.every(l => l.source === 'auto')) {
      const stats = await statImages(project, section);
      project = stats.project;
      section = project.sections.find(s => s.id === sectionId);
      const proposal = intel.propose(project, section, { statImages: stats.map });
      directStore.updateSection(root, { id, sectionId, patch: { layouts: auto.applyMarks(project, section, proposal.layouts) } });
    } else notes.push('Se respetó tu composición manual');
    const directives = auto.sectionDirectives(section);
    const patch = {};
    if (directives.mood && section.audio.mood === 'auto' && !section.audio.musicId) patch.audio = { mood: directives.mood };
    if (directives.transition && section.transition.style === 'auto') patch.transition = { style: directives.transition };
    if (Object.keys(patch).length) directStore.updateSection(root, { id, sectionId, patch });
    project = mark('listo');
    send({ kind: 'auto', id, sectionId, state: 'listo', percent: 100, message: '«' + section.title + '» lista', project });
  }

  /** Cuando todo está grabado y procesado: exporta, prepara YouTube y, si se pidió, publica. */
  async function autopilotProject(id) {
    let project = directStore.read(root, id);
    const settings = project.settings.autopilot;
    if (!settings.enabled || !settings.export || !project.sections.length) return;
    if (!project.sections.every(s => s.take && s.auto?.state === 'listo')) return;
    const signature = project.sections.map(s => s.take.id + ':' + s.auto.at).join('|');
    if (project.autopilot?.exported === signature) return;
    if (exportJob) return;
    const meta = auto.suggestMetadata(project);
    directStore.saveSettings(root, { id, youtube: { title: project.youtube.title || meta.title, description: project.youtube.description || meta.description,
      tags: project.youtube.tags?.length ? project.youtube.tags : meta.tags, comment: project.youtube.comment || meta.comment, privacy: project.youtube.privacy } });
    send({ kind: 'auto', id, state: 'working', percent: 0, message: 'Piloto automático: exportando el video final' });
    const entry = await handlers['export.start']({ id, quality: 'final' });
    project = directStore.read(root, id);
    project.autopilot = { exported: signature, at: new Date().toISOString(), file: entry.file };
    directStore.write(root, project);
    let published = null;
    if (settings.publish && youtube.status().connected && entry.review?.ok !== false) {
      published = await youtube.upload({ id, file: entry.file }, detail => send({ kind: 'youtube', id, ...detail })).catch(error => { send({ kind: 'auto', id, state: 'error', message: 'YouTube: ' + error.message }); return null; });
    }
    send({ kind: 'auto', id, state: 'terminado', percent: 100, message: published ? 'Video publicado en YouTube' : 'Video listo para revisar y publicar', entry, project: directStore.read(root, id) });
  }

  const handlers = {
    'list': () => ({ projects: directStore.listProjects(root), storage: directStore.storageInfo(root) }),
    'create': data => directStore.createProject(root, data),
    'get': ({ id }) => directStore.read(root, id),
    'rename': data => directStore.renameProject(root, data),
    'delete': data => directStore.deleteProject(root, data),
    'storage': () => directStore.storageInfo(root),
    'open.folder': ({ id }) => shell.openPath(directStore.projectDir(root, id)),
    'open.export': ({ id, file }) => { shell.showItemInFolder(directStore.resolveFile(root, id, file)); return true; },

    // Guion
    'script.file': async () => {
      const [file] = await pick({ title: 'Importar guion', properties: ['openFile'],
        filters: [{ name: 'Guiones (PDF, Word, texto, Markdown)', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown'] }] });
      if (!file) return null;
      const result = await scripts.readScriptFile(file);
      return { ...result, sections: scripts.parseSections(result.text) };
    },
    'script.parse': ({ text }) => scripts.parseSections(text),
    // Copia al portapapeles de Windows (más fiable que el del navegador).
    'clipboard.write': ({ text }) => { clipboard.writeText(String(text ?? '').slice(0, 200000)); return true; },
    'script.apply': data => directStore.importScript(root, data),
    'section.update': data => directStore.updateSection(root, data),
    'section.add': data => directStore.addSection(root, data),
    'section.remove': data => directStore.removeSection(root, data),
    'section.move': data => directStore.moveSection(root, data),
    'settings.save': data => directStore.saveSettings(root, data),

    // Grabación
    'take.begin': data => directStore.beginTake(root, data),
    'take.append': data => directStore.appendTake(root, data),
    'take.inspect': async data => { await directStore.indexTake(root, data, media); return directStore.inspectTake(root, data, media); },
    'take.discard': data => directStore.discardTake(root, data),
    'take.pending': ({ id }) => directStore.pendingTakes(root, id),
    'take.resume': async data => {
      const point = await directStore.resumePoint(root, data, media);
      // Con Whisper instalado se reconoce lo último dicho para colocar el teleprompter.
      point.heard = await intel.heardBefore(root, directStore.spliceFile(root, data.id, data.source), point.cut, media).catch(() => '');
      return point;
    },
    'take.join': data => directStore.joinTake(root, data, media),
    'take.tail': data => directStore.tailPoint(root, data, media),
    'take.commit': async data => {
      const result = await directStore.commitTake(root, data, media);
      // Con subsecciones pendientes la toma aún crecerá: el piloto espera a la última.
      const partial = !Layout.chainProgress(result.project.sections.find(x => x.id === result.sectionId)).complete;
      if (result.project.settings.autopilot.enabled && !partial) queuePilot(data.id, result.sectionId);
      else queueMaster(data.id, result.sectionId);
      return result;
    },
    'master.prepare': ({ id, sectionId }) => { queueMaster(id, sectionId); return true; },

    // Imágenes
    'image.import': async ({ id, sectionId }) => {
      const files = await pick({ title: 'Añadir fotografías propias', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif'] }] });
      const added = [], errors = [];
      for (const file of files) {
        try { added.push((await directStore.importImageFile(root, id, file)).image); }
        catch (error) { errors.push(path.basename(file) + ': ' + error.message); }
      }
      if (sectionId && added.length) {
        const project = directStore.read(root, id);
        const section = project.sections.find(s => s.id === sectionId);
        if (section) directStore.updateSection(root, { id, sectionId, patch: { imageIds: [...section.imageIds, ...added.map(i => i.id)] } });
      }
      return { added, errors, project: directStore.read(root, id) };
    },
    'image.paste': async ({ id }) => {
      const picture = clipboard.readImage();
      if (picture.isEmpty()) throw Error('Copia primero una imagen');
      return directStore.saveImage(root, id, picture.toPNG(), { name: 'Imagen pegada' });
    },
    'image.remove': data => directStore.removeImage(root, data),
    'image.tag': ({ id, imageId, tags }) => {
      const project = directStore.read(root, id);
      const image = project.images.find(i => i.id === imageId);
      if (!image) throw Error('Imagen no encontrada');
      image.tags = (Array.isArray(tags) ? tags : []).map(t => String(t).trim().slice(0, 80)).filter(Boolean).slice(0, 12);
      if (image.libraryId) { try { library.retag(root, { id: image.libraryId, tags: image.tags }); } catch { image.libraryId = null; } }
      directStore.write(root, project);
      // Una foto propia etiquetada se guarda en la biblioteca para los próximos videos.
      return (async () => {
        if (!image.libraryId && image.tags.length && !image.source?.stat) {
          const entry = await library.add(root, directStore.resolveFile(root, id, image.file), { name: image.name, tags: image.tags, source: image.source }).catch(() => null);
          if (entry) { const latest = directStore.read(root, id); const img = latest.images.find(i => i.id === imageId); if (img) { img.libraryId = entry.id; directStore.write(root, latest); } }
        }
        return directStore.read(root, id);
      })();
    },
    'image.search': async ({ query }) => {
      const result = await intel.searchImages(query);
      // Las miniaturas se descargan aquí y se sirven en local: la interfaz no carga recursos externos.
      const dir = path.join(root, 'Recursos', 'Directos', 'Miniaturas');
      fs.mkdirSync(dir, { recursive: true });
      await Promise.all(result.results.map(async item => {
        const name = require('node:crypto').createHash('sha1').update(item.thumb).digest('hex').slice(0, 24) + '.jpg';
        const file = path.join(dir, name);
        try {
          if (!fs.existsSync(file)) {
            const response = await fetch(item.thumb, { headers: { 'User-Agent': 'OnceRecordsStudio/0.12 (https://github.com/jeffer91/videoslistodoble)' }, signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw Error('HTTP ' + response.status);
            const data = Buffer.from(await response.arrayBuffer());
            if (data.length > 4 * 1024 * 1024) throw Error('Miniatura demasiado grande');
            fs.writeFileSync(file, data);
          }
          item.thumb = 'records://direct/thumb/' + name;
        } catch { item.thumb = ''; }
      }));
      return result;
    },
    'image.download': async ({ id, title, query, entity, sectionId }) => {
      const { buffer, item } = await intel.downloadImage({ title });
      const saved = await directStore.saveImage(root, id, buffer, { name: item.title, source: { provider: item.provider, title: item.title, pageUrl: item.pageUrl,
        author: item.author, license: item.license, licenseUrl: item.licenseUrl, restrictions: item.restrictions, attribution: intel.attribution(item), query, year: item.year } });
      const project = saved.project;
      const image = project.images.find(i => i.id === saved.image.id);
      image.tags = [entity, query].filter(Boolean);
      const entry = await library.add(root, buffer, { name: item.title, tags: image.tags, source: image.source }).catch(() => null);
      if (entry) image.libraryId = entry.id;
      if (sectionId) { const s = project.sections.find(x => x.id === sectionId); if (s && !s.imageIds.includes(image.id)) s.imageIds.push(image.id); }
      directStore.write(root, project);
      return { image, project: directStore.read(root, id) };
    },

    // Inteligencia
    'intel.status': () => ({ whisper: intel.whisperConfig(root).ready, platform: process.platform }),
    'intel.entities': ({ id, sectionId }) => {
      const project = directStore.read(root, id);
      const section = project.sections.find(s => s.id === sectionId);
      if (!section) throw Error('Sección no encontrada');
      const spoken = section.transcript?.takeId === section.take?.id ? (section.transcript?.words || []).map(w => w.text).join(' ') : '';
      return { entities: intel.entities(spoken + ' ' + section.text), statistics: intel.statistics(section), mood: intel.mood(section), titles: intel.suggestTitles(section) };
    },
    'intel.propose': async ({ id, sectionId }) => {
      let project = directStore.read(root, id);
      const section = project.sections.find(s => s.id === sectionId);
      if (!section) throw Error('Sección no encontrada');
      const stats = await statImages(project, section);
      project = stats.project;
      const current = project.sections.find(s => s.id === sectionId);
      const result = intel.propose(project, current, { statImages: stats.map });
      return { ...result, layouts: auto.applyMarks(project, current, result.layouts), project };
    },
    'intel.transcribe': async ({ id, sectionIds }) => {
      if (transcribeJob) throw Error('Ya hay una transcripción en curso');
      transcribeJob = (async () => {
        const project = directStore.read(root, id);
        const targets = project.sections.filter(s => s.take && (!sectionIds || sectionIds.includes(s.id)));
        if (!targets.length) throw Error('No hay secciones grabadas para transcribir');
        const results = [];
        for (const [index, section] of targets.entries()) {
          send({ kind: 'transcribe', id, percent: Math.round(100 * index / targets.length), message: 'Transcribiendo «' + section.title + '» en tu PC' });
          const file = directStore.resolveFile(root, id, section.take.master || section.take.original);
          const words = await intel.transcribeFile(root, file, new AbortController().signal, media);
          const latest = directStore.read(root, id);
          const current = latest.sections.find(s => s.id === section.id);
          if (current?.take?.id !== section.take.id) continue;
          current.transcript = { takeId: section.take.id, words: directStore.normalizeWords(words, section.take.duration + 1), edited: false, engine: 'whisper.cpp' };
          directStore.write(root, latest);
          results.push(section.id);
        }
        send({ kind: 'transcribe', id, percent: 100, message: 'Transcripción terminada' });
        return { sections: results, project: directStore.read(root, id) };
      })();
      try { return await transcribeJob; } finally { transcribeJob = null; }
    },
    'intel.listen': data => intel.listen(root, data, media),

    // Vista previa: capas gráficas idénticas a las de la exportación.
    'graphics.layers': async ({ id, sectionId, segment }) => {
      const project = directStore.read(root, id);
      const section = project.sections.find(s => s.id === sectionId);
      if (!section) throw Error('Sección no encontrada');
      const image = segment.imageId && project.images.find(i => i.id === segment.imageId);
      const label = section.intro ? 'Introducción' : 'Sección ' + String(section.number).padStart(2, '0');
      const own = !segment.background && project.settings.background.imageId && project.images.find(i => i.id === project.settings.background.imageId);
      const bg = own ? await graphics.imageBackground(root, directStore.resolveFile(root, id, own.file)) : await graphics.background(root, segment.background || project.settings.background.style);
      const fg = await graphics.foreground(root, segment, Boolean(image), { sectionLabel: label, sectionTitle: section.title, caption: segment.caption || '' });
      return { background: 'records://direct/graphic/' + path.basename(bg), foreground: 'records://direct/graphic/' + path.basename(fg) };
    },
    'graphics.transition': async ({ id, sectionId }) => {
      const project = directStore.read(root, id);
      const index = project.sections.findIndex(s => s.id === sectionId);
      if (index < 0) throw Error('Sección no encontrada');
      const section = project.sections[index];
      const style = intel.resolvedStyles(project)[index];
      const { file: bg, image } = await render.transitionBackground(root, project, section, style);
      const title = await graphics.titleCard(root, { label: section.intro ? 'Once Records presenta' : 'Sección ' + String(section.number).padStart(2, '0'),
        title: section.transition.title || (section.intro ? project.title : section.title) });
      return { style, image: image ? { id: image.id, name: image.name } : null, enabled: project.settings.transitions.enabled && section.transition.enabled,
        background: 'records://direct/graphic/' + path.basename(bg), title: 'records://direct/graphic/' + path.basename(title) };
    },
    // Busca una foto para la cartela: primera marca [IMAGEN: …], si no el personaje conocido o el título.
    'transition.findPhoto': async ({ id, sectionId }) => {
      const project = directStore.read(root, id);
      const section = project.sections.find(s => s.id === sectionId);
      if (!section) throw Error('Sección no encontrada');
      const query = transitionQuery(project, section);
      const notes = [];
      const image = await imageFor(id, query, notes);
      if (!image) throw Error(notes[0] || 'No se encontró una foto para «' + query + '»');
      const latest = directStore.read(root, id);
      const fresh = latest.sections.find(s => s.id === sectionId);
      return { query, image: { id: image.id, name: image.name }, project: directStore.updateSection(root, { id, sectionId,
        patch: { imageIds: [...new Set([...fresh.imageIds, image.id])], transition: { image: image.id } } }) };
    },

    // Audio
    'audio.catalog': () => audio.catalog(),
    // Narrador de las transiciones (Piper local) y música de tráiler.
    'narrator.status': () => narrator.status(root),
    'narrator.preview': async ({ id, sectionId }) => {
      const project = directStore.read(root, id);
      const section = project.sections.find(s => s.id === sectionId);
      if (!section) throw Error('Sección no encontrada');
      if (section.intro) throw Error('La introducción no lleva narrador');
      const n = await narrator.speak(root, narrator.narratorText(section), { send: m => send({ type: 'narrator', message: m.message }) }, media);
      const saved = directStore.setNarration(root, { id, sectionId, narration: n });
      const t = saved.sections.find(s => s.id === sectionId).transition;
      const length = narrator.transitionLength(t.duration || saved.settings.transitions.duration, t.narration);
      await audio.sting(root, length, media);
      return { project: saved, text: n.text, duration: n.duration, length, start: narrator.START,
        url: 'records://direct/narrator/' + n.hash + '.m4a', sting: t.music === 'ninguna' ? null : 'records://direct/sting/' + Math.round(length * 10) };
    },
    'audio.sample': async ({ kind, name }) => {
      await audio.ensure(root, kind === 'music' ? 'music' : 'sfx', name, media);
      return 'records://direct/library/' + (kind === 'music' ? 'music' : 'sfx') + '/' + encodeURIComponent(name);
    },
    'audio.import': async ({ id, kind, license }) => {
      const [file] = await pick({ title: kind === 'sfx' ? 'Importar efecto de sonido' : 'Importar música con derechos de uso', properties: ['openFile'],
        filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }] });
      return file ? directStore.importAudioFile(root, id, file, { kind, license }, media) : null;
    },
    'audio.remove': data => directStore.removeAudio(root, data),

    // Exportación
    'export.start': async ({ id, quality }) => {
      if (exportJob) throw Error('Ya hay una exportación en curso');
      const controller = new AbortController();
      exportJob = controller;
      try {
        return await render.exportProject(root, id, { quality: quality === 'draft' ? 'draft' : 'final', signal: controller.signal,
          send: detail => send({ kind: 'export', id, ...detail }) }, media);
      } finally { exportJob = null; }
    },
    'export.cancel': () => { exportJob?.abort(); return true; },
    'export.plan': ({ id }) => {
      const project = directStore.read(root, id);
      const { pieces, missing } = render.plan(project);
      return { pieces: pieces.map(p => ({ kind: p.kind, sectionId: p.section.id, duration: p.duration, style: p.style || null })), missing,
        description: youtube.description(project, (project.exports || []).at(-1) || {}) };
    },

    // Copias de seguridad
    'backup.export': async ({ id }) => {
      const project = directStore.read(root, id);
      const result = await dialog.showSaveDialog(window(), { title: 'Guardar copia de seguridad del proyecto',
        defaultPath: render.safeName(project.title) + '.oncerec.tar', filters: [{ name: 'Copia de Once Records', extensions: ['tar'] }] });
      if (result.canceled || !result.filePath) return null;
      return directStore.exportBackup(root, { id, destination: result.filePath });
    },
    'backup.import': async () => {
      const [file] = await pick({ title: 'Restaurar copia de seguridad', properties: ['openFile'], filters: [{ name: 'Copia de Once Records', extensions: ['tar'] }] });
      return file ? directStore.importBackup(root, { file }) : null;
    },

    // Piloto automático, cortes y llamados a la acción
    'auto.run': ({ id, sectionId }) => {
      const project = directStore.read(root, id);
      const targets = project.sections.filter(s => s.take && (!sectionId || s.id === sectionId));
      if (!targets.length) throw Error('Graba al menos una sección');
      if (!sectionId) { project.autopilot = null; directStore.write(root, project); }
      for (const s of targets) queuePilot(id, s.id);
      return { queued: targets.length };
    },
    'auto.status': () => ({ running: pilot.running, current: pilot.current, queued: pilot.queue.length }),
    'cuts.auto': ({ id, sectionId }) => {
      const project = directStore.read(root, id);
      const section = project.sections.find(s => s.id === sectionId);
      if (!section?.transcript || section.transcript.takeId !== section.take?.id) throw Error('Transcribe la sección para detectar silencios y repeticiones');
      return directStore.updateSection(root, { id, sectionId, patch: { cuts: [...section.cuts.filter(c => !c.auto), ...auto.autocut(section)] } });
    },
    'cta.plan': ({ id }) => {
      const project = directStore.read(root, id);
      const starts = {};
      let at = 0;
      for (const piece of render.plan(project).pieces) { if (piece.kind === 'section') starts[piece.section.id] = at; at += piece.duration; }
      return auto.plannedCtas(project, starts);
    },
    'cta.layer': async ({ type, text }) => {
      const normal = await graphics.ctaCard(root, { type, text: text || '' });
      const pressed = type === 'comentar' ? null : await graphics.ctaCard(root, { type, pressed: true });
      return { normal: 'records://direct/graphic/' + path.basename(normal), pressed: pressed ? 'records://direct/graphic/' + path.basename(pressed) : null };
    },
    'youtube.suggest': ({ id }) => auto.suggestMetadata(directStore.read(root, id)),

    // Biblioteca de fotos
    'library.list': () => library.list(root),
    'library.add': async ({ tags }) => {
      const files = await pick({ title: 'Añadir fotos a tu biblioteca', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tif', 'tiff', 'bmp'] }] });
      const added = [], errors = [];
      for (const file of files) {
        try { added.push(await library.add(root, file, { name: path.basename(file), tags })); }
        catch (error) { errors.push(path.basename(file) + ': ' + error.message); }
      }
      return { added, errors, items: library.list(root) };
    },
    'library.retag': data => library.retag(root, data),
    'library.remove': data => library.remove(root, data),
    'library.toProject': async ({ id, libraryId, sectionId }) => {
      const item = library.list(root).find(x => x.id === libraryId);
      if (!item) throw Error('Foto no encontrada');
      const image = await fromLibrary(id, item, []);
      if (sectionId) { const p = directStore.read(root, id); const s = p.sections.find(x => x.id === sectionId); if (s && !s.imageIds.includes(image.id)) directStore.updateSection(root, { id, sectionId, patch: { imageIds: [...s.imageIds, image.id] } }); }
      return directStore.read(root, id);
    },

    // YouTube
    'youtube.status': () => youtube.status(),
    'youtube.connect': data => youtube.connect(data),
    'youtube.save': ({ id, youtube: values }) => directStore.saveSettings(root, { id, youtube: values }),
    'youtube.upload': async ({ id, file, withThumbnail }) => {
      let thumbnail = null;
      if (withThumbnail) {
        [thumbnail] = await pick({ title: 'Elegir tu miniatura (JPG o PNG, máx. 2 MB)', properties: ['openFile'], filters: [{ name: 'Miniatura', extensions: ['jpg', 'jpeg', 'png'] }] });
        if (!thumbnail) return null;
      }
      return youtube.upload({ id, file, thumbnail }, detail => send({ kind: 'youtube', id, ...detail }));
    },
    'youtube.check': data => youtube.check(data),
    'youtube.open': ({ url }) => {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !['www.youtube.com', 'studio.youtube.com', 'console.cloud.google.com', 'commons.wikimedia.org', 'creativecommons.org'].includes(parsed.hostname)) throw Error('Enlace no permitido');
      return shell.openExternal(parsed.href);
    }
  };

  register('direct:call', ({ action, data }) => {
    if (!Object.hasOwn(handlers, action)) throw Error('Acción no permitida');
    return handlers[action](data || {});
  });

  // Recupera las copias MP4 que quedaron pendientes al cerrar la aplicación.
  setTimeout(() => {
    try {
      for (const summary of directStore.listProjects(root)) {
        const project = directStore.read(root, summary.id);
        for (const section of project.sections) if (section.take && !section.take.master) queueMaster(project.id, section.id);
      }
    } catch { /* biblioteca no disponible */ }
  }, 8000).unref?.();

  return { handlers };
}

/** Archivos servidos en records://direct/… */
function serve(root, request, url) {
  const pieces = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const kind = pieces.shift();
  let file;
  if (kind === 'take' && pieces.length === 2) file = directStore.takeFile(root, pieces[0], pieces[1]);
  else if (kind === 'file' && pieces.length >= 3) file = directStore.resolveFile(root, pieces[0], pieces.slice(1).join('/'));
  else if (kind === 'graphic' && pieces.length === 1 && /^[a-f0-9]{20}\.png$/.test(pieces[0])) file = path.join(graphics.cacheDir(root), pieces[0]);
  else if (kind === 'photo' && pieces.length === 1 && /^[a-f0-9-]{36}\.jpg$/.test(pieces[0])) file = path.join(library.dir(root), pieces[0]);
  else if (kind === 'thumb' && pieces.length === 1 && /^[a-f0-9]{24}\.jpg$/.test(pieces[0])) file = path.join(root, 'Recursos', 'Directos', 'Miniaturas', pieces[0]);
  else if (kind === 'narrator' && pieces.length === 1 && /^[a-f0-9]{24}\.m4a$/.test(pieces[0])) file = narrator.fileFor(root, pieces[0].slice(0, 24));
  else if (kind === 'sting' && pieces.length === 1 && /^\d{2,3}$/.test(pieces[0])) file = audio.stingFile(root, Number(pieces[0]) / 10);
  else if (kind === 'library' && pieces.length === 2 && ['music', 'sfx'].includes(pieces[0])) {
    try { file = audio.fileFor(root, pieces[0], pieces[1]); } catch { file = null; }
  }
  if (!file || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
  return streamFile(file, request);
}

module.exports = { install, serve, streamFile, pathToFileURL };
