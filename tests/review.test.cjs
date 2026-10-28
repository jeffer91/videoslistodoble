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
test('revisión incompleta indica qué escena corregir y no exporta',async()=>{
 const root=tmp();
 try{
  store.ensureRoot(root);
  const p=store.createProject(root,{title:'Pendiente'});
  const result=await reviews.inspect(root,'short',p.id);
  assert.equal(result.complete,false);
  assert.equal(result.chapters.length,3);
  assert.equal(result.missing.length,3);
  await assert.rejects(()=>reviews.exportApproved(root,'short',p.id,result.hash),/Primero genera/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('revisión completa usa MP4 real, es cacheable y no altera el proyecto',{timeout:180000},async()=>{
 const root=tmp();
 try{
  store.ensureRoot(root);
  const id=completeProject(root,mockVideo(root));
  const original=store.getProject(root,id);
  const initial=await reviews.inspect(root,'short',id);
  assert.equal(initial.ready,false);assert.equal(initial.complete,true);
  const ready=await reviews.prepare(root,'short',id,new AbortController().signal,()=>{});
  assert.equal(ready.ready,true);assert.equal(ready.chapters.length,3);
  assert.ok(ready.duration>2);
  const source=reviews.resolve(root,'short',id,ready.hash);
  const stat=fs.statSync(source);
  assert.ok(stat.size>1000);
  assert.ok((await media.probe(source)).hasAudio);
  assert.equal(store.getProject(root,id).status,'editing');
  assert.equal(store.getProject(root,id).exports.length,0);
  const reused=await reviews.prepare(root,'short',id,new AbortController().signal,()=>{});
  assert.equal(reused.hash,ready.hash);
  assert.equal(fs.statSync(source).mtimeMs,stat.mtimeMs);
  await assert.rejects(()=>reviews.exportApproved(root,'short',id,ready.hash),/Aprueba/);
  const p=store.getProject(root,id);
  for(const scene of Object.values(p.scenes))scene.approved=true;
  store.saveProject(root,p);
  const approved=await reviews.inspect(root,'short',id);
  assert.equal(approved.hash,ready.hash,'Aprobar no debe obligar a renderizar otra vez');
  assert.equal(approved.canExport,true);
  const result=await reviews.exportApproved(root,'short',id,ready.hash);
  assert.deepEqual(fs.readFileSync(source),fs.readFileSync(result.file),'El MP4 entregado debe ser exactamente el revisado');
  assert.equal(store.getProject(root,id).status,'exported');
  assert.equal(store.getProject(root,id).exports.length,1);
  const changed=store.getProject(root,id);
  changed.scenes.body.title='Título corregido';
  changed.scenes.body.approved=false;
  store.saveProject(root,changed);
  const after=await reviews.inspect(root,'short',id);
  assert.notEqual(after.hash,ready.hash);
  assert.equal(after.ready,false);
  await assert.rejects(()=>reviews.exportApproved(root,'short',id,ready.hash),/Actualiza/);
  assert.ok(fs.existsSync(result.file),'La versión ya exportada permanece');
  assert.deepEqual(store.getProject(root,id).scenes.hook.video,original.scenes.hook.video);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('pantalla de revisión permite regresar a escena y admite compilaciones',()=>{
 const app=fs.readFileSync(path.join(__dirname,'..','renderer','app.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'..','renderer','index.html'),'utf8');
 assert.match(app,/function reviewPage\(\)/);
 assert.match(app,/function openReview\(kind\)/);
 assert.match(app,/btn\('review-edit'/);
 assert.match(app,/review:export/);
 assert.match(app,/review-back/);
 assert.match(app,/open-week-review/);
 assert.match(app,/id="final-review-video"/);
 assert.match(html,/records:/);
});
