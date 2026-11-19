'use strict';
const fs = require('node:fs');
const { createHash, randomBytes } = require('node:crypto');
const http = require('node:http');

const GOOGLE = 'https://www.googleapis.com';
const TIKTOK = 'https://open.tiktokapis.com';
const META = 'https://graph.facebook.com/v24.0';
// Instagram API con inicio de sesión de Instagram: no necesita una página de Facebook.
const IG_LOGIN = 'https://graph.instagram.com/v24.0';
const AYR = 'https://api.ayrshare.com/api';
const AUTH_TIMEOUT = 5 * 60 * 1000;
const REQUEST_TIMEOUT = 25 * 1000;
const UPLOAD_TIMEOUT = 25 * 60 * 1000;
const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/yt-analytics.readonly'
];

class NetworkError extends Error {
  constructor(message, permanent = true) {
    super(message);
    this.permanent = permanent;
  }
}

function urlFor(base, query = {}) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

async function request(base, { query, method, token, json, form, headers, upload, body, raw, allowed = [] } = {}) {
  const options = {
    method: method || 'GET', redirect: 'error',
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    signal: AbortSignal.timeout(upload ? UPLOAD_TIMEOUT : REQUEST_TIMEOUT)
  };
  if (json !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(json);
  }
  if (form) {
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = new URLSearchParams(form);
  }
  if (body) {
    options.body = body;
    options.duplex = 'half';
  }
  const response = await fetch(urlFor(base, query), options);
  if (response.ok && raw || allowed.includes(response.status)) {
    await response.body?.cancel();
    return { status: response.status, headers: response.headers };
  }
  const data = await response.text().then(text => JSON.parse(text, (_key, value, context) => {
    // TikTok returns post IDs as int64. Keep the original digits before Number rounds them.
    if (typeof value === 'number' && !Number.isSafeInteger(value) && /^-?\d+$/.test(context?.source || '')) {
      return context.source;
    }
    return value;
  })).catch(() => null);
  const apiError = typeof data?.error === 'string' ? data.error : data?.error?.code;
  if (!response.ok || apiError && apiError !== 'ok') {
    const code = /^[a-zA-Z0-9_.-]{1,100}$/.test(String(apiError ?? '')) ? ' · ' + apiError : '';
    throw new NetworkError('La plataforma respondió HTTP ' + response.status + code,
      response.status < 500 && ![408, 429].includes(response.status));
  }
  if (data === null) throw new NetworkError('Respuesta inválida de la plataforma', false);
  return data;
}

function numericId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value) || !/^\d{1,40}$/.test(String(value))) throw new NetworkError('Identificador de la plataforma inválido');
  return String(value);
}

function instagramLogin(account) {
  return account?.provider === 'instagram-login';
}

function metaBase(account) {
  return instagramLogin(account) ? IG_LOGIN : META;
}

function instagramOwner(account) {
  return numericId(account.profileId || account.identity?.id);
}

function videoId(value) {
  if (!/^[\w-]{11}$/.test(String(value))) throw new NetworkError('YouTube no devolvió un identificador de video', false);
  return value;
}

function uploadLocation(value, allowed) {
  let url;
  try { url = new URL(value); } catch { throw new NetworkError('La plataforma no devolvió una sesión de carga', false); }
  if (url.protocol !== 'https:' || url.username || url.password || !allowed.includes(url.hostname)) {
    throw new NetworkError('El destino de carga no coincide con la plataforma');
  }
  return url.href;
}

function caption(metadata, max) {
  const tags = metadata.tags.map(value => '#' + value.replace(/[^\p{L}\p{N}_]/gu, '')).filter(value => value !== '#');
  return [metadata.title, metadata.description, tags.join(' ')].filter(Boolean).join('\n\n').slice(0, max);
}

function tokenExpiration(seconds) {
  return new Date(Date.now() + (Number(seconds) || 3600) * 1000).toISOString();
}

