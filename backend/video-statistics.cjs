'use strict';

const YT = 'https://www.googleapis.com/youtube/v3';
const YA = 'https://youtubeanalytics.googleapis.com/v2/reports';
const IG_METRICS = ['views','reach','shares','saved','total_interactions','ig_reels_avg_watch_time','ig_reels_video_view_total_time'];
const YT_METRICS = ['engagedViews','shares','estimatedMinutesWatched','averageViewDuration','averageViewPercentage',
  'subscribersGained','subscribersLost','videosAddedToPlaylists','videosRemovedFromPlaylists'];

function number(value) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
}
function nextCursor(seen, cursor) {
  if (cursor == null || cursor === '' || seen.has(String(cursor))) throw Error('Paginación incompleta o repetida');
  seen.add(String(cursor));
  return cursor;
}
function list(data) {
  if (!Array.isArray(data)) throw Error('La plataforma no devolvió el listado esperado');
  return data;
}
function iso(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

async function* youtube(request, account) {
  const token = account.accessToken;
  const get = (url,query) => request(url,{token,query});
  const channel = (await get(YT+'/channels',{mine:true,part:'contentDetails,statistics'})).items?.[0];
  const playlistId = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) throw Error('No se encontró la lista de videos del canal');
  const seen = new Set();
  let pageToken;
  do {
    const page = await get(YT+'/playlistItems',{playlistId,part:'contentDetails',maxResults:50,pageToken});
    const ids = list(page.items).map(x=>x.contentDetails.videoId);
    if (ids.length) {
      const details = await get(YT+'/videos',{id:ids.join(','),part:'snippet,statistics,contentDetails,status'});
      const videos = list(details.items);
      const reports = new Map();
      let warning = videos.length < ids.length ? 'Hay videos de la lista sin acceso a sus detalles.' : '';
      if (videos.length) {
        const reportQuery={ids:'channel==MINE', startDate:videos.map(v=>v.snippet.publishedAt.slice(0,10)).sort()[0],
          endDate:new Date().toISOString().slice(0,10), dimensions:'video', filters:'video=='+videos.map(v=>v.id).join(','),
          sort:'-views', maxResults:50};
        async function reportFor(metrics) {
          const report=await get(YA,{...reportQuery,metrics:['views',...metrics].join(',')});
          for(const row of report.rows||[])reports.set(row[0],Object.fromEntries(report.columnHeaders.slice(1).map((h,i)=>[h.name,row[i+1]])));
        }
        try {await reportFor(YT_METRICS)}
        catch(error) {
          warning += ' YouTube Analytics: '+error.message;
          try {await reportFor(['estimatedMinutesWatched','averageViewDuration','averageViewPercentage','shares'])}
          catch { /* Data API counters remain available without Analytics permissions. */ }
        }
      }
      yield {warning, videos:videos.map(v=>{
        const s=v.statistics||{}, a=reports.get(v.id)||{};
        return {externalId:v.id,title:v.snippet.title,publishedAt:iso(v.snippet.publishedAt),url:'https://www.youtube.com/watch?v='+v.id,
          duration:v.contentDetails.duration,visibility:v.status?.privacyStatus,description:v.snippet.description,
          metrics:{...Object.fromEntries(Object.entries(s).map(([k,n])=>[k,number(n)])),...a,views:number(s.viewCount),likes:number(s.likeCount),
            comments:number(s.commentCount),shares:number(a.shares),retention:number(a.averageViewPercentage),followers:number(channel.statistics?.subscriberCount)}};
      })};
    }
    pageToken=page.nextPageToken ? nextCursor(seen,page.nextPageToken) : null;
  } while(pageToken);
}

