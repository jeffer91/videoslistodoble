'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{spawnSync}=require('node:child_process');
process.env.RECORDS_RENDER_TEST_MODE='1';
const store=require('../backend/store.cjs'),media=require('../backend/media.cjs');
test('prueba integral: FFmpeg genera un Short MP4 real, con título, audio y logo', {timeout:180000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'records-smoke-'));
 try{
  store.ensureRoot(root);
  const video=path.join(root,'voz.mp4');
  const args=['-y','-loglevel','error','-f','lavfi','-i','testsrc=size=320x240:rate=30:duration=0.8',
    '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.8',
    '-t','0.8','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',video];
  const make=spawnSync(media.toolPath('ffmpeg'),args,{encoding:'utf8',timeout:30000});
  assert.equal(make.status,0,make.stderr);
  const p=store.createProject(root,{title:'Un récord de prueba'});
  for(const key of ['hook','body','closing']){
    const a=store.importAsset(root,p.id,video);
    p.assets.push(a);
    p.scenes[key].video=a.id;
    p.scenes[key].start=0;
    p.scenes[key].end=0.6;
    p.scenes[key].approved=true;
    p.scenes[key].title='PRUEBA DE FUTBOL';
  }
  // Los assets fueron copiados directamente por importAsset; conservar el array de disco.
  const fresh=store.getProject(root,p.id);
  for(const key of ['hook','body','closing']){
    fresh.scenes[key]=p.scenes[key];
  }
  fresh.scenes.closing.closingStamp={assetId:fresh.scenes.closing.video,at:0.2};
  store.saveProject(root,fresh);
  const output=await media.exportShort(root,p.id,new AbortController().signal,e=>console.error('[render]',JSON.stringify(e)));
  assert.ok(fs.statSync(output.file).size>1000);
  const info=await media.probe(output.file);
  assert.ok(info.duration>.6&&info.duration<3,'duración inesperada '+info.duration);
  assert.ok(info.hasAudio);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('sello: el primer fotograma y el golpe se alinean tras recortar y acelerar',async()=>{
 const {overlayScene}=require('../backend/editing.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'records-stamp-'));
 try{
  const input=path.join(dir,'original.mp4'),ff=media.toolPath('ffmpeg');
  function ffmpeg(args){
   const result=spawnSync(ff,['-loglevel','error',...args],{maxBuffer:8*1024*1024});
   assert.equal(result.status,0,String(result.stderr));
   return result.stdout;
  }
  ffmpeg(['-f','lavfi','-i','color=black:s=320x180:r=30:d=1.5','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1.5','-c:v','libx264','-c:a','aac',input]);
  const ranges=[{start:1,end:2},{start:3,end:5}],scene={closingStamp:{at:3.5}};
  const output=await overlayScene(dir,dir,{},scene,[input],ranges,2,new AbortController().signal);
  const file=output.segments[0];
  // (1 segundo conservado + 0,5 del segundo tramo) / 2 = 0,75 s.
  const frames=ffmpeg(['-i',file,'-vf','scale=80:44,format=gray','-f','rawvideo','-an','pipe:1']);
  const bright=frame=>frames.subarray(frame*3520,(frame+1)*3520).some(v=>v>100);
  assert.equal(bright(21),false);
  assert.equal(bright(23),true);
  assert.equal(bright(40),false);
  const pcm=ffmpeg(['-i',file,'-vn','-ac','1','-ar','48000','-f','s16le','pipe:1']);
  let onset=0;
  while(onset*2+1<pcm.length && Math.abs(pcm.readInt16LE(onset*2))<1000)onset++;
  assert.ok(Math.abs(onset/48000-.75)<.03,'golpe fuera de tiempo: '+onset/48000);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