async function googleOAuth({ clientId, clientSecret }, open) {
  if (!String(clientId || '').endsWith('.apps.googleusercontent.com')) throw Error('Usa un cliente OAuth de escritorio de Google');
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let settle;
  const completed = new Promise(resolve => { settle = resolve; });
  const server = http.createServer((req, res) => {
    const target = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || target.pathname !== '/oauth' || target.searchParams.get('state') !== state) {
      res.writeHead(404).end();
      return;
    }
    const code = target.searchParams.get('code');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(code ? 'Vuelve a 11 Récords Studio para terminar la conexión.' : 'Se canceló la autorización en Google.');
    settle(code);
  });
  let timer;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const redirect = 'http://127.0.0.1:' + server.address().port + '/oauth';
    const link = urlFor('https://accounts.google.com/o/oauth2/v2/auth', {
      client_id: clientId, redirect_uri: redirect, response_type: 'code', access_type: 'offline',
      prompt: 'consent', scope: SCOPES.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256'
    });
    await open(link.href);
    timer = setTimeout(() => settle(null), AUTH_TIMEOUT);
    const code = await completed;
    if (!code) throw Error('Google no devolvió autorización. Vuelve a intentar al conectar.');
    const response = await request('https://oauth2.googleapis.com/token', { method: 'POST', form: {
      code, client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}),
      redirect_uri: redirect, code_verifier: verifier, grant_type: 'authorization_code'
    } });
    return {
      accessToken: response.access_token, refreshToken: response.refresh_token,
      expiresAt: tokenExpiration(response.expires_in), clientId, clientSecret
    };
  } finally {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  }
}

async function refresh(name, account) {
  if (name === 'instagram' && instagramLogin(account)) {
    // Los tokens de larga duración de Instagram duran 60 días y se renuevan con el propio token.
    const result = await request('https://graph.instagram.com/refresh_access_token', {
      query: { grant_type: 'ig_refresh_token', access_token: account.accessToken }
    });
    if (!result.access_token) throw Error('Instagram no renovó el acceso');
    return { ...account, accessToken: result.access_token, expiresAt: tokenExpiration(result.expires_in || 60 * 86400) };
  }
  if (!account.refreshToken || !account.clientId) throw Error('Renueva la conexión de ' + name + ' en Estadísticas → Conexiones');
  const google = name === 'youtube';
  if (!google && name !== 'tiktok') throw Error('Renueva el token de Instagram en Ajustes');
  const result = await request(google ? 'https://oauth2.googleapis.com/token' : TIKTOK + '/v2/oauth/token/', {
    method: 'POST', form: {
      [google ? 'client_id' : 'client_key']: account.clientId,
      ...(account.clientSecret ? { client_secret: account.clientSecret } : {}),
      refresh_token: account.refreshToken, grant_type: 'refresh_token'
    }
  });
  if (!result.access_token) throw Error('La plataforma no renovó el acceso');
  return { ...account, accessToken: result.access_token, refreshToken: result.refresh_token || account.refreshToken,
    expiresAt: tokenExpiration(result.expires_in) };
}

async function verifyAccount(name, account) {
  const token = account.accessToken;
  if (name === 'tiktok' && account.provider === 'ayrshare') {
    const profile = await ayr(account, '/user');
    const social = profile.displayNames?.find(item => item.platform === 'tiktok');
    const id = social?.id || social?.userId || social?.username;
    if (!profile.activeSocialAccounts?.includes('tiktok') || !id) {
      throw Error('Vincula TikTok en tu perfil de Ayrshare antes de conectarlo aquí');
    }
    return { id: 'ayrshare:' + id, label: (social.displayName || social.username || 'TikTok') + ' · Ayrshare',
      provider: 'ayrshare' };
  }
  if (name === 'youtube') {
    const result = await request(GOOGLE + '/youtube/v3/channels', { query: { part: 'id,snippet,statistics', mine: true }, token });
    const channel = result.items?.[0];
    if (!channel?.id) throw Error('No se encontró un canal de YouTube con este acceso');
    return { id: channel.id, label: channel.snippet.title, followers: valueNumber(channel.statistics?.subscriberCount) };
  }
  if (name === 'tiktok') {
    const result = await request(TIKTOK + '/v2/user/info/', { query: { fields: 'open_id,display_name' }, token });
    const user = result.data?.user;
    if (!user?.open_id) throw Error('No se encontró una cuenta de TikTok con este acceso');
    return { id: user.open_id, label: user.display_name };
  }
  if (name === 'facebook') {
    const page = await request(META + '/me', {token,query:{fields:'id,name'}});
    if (String(page.id)!==numericId(account.profileId)) throw Error('El token debe pertenecer a la página indicada');
    return {id:String(page.id),label:page.name};
  }
  if (name === 'instagram' && instagramLogin(account)) {
    const result = await request(IG_LOGIN + '/me', { token, query: { fields: 'user_id,username,followers_count,account_type' } });
    const id = String(result.user_id || result.id || '');
    if (!result.username || !/^\d{1,40}$/.test(id)) throw Error('El token no corresponde a una cuenta profesional de Instagram');
    if (result.account_type && !['BUSINESS', 'MEDIA_CREATOR', 'CREATOR'].includes(String(result.account_type).toUpperCase())) {
      throw Error('Cambia tu Instagram a cuenta profesional (Creador o Empresa)');
    }
    return { id, label: '@' + result.username, followers: valueNumber(result.followers_count), provider: 'instagram-login' };
  }
  if (name === 'instagram') {
    const result = await request(META + '/' + numericId(account.profileId), { token, query: { fields: 'id,username,followers_count' } });
    if (!result.username) throw Error('No se encontró el perfil profesional de Instagram indicado');
    return { id: String(result.id), label: '@' + result.username, followers: valueNumber(result.followers_count) };
  }
  throw Error('Red desconocida');
}

