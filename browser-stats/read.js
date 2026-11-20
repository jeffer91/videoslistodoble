// Runs on the selected platform. Only collect measurements tied to a video.
(options) => {
  const {network, openedId} = typeof options === "string" ? {network:options} : options;
  const domains = {youtube:'youtube.com',instagram:'instagram.com',facebook:'facebook.com',tiktok:'tiktok.com'};
  const belongs = host => host === domains[network] || host.endsWith('.' + domains[network]);
  const videoId = href => {
    if (!href) return null;
    const u = new URL(href, location.href);
    if (!belongs(u.hostname) || u.protocol !== 'https:') return null;
    if (network === 'youtube') return u.pathname.match(/^\/(?:video|shorts)\/([\w-]{11})(?:\/|$)/)?.[1] || (u.pathname === '/watch' && u.searchParams.get('v'));
    if (network === 'instagram') return u.pathname.match(/^\/(?:[^/]+\/)?reels?\/([\w-]+)/)?.[1];
    if (network === 'facebook') return u.pathname.match(/\/(?:reel|videos)\/(\d+)/)?.[1] || u.searchParams.get('video_id') || (u.pathname.startsWith('/watch') && u.searchParams.get('v'));
    return u.pathname.match(/\/(?:video|analytics(?:\/post)?)\/(\d+)(?:\/|$)/)?.[1] || u.searchParams.get('video_id');
  };
  // Diccionario común: cada red llama distinto a la misma métrica.
  const names = {views:['views','visualizaciones','vistas','reproducciones','video views','plays','visualizaciones del video','reproducciones del video'],
    likes:['likes','me gusta','reacciones','reactions'],
    comments:['comments','comentarios'],shares:['shares','compartidos','veces compartido','veces que se compartió','compartidas'],
    reach:['reach','alcance','cuentas alcanzadas','accounts reached','espectadores únicos'],
    saved:['saves','saved','guardados','favoritos','favorites','veces guardado'], impressions:['impressions','impresiones'],
    newFollowers:['nuevos seguidores','new followers','seguidores nuevos','seguidores obtenidos','follows','seguimientos'],
    averageWatchTime:['tiempo medio de visualización','tiempo de visualización promedio','tiempo promedio de visualización','average watch time',
      'tiempo medio de reproducción','tiempo de reproducción promedio','tiempo promedio de reproducción','duración media de las visualizaciones','average view duration'],
    totalWatchTime:['tiempo total de visualización','total play time','total watch time','tiempo de reproducción total','tiempo total de reproducción',
      'tiempo de visualización (horas)','watch time (hours)','tiempo de visualización'],
    retention:['porcentaje medio visto','average percentage viewed','porcentaje promedio visto'],
    completionRate:['vieron el video completo','watched full video','porcentaje que vio el video completo','vio el video completo'],
  };
  const TIME_KEYS = new Set(['averageWatchTime','totalWatchTime']), PERCENT_KEYS = new Set(['retention','completionRate']);
  // «1:02», «1 min 5 s», «12,3 s», «1 h 2 min» → segundos.
  function seconds(raw) {
    const text = raw.trim().toLowerCase().replace(',', '.');
    const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (clock) return (+clock[1] || 0) * 3600 + +clock[2] * 60 + +clock[3];
    let total = 0, found = false;
    for (const [, n, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hora|horas|min|m|minutos?|s|seg|segundos?)\b/g)) {
      found = true;
      total += Number(n) * (/^h/.test(unit) ? 3600 : /^m/.test(unit) ? 60 : 1);
    }
    return found ? Math.round(total * 10) / 10 : null;
  }
  function percent(raw) {
    const match = raw.trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*%$/);
    return match ? Number(match[1]) : null;
  }
  const spanish = document.documentElement.lang.toLowerCase().startsWith('es');
  function count(raw) {
    const m = raw.trim().toLowerCase().match(/^(\d[\d.,\s]*?)\s*(mil|mill\.?|[km])?$/i);
    if (!m) return null;
    let value = m[1].replace(/\s/g,'');
    if (m[2]) value = value.replace(',','.');
    else if (/^\d{1,3}([.,]\d{3})+$/.test(value)) value = value.replace(/[.,]/g,'');
    else if (/[.,]/.test(value)) return null;
    const n = Number(value) * ({k:1000,mil:1000,m:1e6,mill:1e6,'mill.':1e6}[m[2]] || 1);
    return Number.isSafeInteger(Math.round(n)) ? Math.round(n) : null;
  }
  function extract(scope, detail) {
    const metrics = {}, rawMetrics = {};
    const put = (key, raw) => {
      const n = TIME_KEYS.has(key) ? seconds(raw) : PERCENT_KEYS.has(key) ? percent(raw) : count(raw);
      if (n !== null) { metrics[key] = n; rawMetrics[key] = raw.trim(); }
    };
    const fragments = [scope.innerText, ...Array.from(scope.querySelectorAll('[aria-label],[title]'),x=>x.getAttribute('aria-label')||x.title)];
    const table=scope.closest('table,[role="table"],[role="grid"]');
    const headers=table ? [...table.querySelectorAll('th,[role="columnheader"]')].map(h=>h.innerText.trim().toLowerCase()) : [];
    const cells=scope.querySelectorAll('td,[role="cell"],[role="gridcell"]');
    for (const [key, labels] of Object.entries(names)) {
      const columnIndex=headers.findIndex(h=>labels.includes(h));
      if(cells[columnIndex]) put(key,cells[columnIndex].innerText);
      const column = scope.querySelector('#'+key+' .cell-content, .tablecell-'+key+', [data-e2e="'+key+'-count"], [data-e2e="video-'+(key==='likes'?'digg':key.replace(/s$/,''))+'-count"]');
      if (column) put(key,column.innerText);
      for (const fragment of fragments) {
        const lines = (fragment || '').trim().split(/\n/).map(s=>s.trim().toLowerCase());
        for (let i=0;i<lines.length;i++) for (const label of labels) {
          if (lines[i]===label && lines[i+1]) put(key,lines[i+1]);
          for (const pattern of [new RegExp('^'+label+'[: ]+(.+)$'),new RegExp('^(.+?)\\s+'+label+'$')]) {
            const match=lines[i].match(pattern); if(match) put(key,match[1]);
          }
        }
      }
    }
    for (const block of scope.querySelectorAll('yta-key-metric-block,[data-e2e*="metric-card"],[data-testid*="metric-card"]')) {
      const lines=block.innerText.trim().split('\n').map(x=>x.trim()).filter(Boolean);
      if(lines.length>=2 && lines[0].length<90 && /\d/.test(lines[1])) {
        const label=lines[0];
        if(!Object.values(names).some(labels=>labels.includes(label.toLowerCase()))) {
          const key='panel · '+label;
          metrics[key]=lines[1];rawMetrics[key]=lines[1];
        }
      }
    }
    // Duración visible sobre la miniatura (TikTok, Facebook): «0:45», «12:03».
    let duration=null;
    // Solo en el listado: en la ficha de estadísticas los tiempos son métricas, no la duración.
    if (!detail) for (const node of scope.querySelectorAll('span,div')) {
      if (node.children.length) continue;
      const text=(node.textContent||'').trim();
      if (/^(?:\d+:)?\d{1,2}:\d{2}$/.test(text)) { duration=seconds(text); break; }
    }
    const time=scope.querySelector('time[datetime]');
    const dateText=time?.dateTime || scope.querySelector('.tablecell-date')?.innerText.split('\n')[0];
    let publishedAt=null;
    if(dateText && (/^\d{4}-\d\d-\d\d/.test(dateText) || !spanish && /[A-Za-z]{3,}/.test(dateText)) && Number.isFinite(Date.parse(dateText))) publishedAt=new Date(dateText).toISOString();
    if (!publishedAt && dateText && spanish) {
      const match=dateText.toLowerCase().match(/^(\d{1,2})[ \/-]+(?:de )?([a-záé]+|\d{1,2})\.?[ \/-]+(?:de )?(\d{4})$/);
      if(match){
        const month=Number(match[2])||1+['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'].indexOf(match[2].slice(0,3));
        if(month>=1 && month<=12 && Number(match[1])<=31) publishedAt=new Date(+match[3],month-1,+match[1],12).toISOString();
      }
    }
    const period = detail && scope.querySelector('[id*="date-range"],[data-e2e*="date-range"]')?.innerText;
    return {metrics, rawMetrics, publishedAt, dateText, period:period||null, ...(duration?{duration}:{})};
  }
  const rows = [];
  const current=videoId(location.href);
  for(const a of document.querySelectorAll('a[href]')) {
    const id=videoId(a.href); if(!id || (current && id!==current) || !a.getClientRects().length) continue;
    const row=a.closest('ytcp-video-row,tr,[role="row"],article,li,[data-e2e*="post-item"]');
    const scope=row && [...row.querySelectorAll('a[href]')].every(link=>!videoId(link.href)||videoId(link.href)===id)?row:a;
    const analytics=[...scope.querySelectorAll?.('a[href*="/analytics"]')||[]].map(link=>link.href).find(href=>videoId(href)===id);
    rows.push({externalId:id,url:a.href,title:(a.title || a.innerText || a.querySelector('img')?.alt || '').trim().slice(0,500),
      ...(analytics?{analyticsUrl:analytics}:{}),...extract(scope,false)});
  }
  const insightView=openedId && belongs(location.hostname) && (location.pathname.includes('/insights/') || document.querySelector('[role="dialog"]'));
  const id=videoId(location.href) || (insightView && openedId);
  // Restrict detail data to the specific publication, excluding recommendations.
  const overlay=insightView && (document.querySelector('[role="dialog"]') || document.querySelector('main,[role="main"]'));
  const detail=overlay || document.querySelector('yta-screen,ytcp-analytics-section,ytcd-video-analytics,[data-e2e="browse-video-desc"] article,[data-e2e="browse-video"]:has([data-e2e="like-count"]), [data-e2e="video-analytics"],main article, [role="dialog"] article, [role="main"] [role="article"]');
  if(id && detail && [...detail.querySelectorAll('a[href]')].every(a=>!videoId(a.href)||videoId(a.href)===id))
    rows.push({externalId:id,url:location.href,title:detail.querySelector('h1')?.innerText||'',...extract(detail,true),detail:true});
  return rows;
}
