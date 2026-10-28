'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const store=require('./store.cjs'),media=require('./media.cjs'),logos=require('./logo.cjs'),templates=require('./templates.cjs');
const KINDS=['short','week'],UUID=/^[a-f0-9-]{36}$/i,KEYS=['hook','body','closing'];
const NAMES={hook:'Gancho',body:'Desarrollo',closing:'Cierre'};
const VERSION='live-montage-2026-10-27-master-v2';
const masterAudio=require('./master-audio.cjs');
function validate(kind,id){if(!KINDS.includes(kind)||!UUID.test(String(id)))throw Error('Revisión inválida')}
function sequenceFor(root,kind,id){
 validate(kind,id);
 if(kind==='short')return KEYS.map(scene=>({projectId:id,scene,title:NAMES[scene]}));
 const week=store.getWeek(root,id);
 if(!week.projectIds?.length||!week.intro||!week.closing)throw Error('La compilación no tiene escenas suficientes');
 const entries=[{...week.intro,title:'Introducción'},
  ...week.projectIds.map(pid=>({projectId:pid,scene:'body',title:store.getProject(root,pid).title})),
  {...week.closing,title:'Cierre'}];
 const result=[];
 for(let i=0;i<entries.length;i++){
  if(i>1&&i<entries.length-1)result.push({transition:true,title:entries[i].title});
  result.push(entries[i]);
 }
 return result;
}
function stamp(file){const st=fs.statSync(file);return [file,st.size,st.mtimeMs]}
function backgroundPath(root,p,scene,format){
 const choice=Object.prototype.hasOwnProperty.call(scene.backgrounds||{},format)?scene.backgrounds[format]:p.backgrounds?.[format];
 if(!choice)return null;
 if(typeof choice==='string')return templates.resolve(root,choice,format);
 if(choice.scope==='project')return store.resolveAsset(root,p.id,choice.assetId);
 throw Error('Fondo inválido');
}
async function inspect(root,kind,id){
 const sequence=sequenceFor(root,kind,id),projects=new Map(),settings=store.getSettings(root);
 const chapters=[],missing=[],files=[];let elapsed=0,approved=true;
 const first=kind==='short'?store.getProject(root,id):null;
 const transitions=first?.transitions||{hookBody:'fade',bodyClosing:'fade',duration:.3};
 const master=kind==='short'?{speed:1,musicLevel:18,...first.master}:{speed:1,musicLevel:0,musicAssetId:null};
 masterAudio.settings(master);
 for(const entry of sequence){
  if(entry.transition){chapters.push({transition:true,label:'Transición',start:elapsed,duration:1});elapsed+=1;continue}
  let p=projects.get(entry.projectId);
  if(!p){p=store.getProject(root,entry.projectId);projects.set(entry.projectId,p)}
  const scene=p.scenes[entry.scene];
  if(!scene)throw Error('Escena inexistente');
  approved=approved&&scene.approved===true;
  if(!scene.video){
   chapters.push({label:entry.title,scene:entry.scene,projectId:p.id,start:elapsed,duration:0,ranges:[],playbackSpeed:1});
   missing.push(entry.title+': falta narración');continue;
  }
  const voice=store.resolveAsset(root,p.id,scene.video),info=await media.probe(voice);
  const rate=Math.max(.5,Math.min(2,Number(scene.playbackSpeed)||1))*master.speed;
  const ranges=media.retainedRanges(scene,info.duration).map(r=>({...r,duration:(r.end-r.start)/rate}));
  const duration=ranges.reduce((sum,r)=>sum+r.duration,0);
  if(duration<.5)missing.push(entry.title+': duración insuficiente');
  chapters.push({label:entry.title,scene:entry.scene,projectId:p.id,assetId:scene.video,
   start:elapsed,duration,playbackSpeed:rate,ranges,transition:false});
  elapsed+=duration;
 }
 if(kind==='short'&&master.musicAssetId){
  const asset=first.assets.find(a=>a.id===master.musicAssetId);
  if(!asset||asset.type!=='audio')throw Error('La pista musical no está disponible');
 }
 const format=kind==='short'?'short':'wide';
 for(const p of projects.values()){
  for(const a of p.assets||[])files.push(stamp(store.resolveAsset(root,p.id,a.id)));
  for(const s of Object.values(p.scenes)){const file=backgroundPath(root,p,s,format);if(file)files.push(stamp(file))}
 }
 if(settings.logo&&fs.existsSync(settings.logo))files.push(stamp(settings.logo));
 const models=[...projects.values()].map(p=>({title:p.title,style:p.style,backgrounds:p.backgrounds,transitions:p.transitions,master:p.master,
  scenes:Object.fromEntries(Object.entries(p.scenes).map(([k,s])=>[k,{...s,approved:undefined,cutHistory:undefined}]))}));
 const hash=crypto.createHash('sha256').update(JSON.stringify({v:VERSION,kind,id,chapters,models,files,
  week:kind==='week'?store.getWeek(root,id):null,autoMicrocuts:settings.autoMicrocuts,logo:settings.logo}))
  .digest('hex').slice(0,32);
 return {kind,id,hash,ready:true,live:true,complete:missing.length===0,approved:kind==='short'?approved:true,
  canExport:missing.length===0&&(kind!=='short'||approved)&&(kind!=='week'||elapsed>=480),
  chapters,duration:elapsed,missing,transition:transitions,master};
}
async function exportApproved(root,kind,id,expectedHash,signal,send=()=>{}){
 const snapshot=await inspect(root,kind,id);
 if(snapshot.hash!==expectedHash)throw Error('El proyecto cambió. Revisa el video actualizado.');
 if(!snapshot.canExport)throw Error('Completa y aprueba todas las escenas antes de exportar');
 const sequence=sequenceFor(root,kind,id),tmp=media.temporary(root),settings=store.getSettings(root),
  logo=await logos.normalize(root,settings.logo),temporaryPairs=[];
 try{
  const sceneFiles=[];
  for(const entry of sequence){
   if(signal?.aborted)throw Error('Cancelado');
   if(entry.transition){sceneFiles.push(await media.renderTransition(tmp,entry.title,signal));continue}
   const p=store.getProject(root,entry.projectId);
   send({type:'status',message:'Componiendo '+entry.title});
   const parts=await media.compileScene(root,p,entry.scene,kind==='week',tmp,signal,
    ()=>send({type:'segment',stage:entry.title}),logo);
   const joined=path.join(tmp,'escena-'+sceneFiles.length+'.mp4');
   await media.concat(tmp,parts.segments,joined,signal);
   sceneFiles.push(joined);
  }
  let combined;
  if(kind==='short'){
   combined=sceneFiles[0];
   const effects=[snapshot.transition?.hookBody||'fade',snapshot.transition?.bodyClosing||'fade'];
   for(let i=1;i<sceneFiles.length;i++){
    send({type:'status',message:'Transición '+i+' de '+(sceneFiles.length-1)});
    const joined=await media.joinWithTransition(root,combined,sceneFiles[i],effects[i-1],
     Number(snapshot.transition?.duration)||.3,signal);
    combined=joined.file;temporaryPairs.push(joined.temp);
   }
  }else{
   combined=path.join(tmp,'ensamblado.mp4');await media.concat(tmp,sceneFiles,combined,signal);
  }
  send({type:'status',message:'Aplicando velocidad global, mezcla musical y normalización'});
  const normalized=path.join(tmp,'final-normalizado.mp4');
  const source=kind==='short'?store.getProject(root,id):null;
  const musicFile=source?.master?.musicAssetId?store.resolveAsset(root,id,source.master.musicAssetId):null;
  await masterAudio.render(combined,normalized,source?.master||{},musicFile,signal);
  if(signal?.aborted)throw Error('Cancelado');
  const current=await inspect(root,kind,id);
  if(current.hash!==snapshot.hash)throw Error('El proyecto cambió durante la exportación');
  const destDir=path.join(root,'Exportaciones',kind==='short'?'Shorts':'Videos-Largos');
  fs.mkdirSync(destDir,{recursive:true});
  const output=path.join(destDir,id+'-'+Date.now()+'.mp4');
  fs.copyFileSync(normalized,output);
  if(kind==='short'){
   const p=store.getProject(root,id);p.status='exported';p.exports=p.exports||[];
   p.exports.push({at:new Date().toISOString(),mode:'short',file:output,reviewHash:snapshot.hash});
   store.atomic(store.projectFile(root,id),p);
  }else{
   const week=store.getWeek(root,id);week.outputs=week.outputs||[];
   week.outputs.push(output);week.exportedAt=new Date().toISOString();
   store.atomic(store.weekFile(root,id),week);
   for(const pid of week.projectIds){
    const p=store.getProject(root,pid);p.usedBy=p.usedBy||[];
    if(!p.usedBy.includes(id))p.usedBy.push(id);
    store.atomic(store.projectFile(root,pid),p);
   }
  }
  return {file:output,hash:snapshot.hash,duration:(await media.probe(output)).duration};
 }finally{
  fs.rmSync(tmp,{recursive:true,force:true});
  for(const dir of temporaryPairs)fs.rmSync(dir,{recursive:true,force:true});
 }
}
module.exports={inspect,exportApproved,sequenceFor};