async function tiktokCreator(account) {
  if (account.provider === 'ayrshare') {
    const identity = await verifyAccount('tiktok', account);
    if (identity.id !== account.identity.id) throw Error('La cuenta de TikTok en Ayrshare cambió');
    return { label: identity.label, privacy: ['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS', 'PUBLIC_TO_EVERYONE'],
      comments: true, duet: true, stitch: true, provider: 'ayrshare' };
  }
  const result = await request(TIKTOK + '/v2/post/publish/creator_info/query/', {
    method: 'POST', token: account.accessToken, json: {}
  });
  const creator = result.data || {};
  return {
    username: creator.creator_username || '',
    label: creator.creator_nickname || '',
    privacy: creator.privacy_level_options || [],
    maxDuration: creator.max_video_post_duration_sec || 0,
    comments: creator.comment_disabled !== true, duet: creator.duet_disabled !== true, stitch: creator.stitch_disabled !== true
  };
}

async function uploadYouTube(context) {
  const { token, file, metadata, checkpoint, remote, thumbnail } = context;
  if (!remote.id) {
    const size = fs.statSync(file).size;
    const initialized = await request(GOOGLE + '/upload/youtube/v3/videos', {
      token, method: 'POST', query: { uploadType: 'resumable', part: 'snippet,status' }, raw: true,
      headers: { 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' },
      json: {
        snippet: { title: metadata.title, description: metadata.description, tags: metadata.tags, categoryId: '17' },
        status: { privacyStatus: 'private', selfDeclaredMadeForKids: metadata.madeForKids }
      }
    });
    const session = uploadLocation(initialized.headers.get('location'), ['www.googleapis.com', 'upload.youtube.com', 'youtube.googleapis.com']);
    const result = await request(session, {
      method: 'PUT', token, upload: true, body: fs.createReadStream(file),
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Content-Range': 'bytes 0-' + (size - 1) + '/' + size }
    });
    checkpoint({ id: videoId(result.id) });
    return { processing: true };
  }
  const id = videoId(remote.id);
  const result = await request(GOOGLE + '/youtube/v3/videos', {
    token, query: { id, part: 'processingDetails,status' }
  });
  const item = result.items?.[0];
  if (!item) throw new NetworkError('YouTube todavía no devuelve el video', false);
  const uploadStatus = item.status?.uploadStatus;
  const processingStatus = item.processingDetails?.processingStatus;
  if (['failed', 'rejected', 'deleted'].includes(uploadStatus) || ['failed', 'terminated'].includes(processingStatus)) {
    throw new NetworkError('YouTube rechazó el procesamiento del video');
  }
  if (uploadStatus !== 'processed' && processingStatus !== 'succeeded') return { processing: true };
  if (thumbnail && !remote.coverApplied) {
    const size = fs.statSync(thumbnail).size;
    await request(GOOGLE + '/upload/youtube/v3/thumbnails/set', {
      method: 'POST', token, query: { videoId: id, uploadType: 'media' }, upload: true,
      headers: { 'Content-Length': String(size), 'Content-Type': 'image/jpeg' }, body: fs.createReadStream(thumbnail)
    });
    checkpoint({ coverApplied: true });
  }
  if ((metadata.privacy || 'private') !== item.status.privacyStatus) {
    await request(GOOGLE + '/youtube/v3/videos', {
      method: 'PUT', token, query: { part: 'status' },
      json: { id, status: { privacyStatus: metadata.privacy || 'private', selfDeclaredMadeForKids: metadata.madeForKids } }
    });
  }
  return { id, url: 'https://www.youtube.com/watch?v=' + id };
}

async function uploadTikTok(context) {
  if (context.account.provider === 'ayrshare') return uploadAyrTikTok(context);
  const { account, token, file, metadata, quality, remote, checkpoint } = context;
  if (!remote.publishId) {
    const own = await tiktokCreator(account);
    if (!own.privacy.includes(metadata.privacy)) throw new NetworkError('Vuelve a elegir una visibilidad admitida por TikTok');
    if (quality.duration > own.maxDuration) throw new NetworkError('Este video supera el límite de tu cuenta de TikTok');
    const size = fs.statSync(file).size;
    const chunkSize = Math.min(size, 16 * 1024 * 1024);
    const total = Math.max(1, Math.floor(size / chunkSize));
    const result = await request(TIKTOK + '/v2/post/publish/video/init/', {
      token, method: 'POST', json: {
        post_info: {
          title: caption(metadata, 2200), privacy_level: metadata.privacy, disable_comment: !own.comments || !metadata.comments,
          disable_duet: !own.duet || !metadata.duet, disable_stitch: !own.stitch || !metadata.stitch,
          video_cover_timestamp_ms: Math.floor(1000 * Math.min(metadata.coverTime, Math.max(0, quality.duration - .1))),
          brand_content_toggle: metadata.branded, brand_organic_toggle: metadata.ownBrand
        },
        source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: total }
      }
    });
    const session = uploadLocation(result.data?.upload_url, ['open-upload.tiktokapis.com']);
    const publishId = result.data?.publish_id;
    if (!publishId || typeof publishId !== 'string') throw new NetworkError('TikTok no devolvió un identificador de publicación', false);
    checkpoint({ uploadStarted: true, publishId, username: own.username });
    for (let index = 0; index < total; index++) {
      const start = index * chunkSize;
      const end = index === total - 1 ? size - 1 : start + chunkSize - 1;
      const reply = await request(session, { method: 'PUT', upload: true, raw: true, allowed: [206, 201],
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(end - start + 1),
          'Content-Range': 'bytes ' + start + '-' + end + '/' + size }, body: fs.createReadStream(file, { start, end })
      });
      if (index === total - 1 && reply.status !== 201) throw new NetworkError('TikTok no confirmó la carga completa', false);
    }
    checkpoint({ uploaded: true });
    return { processing: true };
  }
  const result = await request(TIKTOK + '/v2/post/publish/status/fetch/', {
    method: 'POST', token, json: { publish_id: remote.publishId }
  });
  const status = result.data?.status;
  if (status === 'FAILED') throw new NetworkError('TikTok rechazó el video: ' + String(result.data.fail_reason || 'falló la carga').replace(/[^\w.-]/g, '').slice(0, 90));
  if (status !== 'PUBLISH_COMPLETE') return { processing: true };
  const rawId = (result.data.publicaly_available_post_id || result.data.publicly_available_post_id || [])[0];
  if (!rawId) return { id: null, url: null, note: 'TikTok confirmó la publicación y omitió el enlace público' };
  const id = numericId(rawId);
  return { id, url: remote.username ? 'https://www.tiktok.com/@' + encodeURIComponent(remote.username) + '/video/' + id : null };
}

