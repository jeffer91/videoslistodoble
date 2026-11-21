'use strict';
/**
 * Videos largos directos · publicación directa en YouTube.
 * Usa la autorización oficial de Google (OAuth de escritorio) que Studio ya
 * guarda cifrada en el equipo y la subida reanudable de YouTube Data API v3,
 * por bloques, con progreso y reintentos. Los secretos nunca llegan a la interfaz.
 */
const fs = require('node:fs');
const directStore = require('./direct-store.cjs');
const intel = require('./direct-intel.cjs');

const GOOGLE = 'https://www.googleapis.com';
// Los mismos permisos que Estadísticas más «force-ssl», necesario para publicar el comentario.
const SCOPES = ['https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/yt-analytics.readonly', 'https://www.googleapis.com/auth/youtube.force-ssl'];
const CHUNK = 16 * 1024 * 1024; // múltiplo de 256 KiB, como exige YouTube
const RETRIES = 6;

function description(project, entry) {
  const parts = [String(project.youtube.description || '').trim()];
  if (entry.chaptersText && entry.chaptersValid !== false) parts.push(entry.chaptersText);
  const used = new Set(project.sections.flatMap(s => s.layouts.map(l => l.imageId)).filter(Boolean));
  if (project.settings.background.imageId) used.add(project.settings.background.imageId);
  const credits = project.images.filter(i => used.has(i.id) && i.source?.provider === 'Wikimedia Commons').map(i => '• ' + (i.source.attribution || intel.attribution(i.source)) + (i.source.pageUrl ? ' — ' + i.source.pageUrl : ''));
  if (credits.length) parts.push('Créditos de imágenes:\n' + credits.join('\n'));
  return parts.filter(Boolean).join('\n\n').replace(/[<>]/g, '').slice(0, 4900);
}

