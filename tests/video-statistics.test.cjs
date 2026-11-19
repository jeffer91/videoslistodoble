'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {catalog}=require('../backend/video-statistics.cjs'),{createPublishing}=require('../backend/publishing.cjs'),store=require('../backend/store.cjs');
async function collect(network,request,provider='direct'){
 const rows=[];
 for await(const page of catalog(request,'https://graph.example',network,{identity:{id:'42'},provider}))rows.push(page);
 return rows;
}
test('TikTok sigue el cursor incluso si una página está vacía y mantiene las fechas y los ceros',async()=>{
 const pages=await collect('tiktok',async(_,opts)=>({data:opts.json.cursor?{videos:[{id:'8',create_time:1700000000,share_count:0}],has_more:false}:{videos:[],cursor:12,has_more:true}}));
 assert.equal(pages[1].videos[0].metrics.shares,0);assert.equal(pages[1].videos[0].metrics.views,null);
 assert.equal(pages[1].videos[0].publishedAt,'2023-11-14T22:13:20.000Z');
});
test('YouTube enumera las subidas y conserva los contadores aunque Analytics falle',async()=>{
 const pages=await collect('youtube',async(url,opts)=>{
  if(url.endsWith('/channels'))return {items:[{contentDetails:{relatedPlaylists:{uploads:'UU1'}}}]};
  if(url.endsWith('/playlistItems'))return {items:[{contentDetails:{videoId:'abc'}}]};
  if(url.endsWith('/videos'))return {items:[{id:'abc',snippet:{title:'Fuera de Studio',publishedAt:'2020-01-01'},contentDetails:{duration:'PT1M'},statistics:{viewCount:'12'}}]};
  throw Error('Acceso denegado');
 });assert.equal(pages[0].videos[0].metrics.views,12);assert.match(pages[0].warning,/Analytics/);
});
test('Meta omite fotos en Instagram y elimina duplicados entre videos y Reels de Facebook',async()=>{
 const get=async(url)=>url.endsWith('/media')?{data:[{id:'1',media_type:'IMAGE'},{id:'2',media_type:'VIDEO'}]}:
 url.endsWith('/videos')||url.endsWith('/video_reels')?{data:[{id:'2',created_time:'2020-01-01'}]}:{data:[{name:'total_video_views',values:[{value:5}]}]};
 assert.deepEqual((await collect('instagram',get)).flatMap(p=>p.videos.map(v=>v.externalId)),['2']);
 const rows=(await collect('facebook',get)).flatMap(p=>p.videos);assert.equal(rows.length,1);assert.equal(rows[0].metrics.views,5);
});
test('Ayrshare conserva estadísticas de videos publicados fuera de Studio',async()=>{
 const pages=await collect('tiktok',async()=>({posts:[{id:'123',created:'2025-01-01',videoViews:42,reach:32}],meta:{pagination:{hasMore:false}}}),'ayrshare');
 assert.equal(pages[0].videos[0].metrics.reach,32);
});
test('dos sincronizaciones conservan un solo video con dos mediciones y exportación fechada',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stats-'));
 try{
 store.ensureRoot(root);const vault={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()};
 const platform={verifyAccount:async()=>({id:'p1',label:'Página'}),async *catalogPages(){yield {videos:[{externalId:'123',publishedAt:'2020-01-01',title:'Antes de Studio',metrics:{views:12}}]}}};
 const p=createPublishing(root,vault,platform);await p.connect('facebook',{profileId:'42',accessToken:'test'});
 await p.refreshStats();await p.refreshStats();const data=JSON.parse(fs.readFileSync(p.exportStats()));assert.equal(data.videos.length,1);
 assert.equal(data.videos[0].history.length,2);assert.ok(data.videos[0].history[0].at);assert.equal(data.videos[0].publishedAt,'2020-01-01');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('API y navegador comparten el Reel, conservan fecha, ceros e historial por origen',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'browser-stats-'));
 try {
   store.ensureRoot(root);
   const vault={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()};
   const reel={externalId:'991',url:'https://www.instagram.com/reel/abc/',title:'Récord',publishedAt:'2024-01-01',metrics:{views:13,reach:null}};
   const p=createPublishing(root,vault,{verifyAccount:async()=>({id:'p1',label:'Perfil'}),async *catalogPages(){yield {videos:[reel]}}});
   const visible={externalId:'abc',url:reel.url,metrics:{reach:7,likes:0}};
   p.browserReading('instagram',visible);
   await p.connect('instagram',{accessToken:'test'});
   await p.refreshStats();
   p.browserReading('instagram',visible);
   const rows=p.stats();
   assert.equal(rows.length,1);
   assert.equal(rows[0].externalId,'991');
   assert.equal(rows[0].publishedAt,'2024-01-01');
   assert.deepEqual(rows[0].metrics,{views:13,reach:7,likes:0});
   assert.deepEqual(rows[0].history.map(h=>h.source),['navegador','red','navegador']);
   assert.equal(rows[0].metricOrigins.views.source,'red');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
