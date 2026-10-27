'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {retainedRanges,selectedDuration,timeline}=require('../backend/media.cjs');
test('silencios se eliminan solo si están marcados en rojo',()=>{
 const scene={start:1,end:10,silences:[
  {start:2,end:3,remove:true},
  {start:4,end:4.5,remove:false},
  {start:7,end:8,remove:true}
 ]};
 const ranges=retainedRanges(scene,12);
 assert.deepEqual(ranges,[{start:1,end:2},{start:3,end:7},{start:8,end:10}]);
 assert.equal(selectedDuration(scene,12),7);
});
test('recursos se distribuyen sin perder tramo de narración',()=>{
 const scene={start:0,end:10,silences:[],media:[]};
 const pieces=timeline(scene,10,[{type:'image',id:'1'},{type:'image',id:'2'}]);
 assert.equal(Math.round(pieces.reduce((n,p)=>n+p.end-p.start,0)),10);
 assert.equal(pieces[0].medium.id,'1');
 assert.equal(pieces.at(-1).medium.id,'2');
});

test('recortar imagen y audio reduce duración sin modificar el origen',()=>{
 const scene={start:0,end:8,silences:[],cuts:[{start:0,end:.8,mode:'both'},{start:3,end:4,mode:'both'}]};
 assert.deepEqual(retainedRanges(scene,8),[{start:.8,end:3},{start:4,end:8}]);
 assert.ok(Math.abs(selectedDuration(scene,8)-6.2)<.00001);
});
test('silenciar sólo sonido y congelar sólo imagen mantienen la duración',()=>{
 const {splitByEdits}=require('../backend/media.cjs');
 const scene={start:0,end:6,silences:[],cuts:[
  {start:1,end:2,mode:'audio'},{start:3,end:4.5,mode:'video'}
 ]};
 const pieces=splitByEdits(timeline(scene,6,[{type:'video',speed:1,sourceStart:0,sourceEnd:6}]),scene.cuts);
 assert.ok(Math.abs(pieces.reduce((sum,p)=>sum+p.end-p.start,0)-6)<.0001);
 assert.deepEqual(pieces.filter(p=>p.muteAudio).map(p=>[p.start,p.end]),[[1,2]]);
 const frozenPieces=pieces.filter(p=>p.freezeVideo);
 assert.equal(frozenPieces[0].start,3);
 assert.equal(frozenPieces.at(-1).end,4.5);
 assert.ok(Math.abs(frozenPieces.reduce((sum,p)=>sum+p.end-p.start,0)-1.5)<.0001);
 const originalMediaStarts=pieces.map(p=>p.mediaStart);
 assert.ok(originalMediaStarts.every(x=>typeof x==='number'&&Number.isFinite(x)));
});
test('se unen cortes superpuestos y silencios heredados',()=>{
 const scene={start:0,end:6,silences:[{start:.3,end:.6,remove:true}],cuts:[
  {start:.4,end:1.2,mode:'both'},{start:1,end:1.4,mode:'both'}]};
 assert.deepEqual(retainedRanges(scene,6),[{start:0,end:.3},{start:1.4,end:6}]);
});

test('WebM de MediaRecorder sin duración en cabecera recupera duración y ondas',{timeout:60000},async()=>{
 const {probe,waveform,toolPath}=require('../backend/media.cjs');
 const {spawnSync}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'records-webm-live-')),file=path.join(dir,'captura.webm');
 try{
  const args=['-hide_banner','-loglevel','error',
   '-f','lavfi','-i','color=c=black:s=64x64:r=12:d=1.5',
   '-f','lavfi','-i','sine=frequency=600:sample_rate=48000:duration=1.5',
   '-t','1.5','-c:v','libvpx','-b:v','160k','-c:a','libopus',
   '-live','1','-f','webm','pipe:1'];
  const generated=spawnSync(toolPath('ffmpeg'),args,{timeout:25000,maxBuffer:10*1024*1024});
  assert.equal(generated.status,0,String(generated.stderr));
  fs.writeFileSync(file,generated.stdout);
  const info=await probe(file);
  assert.ok(info.duration>1.3&&info.duration<1.7,'duración recuperada: '+info.duration);
  assert.equal(info.hasAudio,true);
  const peaks=await waveform(file);
  assert.ok(peaks.length>10,'onda ausente');
 }finally{fs.rmSync(dir,{force:true,recursive:true})}
});

test('Reproducir no detiene un video aunque sus metadatos indiquen 0 segundos',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'..','renderer','app.js'),'utf8');
 const begin=source.indexOf('function updatePreviewEdits(){');
 const end=source.indexOf("document.addEventListener('timeupdate'",begin);
 assert.ok(begin>=0&&end>begin,'No se encontró el controlador de vista previa');
 let played=0,paused=0;
 const video={currentTime:0,paused:true,muted:false,style:{},
  play(){played++;this.paused=false;return Promise.resolve()},
  pause(){paused++;this.paused=true}};
 const sandbox={
  $:selector=>selector==='#speaker-preview'?video:null,
  state:{project:{scenes:{hook:{start:0,end:0,cuts:[],silences:[]}}},scene:'hook',playSelectionOnly:false},
  editorDuration:()=>0,rangeSelection:()=>({start:0,end:1}),notice:msg=>{throw Error(msg)}
 };
 vm.runInNewContext(source.slice(begin,end)+'\nplayback(false);',sandbox);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(played,1,'El botón debe llamar a play()');
 assert.equal(paused,0,'Duración 0 no debe interpretarse como final de video');
});