function ayr(account, endpoint, options = {}) {
  return request(AYR + endpoint, {
    token: account.accessToken, ...options,
    headers: { ...options.headers, ...(account.profileId ? { 'Profile-Key': account.profileId } : {}) }
  });
}

async function uploadToAyr(account, file, contentType, fileName) {
  const size = fs.statSync(file).size;
  let publicUrl;
  if (size <= 10 * 1024 * 1024) {
    const posted = await ayr(account, '/media/upload', { method: 'POST', json: {
      file: 'data:' + contentType + ';base64,' + fs.readFileSync(file).toString('base64'), fileName
    } });
    publicUrl = posted.url;
  } else {
    const session = await ayr(account, '/media/uploadUrl', { query: { fileName, contentType: 'mp4' } });
    const upload = uploadLocation(session.uploadUrl, ['storage.googleapis.com']);
    await request(upload, { method: 'PUT', upload: true, raw: true, body: fs.createReadStream(file),
      headers: { 'Content-Type': session.contentType, 'Content-Length': String(size) } });
    publicUrl = session.accessUrl;
  }
  return uploadLocation(publicUrl, ['media.ayrshare.com', 'images.ayrshare.com', 'img.ayrshare.com']);
}

async function uploadAyrTikTok({ account, file, thumbnail, metadata, remote, checkpoint, quality }) {
  if (!remote.ayrId) {
    const profile = await tiktokCreator(account);
    if (!profile.privacy.includes(metadata.privacy)) throw new NetworkError('Elige una visibilidad de TikTok admitida');
    const mediaUrl = await uploadToAyr(account, file, 'video/mp4', '11-records.mp4');
    const cover = thumbnail ? await uploadToAyr(account, thumbnail, 'image/jpeg', 'portada.jpg') : null;
    const visibility = { SELF_ONLY: 'private', MUTUAL_FOLLOW_FRIENDS: 'friends', PUBLIC_TO_EVERYONE: 'public' };
    const result = await ayr(account, '/post', { method: 'POST', json: {
      platforms: ['tiktok'], isVideo: true, post: caption(metadata, 2200), mediaUrls: [mediaUrl],
      tikTokOptions: {
        visibility: visibility[metadata.privacy], disableComments: !metadata.comments, disableDuet: !metadata.duet,
        disableStitch: !metadata.stitch, isBrandedContent: metadata.branded, isBrandOrganic: metadata.ownBrand,
        ...(cover ? { thumbNail: cover } :
          { thumbNailOffset: Math.round(Math.min(metadata.coverTime, Math.max(0, quality.duration - .1)) * 1000) })
      }
    } });
    if (result.status === 'error') throw new NetworkError('Ayrshare rechazó el envío a TikTok');
    if (!/^[a-zA-Z0-9_-]{5,90}$/.test(String(result.id))) throw new NetworkError('Ayrshare no devolvió el identificador del envío', false);
    checkpoint({ ayrId: result.id });
    return { processing: true };
  }
  const history = await ayr(account, '/history/' + encodeURIComponent(remote.ayrId));
  const post = history.postIds?.find(row => row.platform === 'tiktok');
  if (history.status === 'error' || post?.id === 'failed' || post?.status === 'error') {
    throw new NetworkError('Ayrshare informó que TikTok rechazó el video');
  }
  if (!post?.id || post.id === 'pending') return { processing: true };
  return { id: numericId(post.id), url: post.postUrl || null };
}