async function* ayrshare(request,account) {
  const seen=new Set();
  let next;
  do {
    const result=await request('https://api.ayrshare.com/api/history/tiktok',{token:account.accessToken,
      headers:account.profileId?{'Profile-Key':account.profileId}:{},query:{limit:20,next}});
    if(result.status==='error')throw Error('Ayrshare no permitió consultar el historial');
    const posts=list(result.posts);
    const videos=posts.filter(v=>v.id && (!v.mediaType || v.mediaType==='video')).map(v=>{
      const metrics=Object.fromEntries(Object.entries(v).filter(([key,value])=>
        (typeof value==='number' || Array.isArray(value)) && !['tags','thumbnailWidth','thumbnailHeight','videoDuration'].includes(key)));
      return {externalId:String(v.id),title:v.post||String(v.id),publishedAt:iso(v.created),duration:v.videoDuration,url:v.postUrl||v.shareUrl,
        metrics:{...metrics,views:number(v.videoViews),likes:number(v.likeCount),comments:number(v.commentsCount),shares:number(v.shareCount),
        retention:v.videoDuration && v.averageTimeWatched!=null ? 100*v.averageTimeWatched/v.videoDuration:null}};
    });
    const paging=result.meta?.pagination;
    yield {videos,warning:!paging&&posts.length>=20?'Ayrshare no devolvió cursor; la cobertura puede ser parcial.':''};
    next=paging?.hasMore?nextCursor(seen,paging.next):null;
  }while(next);
}

async function* tiktok(request,account) {
  if(account.provider==='ayrshare'){yield* ayrshare(request,account);return}
  const fields='id,title,video_description,create_time,duration,share_url,view_count,like_count,comment_count,share_count';
  let followers=null;
  try {
    const profile=await request('https://open.tiktokapis.com/v2/user/info/',{token:account.accessToken,query:{fields:'follower_count'}});
    followers=number(profile.data?.user?.follower_count);
  } catch { /* user.info.stats is optional for video.list. */ }
  const seen=new Set();
  let cursor;
  do {
    const result=await request('https://open.tiktokapis.com/v2/video/list/',{method:'POST',token:account.accessToken,
      query:{fields},json:{max_count:20,...(cursor==null?{}:{cursor})}});
    const page=result.data;
    yield {videos:list(page?.videos).map(v=>({externalId:String(v.id),title:v.title||v.video_description||String(v.id),
      publishedAt:iso(new Date(v.create_time*1000).toISOString()),duration:v.duration,description:v.video_description,url:v.share_url,
      metrics:{views:number(v.view_count),likes:number(v.like_count),comments:number(v.comment_count),shares:number(v.share_count),followers}}))};
    cursor=page.has_more ? nextCursor(seen,page.cursor) : null;
  } while(cursor!=null);
}

