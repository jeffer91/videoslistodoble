'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
process.env.RECORDS_RENDER_TEST_MODE='1';
const store=require('../backend/store.cjs'),media=require('../backend/media.cjs'),reviews=require('../backend/review.cjs');
function tmp(){return fs.mkdtempSync(path.join(os.tmpdir(),'records-review-'))}
function mockVideo(root){
 const file=path.join(root,'narracion.mp4');
 const r=spawnSync(media.toolPath('ffmpeg'),['-hide_banner','-loglevel','error','-y',
  '-f','lavfi','-i','color=c=green:s=96x96:r=15:d=1.25',
  '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1.25',
  '-t','1.25','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',file],
  {timeout:30000,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);return file;
}
function completeProject(root,video){
 const p=store.createProject(root,{title:'Gol histórico'});
 const ids={};
 for(const key of ['hook','body','closing']){
  const asset=store.importAsset(root,p.id,video);
  ids[key]=asset.id;
 }
 const current=store.getProject(root,p.id);
 for(const key of ['hook','body','closing']){
  current.scenes[key].video=ids[key];
  current.scenes[key].start=0;current.scenes[key].end=.75;
  current.scenes[key].title='Récord de prueba';
  current.scenes[key].approved=false;
 }
 store.saveProject(root,current);
 return p.id;
}

test('revisión incompleta indica los problemas y no crea un MP4',async()=>{
 const root=tmp();
 try{
  store.ensureRoot(root);const p=store.createProject(root,{title:'Pendiente'});
  const result=await reviews.inspect(root,'short',p.id);
  assert.equal(result.live,true);
  assert.equal(result.ready,true);
  assert.equal(result.complete,false);
  assert.equal(result.chapters.length,3);
  assert.equal(result.missing.length,3);
  assert.equal(fs.existsSync(path.join(root,'Temporales','Revisiones')),false);
  await assert.rejects(()=>reviews.exportApproved(root,'short',p.id,result.hash),/Completa y aprueba/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('la revisión es instantánea y la exportación crea MP4 con audio normalizado',{timeout:180000},async()=>{
 const root=tmp();
 try{
  store.ensureRoot(root);
  const id=completeProject(root,mockVideo(root));
  const before=await reviews.inspect(root,'short',id);
  assert.equal(before.ready,true);
  assert.equal(before.live,true);
  assert.equal(before.complete,true);
  assert.equal(before.chapters.length,3);
  assert.equal(before.chapters[0].ranges.length,1);
  assert.equal(store.getProject(root,id).status,'editing');
  assert.equal(store.getProject(root,id).exports.length,0);
  assert.equal(fs.existsSync(path.join(root,'Temporales','Revisiones')),false);
  await assert.rejects(()=>reviews.exportApproved(root,'short',id,before.hash),/aprueba/i);
  const p=store.getProject(root,id);
  for(const scene of Object.values(p.scenes))scene.approved=true;
  store.saveProject(root,p);
  const approved=await reviews.inspect(root,'short',id);
  assert.equal(approved.hash,before.hash,'Aprobar no cambia el montaje');
  assert.equal(approved.canExport,true);
  const result=await reviews.exportApproved(root,'short',id,approved.hash,new AbortController().signal,()=>{});
  assert.ok(fs.existsSync(result.file));
  const info=await media.probe(result.file);
  assert.equal(info.hasAudio,true);
  assert.ok(info.duration>1.5);
  assert.equal(store.getProject(root,id).status,'exported');
  assert.equal(store.getProject(root,id).exports.length,1);
  const changed=store.getProject(root,id);
  changed.scenes.body.title='Título corregido';
  changed.scenes.body.playbackSpeed=1.25;
  changed.scenes.body.approved=false;
  store.saveProject(root,changed);
  const after=await reviews.inspect(root,'short',id);
  assert.notEqual(after.hash,before.hash);
  assert.ok(after.duration<approved.duration);
  await assert.rejects(()=>reviews.exportApproved(root,'short',id,before.hash),/cambió/);
  assert.ok(fs.existsSync(result.file),'La exportación anterior debe conservarse');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('historial permanente de cortes y marco de cámara son válidos',()=>{
 const root=tmp();
 try{
  store.ensureRoot(root);const p=store.createProject(root,{title:'Recortes'});
  p.scenes.hook.cutHistory={undo:['[]'],redo:[]};
  p.scenes.hook.formats.short.frame='gold';
  p.scenes.hook.playbackSpeed=.75;
  p.transitions={hookBody:'wipeleft',bodyClosing:'circleopen',duration:.3};
  store.saveProject(root,p);
  const result=store.getProject(root,p.id);
  assert.equal(result.scenes.hook.cutHistory.undo[0],'[]');
  assert.equal(result.scenes.hook.formats.short.frame,'gold');
  assert.equal(result.scenes.hook.playbackSpeed,.75);
  assert.equal(result.transitions.hookBody,'wipeleft');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('revisión dinámica usa una sola línea de tiempo y permite corrección',()=>{
 const folder=path.join(__dirname,'..','renderer');
 const app=fs.readFileSync(path.join(folder,'app.js'),'utf8');
 const player=fs.readFileSync(path.join(folder,'live-review.js'),'utf8');
 const html=fs.readFileSync(path.join(folder,'index.html'),'utf8');
 assert.match(app,/function reviewPage\(\)/);
 assert.match(app,/btn\('review-edit'/);
 assert.match(app,/livePrepare\(\)/);
 assert.match(app,/cutHistory/);
 assert.match(app,/playbackSpeed/);
 assert.match(app,/data-format-field="frame"/);
 assert.match(player,/function liveStageHTML/);
 assert.match(player,/function liveSeek/);
 assert.match(player,/id="final-review-video"/);
 assert.match(html,/live-review\.js/);
});