async function uploadInstagram(context) {
  const { account, token, file, metadata, quality, remote, checkpoint } = context;
  const owner = instagramOwner(account);
  const base = metaBase(account);
  if (!remote.container) {
    const size = fs.statSync(file).size;
    if (quality.duration < 3 || quality.duration > 900 || size > 1024 ** 3) {
      throw new NetworkError('Instagram admite Reels entre 3 segundos y 15 minutos, de hasta 1 GB');
    }
    const created = await request(base + '/' + owner + '/media', { method: 'POST', token, form: {
      media_type: 'REELS', upload_type: 'resumable', caption: caption(metadata, 2200),
      ...(metadata.coverUrl ? { cover_url: metadata.coverUrl } :
        { thumb_offset: String(Math.round(Math.min(metadata.coverTime, Math.max(0, quality.duration - .1)) * 1000)) })
    } });
    const container = numericId(created.id);
    const session = uploadLocation(created.uri, ['rupload.facebook.com']);
    checkpoint({ container });
    await request(session, { method: 'POST', upload: true, body: fs.createReadStream(file),
      headers: { Authorization: 'OAuth ' + token, 'Content-Length': String(size),
        'Content-Type': 'application/octet-stream', offset: '0', file_size: String(size) }
    });
    checkpoint({ uploaded: true });
    return { processing: true };
  }
  if (!remote.id) {
    const status = await request(base + '/' + numericId(remote.container), { token, query: { fields: 'status_code' } });
    if (['EXPIRED', 'ERROR'].includes(status.status_code)) throw new NetworkError('Instagram no pudo preparar el Reel');
    if (status.status_code === 'PUBLISHED') throw new NetworkError('Confirma en Instagram el enlace del Reel ya publicado');
    if (status.status_code !== 'FINISHED') return { processing: true };
    const result = await request(base + '/' + owner + '/media_publish', {
      token, method: 'POST', form: { creation_id: numericId(remote.container) }
    });
    checkpoint({ id: numericId(result.id) });
  }
  const id = numericId(remote.id);
  const post = await request(base + '/' + id, { token, query: { fields: 'permalink' } });
  return { id, url: post.permalink || null };
}

