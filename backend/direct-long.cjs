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
const render = require('./direct-render.cjs');
const { createYouTube } = require('./direct-youtube.cjs');

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
    'script.apply': data => directStore.importScript(root, data),
    'section.update': data => directStore.updateSection(root, data),
    'section.add': data => directStore.addSection(root, data),
    'section.remove': data => directStore.removeSection(root, data),
    'section.move': data => directStore.moveSection(root, data),
    'settings.save': data => directStore.saveSettings(root, data),

    // Grabación
    'take.begin': data => directStore.beginTake(root, data),
    'take.append': data => directStore.appendTake(root, data),
    'take.inspect': data => directStore.inspectTake(root, data, media),
    'take.discard': data => directStore.discardTake(root, data),
    'take.pending': ({ id }) => directStore.pendingTakes(root, id),
    'take.commit': async data => {
      const result = await directStore.commitTake(root, data, media);
      queueMaster(data.id, result.sectionId);
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
      return directStore.write(root, project);
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
      return { ...intel.propose(project, project.sections.find(s => s.id === sectionId), { statImages: stats.map }), project };
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
      const bg = await graphics.background(root, style);
      const title = await graphics.titleCard(root, { label: section.intro ? 'Once Records presenta' : 'Sección ' + String(section.number).padStart(2, '0'),
        title: section.transition.title || (section.intro ? project.title : section.title) });
      return { style, background: 'records://direct/graphic/' + path.basename(bg), title: 'records://direct/graphic/' + path.basename(title) };
    },

    // Audio
    'audio.catalog': () => audio.catalog(),
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
  else if (kind === 'thumb' && pieces.length === 1 && /^[a-f0-9]{24}\.jpg$/.test(pieces[0])) file = path.join(root, 'Recursos', 'Directos', 'Miniaturas', pieces[0]);
  else if (kind === 'library' && pieces.length === 2 && ['music', 'sfx'].includes(pieces[0])) {
    try { file = audio.fileFor(root, pieces[0], pieces[1]); } catch { file = null; }
  }
  if (!file || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
  return streamFile(file, request);
}

module.exports = { install, serve, streamFile, pathToFileURL };
