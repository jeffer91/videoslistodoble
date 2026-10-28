'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
process.env.RECORDS_RENDER_TEST_MODE='1';
const media=require('../backend/media.cjs'),master=require('../backend/master-audio.cjs'),store=require('../backend/store.cjs'),reviews=require('../backend/review.cjs');
function dir(){return fs.mkdtempSync(path.join(os.tmpdir(),'11r-master-'))}
function ff(file,args){
 const result=spawnSync(media.toolPath('ffmpeg'),['-hide_banner','-loglevel','error','-y',...args,file],
  {timeout:25000,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);return file;
}
test('controles globales persistentes: velocidad y selección musical protegida',()=>{
 const root=dir();
 try{
  store.ensureRoot(root);const p=store.createProject(root,{title:'Gancho musical'});
  const song=ff(path.join(root,'track.wav'),['-f','lavfi','-i','sine=frequency=220:duration=1.1','-c:a','pcm_s16le']);
  const imported=store.importAsset(root,p.id,song);
  p.master={speed:1.25,musicAssetId:imported.id,musicLevel:16};
  store.saveProject(root,p);
  const got=store.getProject(root,p.id);
  assert.deepEqual(got.master,p.master);
  assert.throws(()=>store.removeAsset(root,p.id,imported.id),/música está asignada/);
  got.master.speed=10;assert.throws(()=>store.saveProject(root,got),/Velocidad global/);
  got.master.speed=1.25;got.master.musicLevel=50;
  assert.throws(()=>store.saveProject(root,got),/Volumen musical/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('mezclar música con narración y acelerar el vídeo produce MP4 reproducible',{timeout:150000},async()=>{
 const root=dir();
 try{
  const input=ff(path.join(root,'narration.mp4'),[
   '-f','lavfi','-i','color=c=navy:s=160x160:r=15:d=2',
   '-f','lavfi','-i','sine=frequency=620:sample_rate=48000:duration=2',
   '-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest'
  ]);
  const song=ff(path.join(root,'soundtrack.wav'),[
   '-f','lavfi','-i','sine=frequency=220:sample_rate=48000:duration=0.7',
   '-c:a','pcm_s16le'
  ]);
  const output=path.join(root,'result.mp4');
  await master.render(input,output,{speed:1.5,musicLevel:18},song);
  const data=await media.probe(output);
  assert.equal(data.hasAudio,true);
  assert.ok(data.duration>1&&data.duration<1.65,'duration '+data.duration);
  assert.ok(fs.statSync(output).size>3000);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('la duración de la revisión responde a la velocidad global sin generar MP4',{timeout:60000},async()=>{
 const root=dir();
 try{
  store.ensureRoot(root);
  const input=ff(path.join(root,'narration.mp4'),[
   '-f','lavfi','-i','color=c=navy:s=160x160:r=15:d=1.5',
   '-f','lavfi','-i','sine=frequency=620:sample_rate=48000:duration=1.5',
   '-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest'
  ]);
  const p=store.createProject(root,{title:'Duración'});
  for(const key of ['hook','body','closing']){
   const a=store.importAsset(root,p.id,input);
   const fresh=store.getProject(root,p.id);fresh.scenes[key].video=a.id;
   fresh.scenes[key].start=0;fresh.scenes[key].end=1.25;store.saveProject(root,fresh);
  }
  const normal=await reviews.inspect(root,'short',p.id);
  const v=store.getProject(root,p.id);v.master={speed:2,musicAssetId:null,musicLevel:18};
  store.saveProject(root,v);
  const twice=await reviews.inspect(root,'short',p.id);
  assert.ok(Math.abs(twice.duration*2-normal.duration)<.02);
  assert.notEqual(twice.hash,normal.hash);
  assert.equal(twice.live,true);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('pantalla incluye velocidad global, música y estilos de transiciones',()=>{
 const app=fs.readFileSync(path.join(__dirname,'..','renderer','app.js'),'utf8');
 const live=fs.readFileSync(path.join(__dirname,'..','renderer','live-review.js'),'utf8');
 assert.match(app,/id="master-speed"/);
 assert.match(app,/data-master="musicAssetId"/);
 assert.match(app,/music:import/);
 assert.match(app,/transition-preset/);
 assert.match(live,/liveStartMusic/);
 assert.match(live,/review-music/);
});
