'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),sharp=require('sharp');
const {spawnSync}=require('node:child_process');
const {generate}=require('../backend/photo-clip.cjs');
const media=require('../backend/media.cjs'),store=require('../backend/store.cjs');

test('dos fotos conservan el encuadre, efecto y posición; redimensionar recorre el clip completo',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'records-photos-'));
 try{
  store.ensureRoot(root);const p=store.createProject(root,{title:'Imágenes'}),file=path.join(root,'dos.png');
  const pixels=Buffer.alloc(120*60*3);
  for(let i=0;i<120*60;i++)pixels[3*i+(i%120<60?0:2)]=160+(i%50);
  await sharp(pixels,{raw:{width:120,height:60,channels:3}}).png().toFile(file);
  const original=store.importAsset(root,p.id,file);
  const options={projectId:p.id,assetId:original.id,seconds:1,style:'in',crop:[.5,0,1,1],focus:[.2,.7],glow:true};
  const a=await generate(root,options);
  const b=await generate(root,{...options,style:'out',crop:[0,0,.5,1]});
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
