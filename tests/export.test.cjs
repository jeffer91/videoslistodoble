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
  store.saveProject(root,fresh);
  const output=await media.exportShort(root,p.id,new AbortController().signal,()=>{});
  assert.ok(fs.statSync(output.file).size>1000);
  const info=await media.probe(output.file);
  assert.ok(info.duration>.6&&info.duration<3,'duración inesperada '+info.duration);
  assert.ok(info.hasAudio);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});