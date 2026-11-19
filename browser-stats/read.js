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
    if (network === 'instagram') return u.pathname.match(/^\/(?:[^/]+\/)?reel\/([\w-]+)/)?.[1];
    if (network === 'facebook') return u.pathname.match(/\/(?:reel|videos)\/(\d+)/)?.[1] || u.searchParams.get('video_id') || (u.pathname.startsWith('/watch') && u.searchParams.get('v'));
    return u.pathname.match(/\/(?:video|analytics(?:\/post)?)\/(\d+)(?:\/|$)/)?.[1] || u.searchParams.get('video_id');
  };
  const names = {views:['views','visualizaciones','vistas','reproducciones','video views'],likes:['likes','me gusta'],
    comments:['comments','comentarios'],shares:['shares','compartidos','veces compartido'],reach:['reach','alcance','cuentas alcanzadas'],
    saved:['saves','guardados'], impressions:['impressions','impresiones']};
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
      const n = count(raw);
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
    return {metrics, rawMetrics, publishedAt, dateText, period:period||null};
  }
  const rows = [];
  const current=videoId(location.href);
  for(const a of document.querySelectorAll('a[href]')) {
    const id=videoId(a.href); if(!id || (current && id!==current) || !a.getClientRects().length) continue;
    const row=a.closest('ytcp-video-row,tr,[role="row"],article,li,[data-e2e*="post-item"]');
    const scope=row && [...row.querySelectorAll('a[href]')].every(link=>!videoId(link.href)||videoId(link.href)===id)?row:a;
    rows.push({externalId:id,url:a.href,title:(a.title || a.innerText || a.querySelector('img')?.alt || '').trim().slice(0,500),...extract(scope,false)});
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