function valueNumber(x) {
  const value = Number(x);
  return x !== undefined && x !== null && Number.isFinite(value) ? value : null;
}

async function metrics(name, account, job, quality) {
  const token = account.accessToken;
  const id = job.externalId;
  if (name === 'youtube') {
    const videos = await request(GOOGLE + '/youtube/v3/videos', { token, query: { id: videoId(id), part: 'statistics' } });
    const data = videos.items?.[0]?.statistics;
    if (!data) throw Error('YouTube no encontró el video');
    const profile = await verifyAccount(name, account);
    const stats = await request('https://youtubeanalytics.googleapis.com/v2/reports', {
      token, query: { ids: 'channel==MINE', startDate: job.publishedAt.slice(0, 10),
        endDate: new Date().toISOString().slice(0, 10), metrics: 'averageViewPercentage', filters: 'video==' + id }
    }).catch(() => ({}));
    return { views: valueNumber(data.viewCount), likes: valueNumber(data.likeCount), comments: valueNumber(data.commentCount),
      retention: valueNumber(stats.rows?.[0]?.[0]), followers: profile.followers };
  }
  if (name === 'tiktok' && account.provider === 'ayrshare') {
    const result = await ayr(account, '/analytics/post', { method: 'POST', json: {
      id: job.remote?.ayrId || numericId(id), platforms: ['tiktok'], ...(!job.remote?.ayrId ? { searchPlatformId: true } : {})
    } });
    const data = result.tiktok?.analytics;
    if (!data) throw Error('TikTok aún no devolvió métricas por Ayrshare');
    const followers = await ayr(account, '/analytics/social', { method: 'POST', json: { platforms: ['tiktok'] } }).catch(() => ({}));
    const average = valueNumber(data.averageTimeWatched);
    return { views: valueNumber(data.videoViews), likes: valueNumber(data.likeCount), comments: valueNumber(data.commentsCount),
      followers: valueNumber(followers.tiktok?.analytics?.followerCount),
      retention: average !== null && quality?.duration ? 100 * average / quality.duration : null };
  }
  if (name === 'tiktok') {
    const videos = await request(TIKTOK + '/v2/video/query/', {
      token, method: 'POST', query: { fields: 'id,view_count,like_count,comment_count,share_count,share_url' },
      json: { filters: { video_ids: [numericId(id)] } }
    });
    const data = videos.data?.videos?.[0];
    if (!data) throw Error('TikTok no devolvió estadísticas de este video');
    const profile = await request(TIKTOK + '/v2/user/info/', { token, query: { fields: 'follower_count' } }).catch(() => ({}));
    return { views: valueNumber(data.view_count), likes: valueNumber(data.like_count), comments: valueNumber(data.comment_count),
      followers: valueNumber(profile.data?.user?.follower_count), retention: null };
  }
  const base = metaBase(account);
  const data = await request(base + '/' + numericId(id), { token, query: { fields: 'like_count,comments_count' } });
  const profile = await verifyAccount(name, account);
  const insight = async metric => {
    const result = await request(base + '/' + id + '/insights', { token, query: { metric } }).catch(() => null);
    return valueNumber(result?.data?.[0]?.values?.[0]?.value ?? result?.data?.[0]?.total_value?.value);
  };
  const [views, watch] = await Promise.all([insight('views'), insight('ig_reels_avg_watch_time')]);
  return { views, likes: valueNumber(data.like_count), comments: valueNumber(data.comments_count),
    followers: profile.followers, retention: watch !== null && quality?.duration ? watch / (quality.duration * 10) : null };
}

const publish = { youtube: uploadYouTube, tiktok: uploadTikTok, instagram: uploadInstagram };

const catalogPages = (network,account) => require('./video-statistics.cjs').catalog(request,network === 'instagram' ? metaBase(account) : META,network,account);
module.exports = { catalogPages, NetworkError, request, googleOAuth, refresh, verifyAccount, tiktokCreator, publish, metrics };