async function* graphPages(request, endpoint, account, fields) {
  const seen=new Set();
  let after;
  do {
    const data=await request(endpoint,{token:account.accessToken,query:{fields,limit:50,after}});
    yield list(data.data);
    after=data.paging?.next ? nextCursor(seen,data.paging?.cursors?.after) : null;
  } while(after);
}
async function* meta(request,base,network,account) {
  const instagram=network==='instagram',seen=new Set();
  let insightsPermissionDenied=false;
  const permissionError=error=>/HTTP (400|403) · 10\b/.test(String(error?.message||''));
  const historicalMediaError=error=>/subcódigo 2108006\b/.test(String(error?.message||''));
  const missingInsights='Instagram Insights: Meta rechazó el permiso de estadísticas (código 10). Comprueba instagram_manage_insights en la configuración unificada y vuelve a autorizar Instagram para generar un token nuevo.';
  const edges=instagram?['media']:['videos','video_reels'];
  const fields=instagram?'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count':'id,title,description,created_time,permalink_url,length';
  for(const edge of edges){
    try {
      for await(const page of graphPages(request,base+'/'+account.identity.id+'/'+edge,account,fields)){
        const videos=[], warnings=new Set();
        for(const v of page){
          if(seen.has(v.id)||(instagram && v.media_type!=='VIDEO')) continue;
          seen.add(v.id);
          const metrics=instagram?{likes:number(v.like_count),comments:number(v.comments_count)}:{};
          const endpoint=base+'/'+v.id+(instagram?'/insights':'/video_insights');
          const read=async metric=>{
            const result=await request(endpoint,{token:account.accessToken,query:metric?{metric}:{}});
            for(const entry of list(result.data)) {
              const value=entry.total_value?.value??entry.values?.at(-1)?.value;
              if(value!=null) metrics[entry.name]=value;
              if(entry.values?.length>1)metrics[entry.name+'_series']=entry.values;
            }
          };
          if(instagram){
            // Si Meta deniega Insights (código 10), repetir la misma petición por cada métrica
            // y por cada Reel solo ralentiza la sincronización y no resuelve el permiso.
            if(insightsPermissionDenied){
              warnings.add(missingInsights);
            }else{
              const names=IG_METRICS.filter(k=>!k.startsWith('ig_reels')||v.media_product_type==='REELS');
              try { await read(names.join(',')); }
              catch(error){
                if(permissionError(error)){
                  insightsPermissionDenied=true;
                  warnings.add(missingInsights);
                }else if(historicalMediaError(error)){
                  // Meta no recupera Insights de contenido anterior a la última conversión
                  // a cuenta profesional. No es un fallo de permisos ni del token.
                  warnings.add('Reel '+v.id+': sin estadísticas históricas por API: se publicó antes de la conversión a cuenta profesional (Meta 2108006).');
                }else{
                  const failures=[];
                  for(const k of names){
                    try { await read(k); }
                    catch(metricError){
                      if(permissionError(metricError)){
                        insightsPermissionDenied=true;
                        warnings.add(missingInsights);
                        break;
                      }
                      if(historicalMediaError(metricError)){
                        warnings.add('Reel '+v.id+': sin estadísticas históricas por API: se publicó antes de la conversión a cuenta profesional (Meta 2108006).');
                        break;
                      }
                      failures.push({metric:k,message:metricError.message});
                    }
                  }
                  if(failures.length===names.length && failures.every(item=>/HTTP 400 · 100\b/.test(item.message))){
                    warnings.add('Instagram Insights: todas las métricas rechazadas (código 100). Primera respuesta: ' + failures[0].message);
                  }else{
                    for(const item of failures)warnings.add(item.metric+' · '+item.message);
                  }
                }
              }
            }
          } else {
            try {await read()} catch(error){warnings.add('Video Insights · '+error.message)}
            metrics.views=number(metrics.fb_reels_total_plays??metrics.total_video_views??metrics.post_video_views);
            metrics.shares=number(metrics.post_video_social_actions?.share??metrics.post_video_social_actions?.shares);
            if(v.length && metrics.post_video_avg_time_watched!=null)metrics.retention=metrics.post_video_avg_time_watched/(10*v.length);
            try {
              const reactions=await request(base+'/'+v.id,{token:account.accessToken,query:{fields:'likes.limit(0).summary(true),comments.limit(0).summary(true)'}});
              metrics.likes=number(reactions.likes?.summary?.total_count);
              metrics.comments=number(reactions.comments?.summary?.total_count);
            } catch(error){warnings.add('Interacciones · '+error.message)}
          }
          videos.push({externalId:String(v.id),title:v.title||v.caption||v.description||String(v.id),description:v.caption||v.description,
            publishedAt:iso(v.timestamp||v.created_time),url:v.permalink||(v.permalink_url?new URL(v.permalink_url,'https://www.facebook.com').href:null),
            duration:v.length,format:v.media_product_type||edge,metrics});
        }
        yield {videos,warning:[...warnings].join(' · ')};
      }
    }catch(error){yield {videos:[],warning:edge+' · '+error.message}}
  }
}
function catalog(request,base,network,account){
  if(network==='youtube')return youtube(request,account);
  if(network==='tiktok')return tiktok(request,account);
  return meta(request,base,network,account);
}

// Límite de YouTube Shorts y Reels: hasta 3 minutos se considera formato corto.
const SHORT_LIMIT = 180;

function seconds(duration) {
  if (typeof duration === 'number') return Number.isFinite(duration) && duration > 0 ? duration : null;
  if (typeof duration !== 'string' || !duration) return null;
  if (/^\d+(\.\d+)?$/.test(duration)) return Number(duration) || null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(duration);
  if (!match) return null;
  const [, d = 0, h = 0, m = 0, s = 0] = match;
  const total = Number(d) * 86400 + Number(h) * 3600 + Number(m) * 60 + Number(s);
  return total > 0 ? total : null;
}

/** Clasifica una publicación como 'short' (Shorts, Reels, TikTok corto) o 'long' (video largo). */
function classify(row) {
  if (row?.target?.kind === 'short') return 'short';
  if (row?.target?.kind === 'week') return 'long';
  if (/\/(shorts|reels?)\//.test(String(row?.url || ''))) return 'short';
  const format = String(row?.format || '').toLowerCase();
  if (format === 'short' || format === 'long') return format;
  if (format === 'reels' || format === 'video_reels') return 'short';
  const length = seconds(row?.duration);
  if (length != null) return length <= SHORT_LIMIT ? 'short' : 'long';
  if (format === 'feed' || format === 'videos') return 'long';
  return null;
}

module.exports={catalog,classify,seconds,SHORT_LIMIT};
