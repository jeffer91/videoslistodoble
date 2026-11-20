'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),sharp=require('sharp');
const {spawnSync}=require('node:child_process');
const {generate}=require('../backend/photo-clip.cjs');
const media=require('../backend/media.cjs'),store=require('../backend/store.cjs');
// Motor de animación desde el código fuente (en el instalador va empaquetado).
const PYTHON=process.env.RECORDS_PYTHON||(process.platform==='win32'?'python':'python3');
const engine=spawnSync(PYTHON,['-c','import cv2, numpy'],{encoding:'utf8'});
const runtime=async()=>({exe:PYTHON,args:[path.join(__dirname,'..','animation','worker.py')]});
const needsEngine={skip:engine.status===0?false:'Falta Python con OpenCV para el motor de animación'};

test('dos fotos conservan el encuadre, efecto y posición; redimensionar recorre el clip completo',needsEngine,async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'records-photos-'));
 try{
  store.ensureRoot(root);const p=store.createProject(root,{title:'Imágenes'}),file=path.join(root,'dos.png');
  const pixels=Buffer.alloc(120*60*3);
  for(let i=0;i<120*60;i++)pixels[3*i+(i%120<60?0:2)]=160+(i%50);
  await sharp(pixels,{raw:{width:120,height:60,channels:3}}).png().toFile(file);
  const original=store.importAsset(root,p.id,file);
  const options={projectId:p.id,assetId:original.id,seconds:1,style:'in',crop:[.5,0,1,1],focus:[.2,.7],glow:true};
  const a=await generate(root,options,undefined,runtime);
  const b=await generate(root,{...options,style:'out',crop:[0,0,.5,1]},undefined,runtime);
  function pixel(asset){
   const frame=spawnSync(media.toolPath('ffmpeg'),['-loglevel','error','-i',store.resolveAsset(root,p.id,asset.id),'-vf','scale=1:1','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
   assert.equal(frame.status,0,String(frame.stderr));return frame.stdout;
  }
  assert.ok(pixel(a.asset)[2]>150);assert.ok(pixel(b.asset)[0]>150);
  const items=[a,b].map((result,i)=>({at:i*2,seconds:2,fitDuration:true,sourceStart:0,sourceEnd:result.duration,assetId:result.asset.id,type:'video'}));
  const entries=media.timeline({start:0,end:4,cuts:[{mode:'both',start:.5,end:1}]},4,items);
  assert.equal(entries[1].start,1);assert.equal(entries[1].mediaStart,.5);
  assert.equal(entries[2].medium.assetId,b.asset.id);assert.equal(entries[2].speed,.5);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('mover un bloque sobre otro permite insertar o reemplazar; cancelar conserva los originales',async()=>{
 const vm=require('node:vm'),handlers={},modal={};
 const scene={video:'voz',end:12,media:[{assetId:'A',at:1,seconds:2},{assetId:'B',at:5,seconds:2}]};
 const ctx={state:{page:'project',scene:'body',project:{id:'p',assets:[],scenes:{body:scene}}},
  editorDuration:()=>12,$:()=>modal,esc:s=>s,btn:()=>'',saveNow:async()=>{},render(){},prepareScenePreview(){},notice(m){throw Error(m)},
  document:{addEventListener(k,f){handlers[k]=f;}}};
 const api=vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/photo-track.js'),'utf8')+'\nPhotoTrack',ctx);
 const original=JSON.stringify(scene.media);
 async function drag(){
  const block={dataset:{photoBlock:'0'},style:{},parentElement:{getBoundingClientRect:()=>({width:120})},setPointerCapture(){}};
  handlers.pointerdown({target:{closest:s=>s==='[data-photo-block]'?block:null},preventDefault(){},clientX:10});
  await block.onpointerup({clientX:50});
 }
 await drag();assert.match(modal.innerHTML,/Ya hay una imagen/);api.dismiss();
 assert.equal(JSON.stringify(scene.media),original);
 await drag();await api.handle('photo-insert');assert.deepEqual(Array.from(scene.media,m=>m.at),[5,7]);
 scene.media=JSON.parse(original);await drag();await api.handle('photo-replace');
 assert.deepEqual(Array.from(scene.media,m=>[m.assetId,m.at]),[['A',5]]);
});

test('Animar imagen desde revisión abre el selector en un gancho antiguo sin recursos',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'records-hook-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 store.ensureRoot(root);
 const project=store.createProject(root,{title:'Gancho de tres segundos'});
 assert.deepEqual(project.scenes.hook.media,[]);
 assert.deepEqual(project.scenes.closing.media,[]);
 const hook=project.scenes.hook;
 hook.video='toma';hook.end=3;
 delete hook.media;
 store.atomic(store.projectFile(root,project.id),project);
 const modal={},state={page:'review',project};
 const vm=require('node:vm');
 const ctx={state,editorDuration:()=>3,$:()=>modal,esc:s=>s,btn:(action,label)=>label,
  document:{addEventListener(){}},openProject:async(id,scene)=>{
   state.project=store.getProject(root,id);state.page='project';state.scene=scene;
  }};
 const ui=vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/photo-track.js'),'utf8')+'\nPhotoTrack',ctx);
 assert.doesNotThrow(()=>ui.track(hook,3));
 await ui.open('hook');
 assert.deepEqual(state.project.scenes.hook.media,[]);
 assert.match(modal.innerHTML,/Importar foto/);
});

test('un bloque antiguo con nombre largo se puede quitar sin borrar su archivo ni otra aparición',async()=>{
 const vm=require('node:vm'),handlers={},modal={};
 const asset={id:'antiguo',type:'video',name:'x'.repeat(220)+'-pintura.mp4'};
 const scene={media:[{assetId:asset.id,at:0,seconds:2},{assetId:asset.id,at:2,seconds:3}]};
 const project={id:'p',assets:[asset],scenes:{body:scene}};
 const ctx={document:{addEventListener(k,f){handlers[k]=f;}},state:{page:'project',scene:'body',project},
  $:()=>modal,btn:(a,l)=>l,esc:String,saveNow:async()=>{},render(){},prepareScenePreview(){}};
 const ui=vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/photo-track.js'),'utf8')+'\nPhotoTrack',ctx);
 handlers.keydown({key:'Enter',target:{closest:()=>({dataset:{photoBlock:'1'}})},preventDefault(){}});
 assert.match(modal.innerHTML,/Pintura 2/);assert.match(modal.innerHTML,/Quitar marco de papel/);
 assert.match(modal.innerHTML,/Quitar de la escena/);assert.ok(!modal.innerHTML.includes(asset.name));
 await ui.handle('photo-remove');
 assert.equal(scene.media.length,1);assert.equal(scene.media[0].at,0);assert.equal(project.assets[0],asset);
});

test('efectos nuevos: impacto, profundidad y destacado crean clips nítidos; sin protagonista se usa un acercamiento',{...needsEngine,timeout:120000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'records-motion-'));
 const previous=process.env.RECORDS_SUBJECT_MODEL;
 try{
  process.env.RECORDS_SUBJECT_MODEL='';
  store.ensureRoot(root);const p=store.createProject(root,{title:'Efectos'}),file=path.join(root,'foto.png');
  const w=320,h=240,pixels=Buffer.alloc(w*h*3);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=3*(y*w+x),inside=(x-160)**2+(y-120)**2<60**2;pixels[i]=inside?230:40+x%60;pixels[i+1]=inside?60:90;pixels[i+2]=inside?40:120+y%40}
  await sharp(pixels,{raw:{width:w,height:h,channels:3}}).png().toFile(file);
  const photo=store.importAsset(root,p.id,file);
  for(const style of ['impacto','profundidad','destacado','pan']){
   const result=await generate(root,{projectId:p.id,assetId:photo.id,seconds:1.5,style,crop:[0,0,1,1],focus:[.5,.5],glow:false},new AbortController().signal,runtime);
   const info=await media.probe(store.resolveAsset(root,p.id,result.asset.id));
   assert.ok(Math.abs(info.duration-1.5)<.15,style+' dura '+info.duration);
   assert.equal(info.width,1080,style+' a resolución completa');
   assert.match(result.asset.name,new RegExp('-'+style+'\\.mp4$'));
  }
 }finally{
  if(previous===undefined)delete process.env.RECORDS_SUBJECT_MODEL;else process.env.RECORDS_SUBJECT_MODEL=previous;
  fs.rmSync(root,{recursive:true,force:true});
 }
});
