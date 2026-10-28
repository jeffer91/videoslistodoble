'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const sharp=require('sharp');
const {spawnSync}=require('node:child_process');
process.env.RECORDS_RENDER_TEST_MODE='1';
const director=require('../renderer/visual-director.js');
const store=require('../backend/store.cjs');
const media=require('../backend/media.cjs');
const reviews=require('../backend/review.cjs');
function createRoot(){return fs.mkdtempSync(path.join(os.tmpdir(),'11r-smartmotion-'))}
test('el director produce resultados estables y diferentes al regenerar',()=>{
 const segments=[
  {start:0,end:3,assetId:'photo-a',type:'image'},
  {start:3,end:6,assetId:'photo-b',type:'image'},
  {start:6,end:9,assetId:'photo-c',type:'image'},
  {start:9,end:12,assetId:'clip',type:'video'}
 ];
 const args={projectId:'p01',sceneKey:'body',segments,duration:12,
  settings:{enabled:true,revision:0}};
 const a=director.sequence(args),b=director.sequence(args);
 assert.deepEqual(a,b);
 assert.equal(a.items.length,4);
 assert.ok(a.background.a>=1&&a.background.b>=1);
 assert.notEqual(a.items[0].mode,a.items[1].mode);
 assert.notEqual(a.items[1].mode,a.items[2].mode);
 assert.equal(a.items[3].motion,null,'no se sobreanima una jugada en movimiento');
 const at=director.at(a,3.5,'photo-b');
 assert.equal(at.assetId,'photo-b');
 const no=director.sequence({...args,settings:{enabled:false,revision:0}});
 assert.equal(no.background,null);
 assert.ok(no.items.every(x=>x.motion===null&&x.effect==='cut'));
 const variation=director.sequence({...args,settings:{enabled:true,revision:1}});
 assert.notDeepEqual(a,variation);
});
test('interpolación suave y transiciones automáticas no cambian al reproducir',()=>{
 const m=director.sequence({projectId:'x',sceneKey:'hook',duration:8,segments:[]}).background;
 const start=director.interpolate(m,0),middle=director.interpolate(m,.5),end=director.interpolate(m,1);
 assert.equal(start.scale,m.a);assert.equal(end.scale,m.b);
 assert.ok(middle.scale>=Math.min(start.scale,end.scale));
 const x=director.transitions({projectId:'x',revision:2,chapters:[{duration:5},{duration:30},{duration:9}]});
 assert.ok(['smoothleft','zoomin','hblur','diagtl','fade'].includes(x.hookBody));
 assert.notEqual(x.hookBody,x.bodyClosing);
 assert.deepEqual(x,director.transitions({projectId:'x',revision:2,chapters:[{duration:5},{duration:30},{duration:9}]}));
});
test('los cambios de dirección visual se guardan en el proyecto',()=>{
 const root=createRoot();
 try{
  store.ensureRoot(root);const p=store.createProject(root,{title:'Gol'});
  assert.equal(p.effects.enabled,true);
  p.effects.revision=3;store.saveProject(root,p);
  const fresh=store.getProject(root,p.id);
  assert.equal(fresh.effects.revision,3);
  fresh.effects.sceneTransitionsAuto=false;store.saveProject(root,fresh);
  assert.equal(store.getProject(root,p.id).effects.sceneTransitionsAuto,false);
  fresh.effects.revision=-1;assert.throws(()=>store.saveProject(root,fresh),/animación automática inválida/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('FFmpeg renderiza movimiento en fondo y fotografía sin crear MP4 de revisión',{timeout:150000},async()=>{
 const root=createRoot();
 try{
  store.ensureRoot(root);
  const v=path.join(root,'voice.mp4'),audio=spawnSync(media.toolPath('ffmpeg'),
   ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=120x120:r=15:d=1.2',
    '-f','lavfi','-i','sine=frequency=410:duration=1.2','-c:v','libx264','-pix_fmt','yuv420p',
    '-c:a','aac','-shortest',v],{encoding:'utf8',timeout:30000});
  assert.equal(audio.status,0,audio.stderr);
  const picture=path.join(root,'photo.png'),back=path.join(root,'back.png');
  await sharp({create:{width:300,height:370,channels:3,background:'#d8b45b'}}).png().toFile(picture);
  await sharp({create:{width:540,height:960,channels:3,background:'#234953'}}).png().toFile(back);
  const original=store.createProject(root,{title:'Movimiento'});
  const video=store.importAsset(root,original.id,v),photo=store.importAsset(root,original.id,picture),
   background=store.importAsset(root,original.id,back);
  const p=store.getProject(root,original.id);
  p.scenes.body.video=video.id;
  p.scenes.body.start=0;p.scenes.body.end=1.05;
  p.scenes.body.media=[{assetId:photo.id,start:0,end:0,speed:1}];
  p.scenes.body.backgrounds.short={scope:'project',assetId:background.id};
  store.saveProject(root,p);
  const status=await reviews.inspect(root,'short',p.id);
  assert.equal(status.ready,true);
  const plan=status.chapters.find(c=>c.scene==='body').motion;
  assert.equal(plan.items[0].assetId,photo.id);
  assert.ok(plan.items[0].motion);
  assert.ok(plan.background);
  const folder=media.temporary(root);
  try{
   const rendered=await media.compileScene(root,store.getProject(root,p.id),'body',false,folder,
    new AbortController().signal,()=>{},null);
   assert.ok(rendered.segments.length);
   const info=await media.probe(rendered.segments[0]);
   assert.ok(info.duration>.2,info.duration);
   assert.equal(info.hasAudio,true);
  }finally{fs.rmSync(folder,{recursive:true,force:true})}
  assert.equal(fs.existsSync(path.join(root,'Temporales','Revisiones')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('la misma planificación visual llega a editor, vista previa y exportación',()=>{
 const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
 assert.match(read('renderer/index.html'),/visual-director\.js/);
 assert.match(read('renderer/live-review.js'),/VisualDirector\.interpolate/);
 assert.match(read('renderer/live-review.js'),/liveTriggerPhotoEffect/);
 assert.match(read('backend/review.cjs'),/visualDirector\.sequence/);
 assert.match(read('backend/media.cjs'),/visualDirector\.sequence/);
 assert.match(read('backend/media.cjs'),/zoompan=z=/);
 assert.match(read('renderer/app.js'),/effects-regenerate/);
});