function createYouTube(root, publishing, { fetcher = fetch, open = () => {}, oauth } = {}) {
  let active = null;

  function status() {
    const identity = publishing.accounts().youtube;
    return { connected: Boolean(identity), channel: identity ? { id: identity.id, label: identity.label || identity.name || identity.title || 'Canal conectado' } : null,
      uploading: active ? { ...active.progress } : null };
  }

  async function connect({ clientId, clientSecret }) {
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(String(clientId || '').trim())) throw Error('Pega el ID de cliente OAuth de escritorio (termina en .apps.googleusercontent.com)');
    const secrets = await oauth({ clientId: String(clientId).trim(), clientSecret: String(clientSecret || '').trim(), scopes: SCOPES }, open);
    await publishing.connect('youtube', secrets);
    return status();
  }

  async function token(force = false) {
    const account = await publishing.accountFor('youtube');
    if (force && account.refreshToken) {
      const clients = require('./network-clients.cjs');
      return (await clients.refresh('youtube', account)).accessToken;
    }
    return account.accessToken;
  }

  async function call(url, options, retry = true) {
    const response = await fetcher(url, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + await token() } });
    if (response.status === 401 && retry) {
      await response.body?.cancel?.();
      const fresh = await token(true);
      return fetcher(url, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + fresh } });
    }
    return response;
  }

  async function failure(response, fallback) {
    const data = await response.json().catch(() => null);
    const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || '';
    const hints = { quotaExceeded: 'Se agotó la cuota diaria de YouTube Data API. Inténtalo mañana.', uploadLimitExceeded: 'YouTube alcanzó el límite de subidas del canal por hoy.',
      forbidden: 'El canal no autorizó la subida. Vuelve a conectar YouTube.', insufficientPermissions: 'Falta el permiso de YouTube. Vuelve a conectar el canal.' };
    return Error(hints[reason] || fallback + ' · HTTP ' + response.status + (reason ? ' · ' + reason : ''));
  }

  /** Sube el último MP4 exportado (o el indicado) con título, descripción y visibilidad. */
  async function upload({ id, file, thumbnail }, send = () => {}) {
    if (active) throw Error('Ya hay una subida en curso');
    const project = directStore.read(root, id);
    const entry = (project.exports || []).filter(e => e.quality === 'final' && (!file || e.file === file)).at(-1);
    if (!entry) throw Error('Exporta primero el video en calidad final');
    const path = directStore.resolveFile(root, id, entry.file);
    if (!fs.existsSync(path)) throw Error('No se encontró el MP4 exportado');
    const title = String(project.youtube.title || project.title).trim().slice(0, 100);
    if (!title) throw Error('Escribe el título del video');
    const size = fs.statSync(path).size;
    const schedule = project.youtube.publishAt && Date.parse(project.youtube.publishAt) > Date.now() + 60000 ? project.youtube.publishAt : null;
    active = { progress: { id, sent: 0, size, percent: 0, stage: 'iniciando', message: 'Preparando la subida' } };
    const report = (patch) => { Object.assign(active.progress, patch); send({ ...active.progress }); };
    try {
      let session = project.youtube.session && project.youtube.session.file === entry.file && project.youtube.session.size === size &&
        Date.now() - Date.parse(project.youtube.session.at) < 5 * 86400000 ? project.youtube.session.url : null;
      if (!session) {
        const init = await call(GOOGLE + '/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
          method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' },
          body: JSON.stringify({
            snippet: { title, description: description(project, entry), tags: project.youtube.tags || [], categoryId: '17', defaultLanguage: 'es', defaultAudioLanguage: 'es' },
            status: { privacyStatus: schedule ? 'private' : project.youtube.privacy || 'private', selfDeclaredMadeForKids: project.youtube.madeForKids === true,
              ...(schedule ? { publishAt: schedule } : {}) }
          })
        });
        if (!init.ok) throw await failure(init, 'YouTube no aceptó la subida');
        session = init.headers.get('location');
        const host = session && new URL(session).hostname;
        if (!['www.googleapis.com', 'youtube.googleapis.com', 'upload.youtube.com'].includes(host)) throw Error('YouTube devolvió una sesión de subida inválida');
        const latest = directStore.read(root, id);
        latest.youtube.session = { url: session, file: entry.file, size, at: new Date().toISOString() };
        directStore.write(root, latest);
      }
      // Averigua cuánto llegó ya (reanudar tras un corte o un reinicio).
      let offset = await uploaded(session, size);
      let result = offset === size ? await finalize(session, size) : null;
      let failures = 0;
      const handle = fs.openSync(path, 'r');
      try {
        while (!result) {
          const length = Math.min(CHUNK, size - offset);
          const chunk = Buffer.alloc(length);
          fs.readSync(handle, chunk, 0, length, offset);
          report({ stage: 'subiendo', sent: offset, percent: Math.floor(100 * offset / size), message: 'Subiendo a YouTube · ' + Math.floor(100 * offset / size) + ' %' });
          let response;
          try {
            response = await call(session, { method: 'PUT', headers: { 'Content-Length': String(length), 'Content-Type': 'video/mp4', 'Content-Range': 'bytes ' + offset + '-' + (offset + length - 1) + '/' + size }, body: chunk, signal: AbortSignal.timeout(10 * 60000) });
          } catch (error) {
            if (++failures > RETRIES) throw Error('Se perdió la conexión con YouTube. Pulsa «Publicar» otra vez para reanudar la subida.');
            await new Promise(r => setTimeout(r, Math.min(30000, 1000 * 2 ** failures)));
            offset = await uploaded(session, size);
            continue;
          }
          if (response.status === 308) {
            const range = response.headers.get('range');
            offset = range ? Number(/-(\d+)$/.exec(range)[1]) + 1 : 0;
            failures = 0;
          } else if (response.ok) {
            result = await response.json();
          } else if (response.status >= 500 || response.status === 429) {
            if (++failures > RETRIES) throw await failure(response, 'YouTube no completó la subida');
            await new Promise(r => setTimeout(r, Math.min(30000, 1000 * 2 ** failures)));
            offset = await uploaded(session, size);
          } else {
            throw await failure(response, 'YouTube rechazó la subida');
          }
        }
      } finally { fs.closeSync(handle); }
      const videoId = String(result.id || '');
      if (!/^[\w-]{11}$/.test(videoId)) throw Error('YouTube no devolvió el identificador del video');
      report({ stage: 'miniatura', sent: size, percent: 100, message: 'Video recibido por YouTube' });
      const warnings = [];
      if (thumbnail) {
        try { await setThumbnail(videoId, thumbnail); }
        catch (error) { warnings.push('Miniatura: ' + error.message); }
      }
      const requested = schedule ? 'private' : project.youtube.privacy || 'private';
      const actual = result.status?.privacyStatus || requested;
      if (actual !== requested) warnings.push('YouTube dejó el video como «' + actual + '». Los proyectos de Google Cloud sin auditoría solo pueden subir videos privados.');
      if (schedule && !result.status?.publishAt) warnings.push('YouTube no aceptó la programación; publícalo desde YouTube Studio.');
      // Primer comentario con la pregunta del video (YouTube no permite fijarlo por la API).
      let comment = null;
      const text = String(project.youtube.comment || '').trim();
      if (text) {
        if (actual === 'public') {
          try { comment = await postComment(videoId, text); }
          catch (error) { warnings.push('Comentario: ' + error.message); }
        } else warnings.push('El comentario se publicará cuando el video sea público: pulsa «Comprobar estado» después del estreno.');
      }
      const latest = directStore.read(root, id);
      delete latest.youtube.session;
      latest.youtube.lastUpload = { id: videoId, url: 'https://www.youtube.com/watch?v=' + videoId, studio: 'https://studio.youtube.com/video/' + videoId + '/edit',
        at: new Date().toISOString(), privacy: actual, publishAt: schedule, file: entry.file, title, warnings, comment, pendingComment: text && !comment ? text : '' };
      directStore.write(root, latest);
      report({ stage: 'listo', message: 'Publicado en YouTube' });
      return latest.youtube.lastUpload;
    } finally {
      active = null;
    }
  }

  async function uploaded(session, size) {
    const response = await call(session, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': 'bytes */' + size } });
    if (response.status === 308) {
      const range = response.headers.get('range');
      return range ? Number(/-(\d+)$/.exec(range)[1]) + 1 : 0;
    }
    if (response.ok) return size;
    if (response.status === 404 || response.status === 410) throw Error('La sesión de subida caducó. Pulsa «Publicar» de nuevo para empezar otra.');
    throw await failure(response, 'No se pudo consultar la subida');
  }

  async function finalize(session, size) {
    const response = await call(session, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': 'bytes */' + size } });
    return response.ok ? response.json() : null;
  }

  async function postComment(videoId, text) {
    const response = await call(GOOGLE + '/youtube/v3/commentThreads?part=snippet', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet: { videoId, topLevelComment: { snippet: { textOriginal: text.slice(0, 1000) } } } }) });
    if (response.status === 403) {
      const data = await response.json().catch(() => null);
      const reason = data?.error?.errors?.[0]?.reason || '';
      if (/insufficient|scope/i.test(reason + JSON.stringify(data || ''))) throw Error('vuelve a conectar YouTube en este apartado para permitir comentarios');
      throw Error('YouTube no permitió comentar (' + (reason || 'HTTP 403') + ')');
    }
    if (!response.ok) throw await failure(response, 'YouTube no publicó el comentario');
    const data = await response.json();
    return { id: data.id, at: new Date().toISOString() };
  }

  async function setThumbnail(videoId, file) {
    const ext = String(file).toLowerCase().split('.').pop();
    if (!['jpg', 'jpeg', 'png'].includes(ext)) throw Error('La miniatura debe ser JPG o PNG');
    const data = fs.readFileSync(file);
    if (data.length > 2 * 1024 * 1024) throw Error('YouTube admite miniaturas de hasta 2 MB');
    const response = await call(GOOGLE + '/upload/youtube/v3/thumbnails/set?videoId=' + videoId + '&uploadType=media', {
      method: 'POST', headers: { 'Content-Type': ext === 'png' ? 'image/png' : 'image/jpeg', 'Content-Length': String(data.length) }, body: data });
    if (!response.ok) throw await failure(response, 'YouTube no aceptó la miniatura (requiere un canal verificado)');
  }

  /** Estado de procesamiento del último video subido. */
  async function check({ id }) {
    const project = directStore.read(root, id);
    const last = project.youtube.lastUpload;
    if (!last) throw Error('Todavía no se ha subido este proyecto');
    const response = await call(GOOGLE + '/youtube/v3/videos?part=status,processingDetails&id=' + last.id, { method: 'GET', headers: {} });
    if (!response.ok) throw await failure(response, 'No se pudo consultar YouTube');
    const item = (await response.json()).items?.[0];
    if (!item) return { ...last, processing: 'YouTube aún no muestra el video' };
    const processing = { processed: 'Procesado', uploaded: 'Procesando en YouTube', failed: 'Falló el procesamiento', rejected: 'Rechazado por YouTube', deleted: 'Eliminado' }[item.status?.uploadStatus] || item.status?.uploadStatus;
    const latest = directStore.read(root, id);
    const update = { ...last, privacy: item.status?.privacyStatus || last.privacy, processing };
    if (update.pendingComment && update.privacy === 'public') {
      try { update.comment = await postComment(last.id, update.pendingComment); update.pendingComment = ''; }
      catch (error) { update.warnings = [...(last.warnings || []).filter(w => !w.startsWith('Comentario')), 'Comentario: ' + error.message]; }
    }
    latest.youtube.lastUpload = update;
    directStore.write(root, latest);
    return latest.youtube.lastUpload;
  }

  return { status, connect, upload, check, description: (project, entry) => description(project, entry) };
}

module.exports = { createYouTube, description, CHUNK, SCOPES };
