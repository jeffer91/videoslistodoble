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

test('Reproducir usa la copia compatible y no detiene videos con duración cero',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'..','renderer','app.js'),'utf8');
 const begin=source.indexOf('function updatePreviewEdits(){');
 const end=source.indexOf("document.addEventListener('timeupdate'",begin);
 assert.ok(begin>=0&&end>begin,'Controlador de vista previa ausente');
 let played=0,paused=0;
 const video={dataset:{asset:'recording'},currentTime:0,readyState:1,paused:true,muted:false,style:{},
  getAttribute:()=> 'records://preview/project/recording',
  play(){played++;this.paused=false;return Promise.resolve()},
  pause(){paused++;this.paused=true}};
 const sandbox={
  $:selector=>selector==='#speaker-preview'?video:null,
  state:{project:{id:'project',scenes:{hook:{video:'recording',start:0,end:0,cuts:[],silences:[]}}},page:'project',scene:'hook',
   previewUrls:{'project:recording':'records://preview/project/recording'},previewTimelines:{'project:hook':[]},playSelectionOnly:false},
  editorDuration:()=>0,rangeSelection:()=>({start:0,end:1}),previewAssetKey:(p,a)=>p+':'+a,mediaKey:()=> 'project:hook',
  updateMediaPreview:()=>{},previewMessage:()=>{},notice:msg=>{throw Error(msg)}
 };
 vm.runInNewContext(source.slice(begin,end)+'\nplayback(false);',sandbox);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(played,1);
 assert.equal(paused,0);
});
test('normaliza un WebM antiguo a MP4 H.264 y conserva el original',{timeout:80000},async()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
 const store=require('../backend/store.cjs'),media=require('../backend/media.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'records-preview-'));
 try{
  store.ensureRoot(dir);const project=store.createProject(dir,{title:'Reproducción'});
  const source=path.join(dir,'original.webm');
  const r=spawnSync(media.toolPath('ffmpeg'),['-hide_banner','-loglevel','error','-y',
   '-f','lavfi','-i','testsrc=size=128x128:rate=12:duration=2',
   '-f','lavfi','-i','sine=frequency=400:sample_rate=48000:duration=2',
   '-t','2','-c:v','libvpx','-b:v','180k','-c:a','libopus',source],{timeout:35000});
  assert.equal(r.status,0,String(r.stderr));
  const asset=store.importAsset(dir,project.id,source);
  const oldSize=fs.statSync(store.resolveAsset(dir,project.id,asset.id)).size;
  const result=await media.preparePreview(dir,project.id,asset.id);
  assert.match(result.url,/^records:\/\/preview\//);
  assert.ok(result.duration>1.8);
  const normalized=media.resolvePreview(dir,project.id,asset.id);
  assert.equal(path.extname(normalized),'.mp4');
  assert.equal(fs.statSync(store.resolveAsset(dir,project.id,asset.id)).size,oldSize);
  const meta=spawnSync(media.toolPath('ffprobe'),['-v','error','-select_streams','v:0','-show_entries','stream=codec_name','-of','default=noprint_wrappers=1',normalized]);
  assert.match(String(meta.stdout),/codec_name=h264/);
  const cached=await media.preparePreview(dir,project.id,asset.id);
  assert.equal(cached.url,result.url);
 }finally{fs.rmSync(dir,{force:true,recursive:true})}
});
test('previsualización distribuye tres imágenes según la narración',{timeout:45000},async()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
 const store=require('../backend/store.cjs'),media=require('../backend/media.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'records-image-sequence-'));
 try{
  store.ensureRoot(root);const project=store.createProject(root,{title:'Tres imágenes'});
  const recording=path.join(root,'voice.webm');
  const r=spawnSync(media.toolPath('ffmpeg'),['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=black:s=96x96:d=3:r=15',
   '-f','lavfi','-i','sine=frequency=600:duration=3','-t','3','-c:v','libvpx','-b:v','150k','-c:a','libopus',recording],{timeout:30000});
  assert.equal(r.status,0,String(r.stderr));
  const voice=store.importAsset(root,project.id,recording);
  const sharp=require('sharp');
  const scene=project.scenes.body;scene.video=voice.id;scene.end=3;scene.media=[];
  for(let i=0;i<3;i++){
   const img=path.join(root,'image-'+i+'.png');
   await sharp({create:{width:40,height:40,channels:3,background:{r:40*i,g:100,b:50}}}).png().toFile(img);
   const imported=store.importAsset(root,project.id,img);
   scene.media.push({assetId:imported.id,start:0,end:0,speed:1});
  }
  store.saveProject(root,project);
  const parts=await media.getPreviewTimeline(root,project.id,'body');
  const ids=parts.map(p=>p.assetId).filter(Boolean);
  assert.equal(new Set(ids).size,3);
  assert.equal(parts[0].start,0);
  assert.ok(parts.at(-1).end>2.9);
 }finally{fs.rmSync(root,{force:true,recursive:true})}
});
