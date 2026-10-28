'use strict';
// Vista previa completa: render final sin aprobar/exportar automáticamente.
// Fingerprint del montaje + archivos externos evita exportar un render desactualizado.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const store=require('./store.cjs'),media=require('./media.cjs'),templates=require('./templates.cjs'),logos=require('./logo.cjs');
const VERSION='review-2026-10-27-v1';
const ORDER=['hook','body','closing'];
const uuid=/^[a-f0-9-]{36}$/i,hashPattern=/^[a-f0-9]{32}$/;
const nameFor={hook:'Gancho',body:'Desarrollo',closing:'Cierre'};
function valid(kind,id){if(!['short','week'].includes(kind)||typeof id!=='string'||!uuid.test(id))throw Error('Referencia de revisión inválida')}
function folder(root){return path.join(root,'Temporales','Revisiones')}
function filename(root,kind,id,hash){valid(kind,id);if(!hashPattern.test(hash))throw Error('Versión de revisión inválida');return path.join(folder(root),kind+'-'+id+'-'+hash+'.mp4')}
function resolve(root,kind,id,hash){
 const target=filename(root,kind,id,hash);
 if(!fs.existsSync(target)||fs.statSync(target).size<1024)throw Error('Esta vista previa todavía no se ha generado');
 return target;
}
function sourceStamp(file){
 const st=fs.statSync(file);
 if(!st.isFile())throw Error('No existe el recurso de edición');
 return [file,st.size,st.mtimeMs];
}
function effectiveTemplate(root,project,scene,format){
 const choice=Object.prototype.hasOwnProperty.call(scene.backgrounds||{},format)?scene.backgrounds[format]:project.backgrounds?.[format];
 if(!choice)return null;
 if(typeof choice==='string')return templates.resolve(root,choice,format);
 if(choice.scope==='project')return store.resolveAsset(root,project.id,choice.assetId);
 throw Error('Fondo de escena inválido');
}
function sequenceFor(root,kind,id){
 valid(kind,id);
 if(kind==='short')return ORDER.map(scene=>({projectId:id,scene,title:nameFor[scene],transition:false}));
 const week=store.getWeek(root,id);
 if(!week.projectIds?.length)throw Error('Añade récords al video largo');
 if(!week.intro?.projectId||!week.closing?.projectId)throw Error('Añade introducción y cierre');
 const entries=[{...week.intro,title:'Introducción'},
  ...week.projectIds.map(pid=>({projectId:pid,scene:'body',title:store.getProject(root,pid).title})),
  {...week.closing,title:'Cierre'}];
 // Reproducir el orden y las transiciones del exportador semanal existente.
 const sequence=[];
 for(let i=0;i<entries.length;i++){
  if(i>1&&i<entries.length-1)sequence.push({transition:true,title:entries[i].title});
  sequence.push({...entries[i],transition:false});
 }
 return sequence;
}
async function inspect(root,kind,id){
 const sequence=sequenceFor(root,kind,id),settings=store.getSettings(root),projects=new Map();
 const usedFiles=[],chapters=[],missing=[];
 let seconds=0,allApproved=true;
 for(const entry of sequence){
  if(entry.transition){
   chapters.push({key:'transition-'+chapters.length,label:'Transición',start:seconds,duration:1,transition:true});
   seconds+=1;continue;
  }
  let p=projects.get(entry.projectId);
  if(!p){p=store.getProject(root,entry.projectId);projects.set(entry.projectId,p)}
  const scene=p.scenes[entry.scene];
  if(!scene)throw Error('No existe la escena '+entry.scene);
  allApproved=allApproved&&scene.approved===true;
  if(!scene.video){
   missing.push(entry.title+' · falta narración');
   chapters.push({key:entry.scene+'-'+entry.projectId,label:entry.title,scene:entry.scene,projectId:entry.projectId,start:seconds,duration:0});
   continue;
  }
  const voice=store.resolveAsset(root,p.id,scene.video);
  const info=await media.probe(voice),duration=media.selectedDuration(scene,info.duration);
  if(duration<.5)missing.push(entry.title+' · duración insuficiente');
  chapters.push({key:entry.scene+'-'+entry.projectId,label:entry.title,scene:entry.scene,projectId:entry.projectId,
   start:seconds,duration:Math.max(0,duration)});
  seconds+=Math.max(0,duration);
 }
 const format=kind==='short'?'short':'wide';
 for(const p of projects.values()){
  usedFiles.push(...p.assets.map(a=>sourceStamp(store.resolveAsset(root,p.id,a.id))));
  for(const s of Object.values(p.scenes)){
   const file=effectiveTemplate(root,p,s,format);
   if(file)usedFiles.push(sourceStamp(file));
  }
 }
 if(settings.logo&&fs.existsSync(settings.logo))usedFiles.push(sourceStamp(settings.logo));
 const allProjects=[...projects.values()].map(p=>({id:p.id,title:p.title,style:p.style,backgrounds:p.backgrounds,scenes:Object.fromEntries(Object.entries(p.scenes).map(([key,scene])=>[key,{...scene,approved:undefined}])),assets:p.assets.map(a=>({id:a.id,file:a.file}))}));
 const week=kind==='week'?store.getWeek(root,id):null;
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify({v:VERSION,kind,id,
  week:week&&{title:week.title,projectIds:week.projectIds,intro:week.intro,closing:week.closing},
  projects:allProjects,files:usedFiles,
  settings:{autoMicrocuts:settings.autoMicrocuts,logo:settings.logo}})).digest('hex').slice(0,32);
 let ready=false;
 try{resolve(root,kind,id,fingerprint);ready=true}catch(_){}
 return {kind,id,hash:fingerprint,ready,complete:missing.length===0,approved:kind==='short'?allApproved:true,
  canExport:ready&&missing.length===0&&(kind!=='short'||allApproved)&&(kind!=='week'||seconds>=480),
  chapters,duration:seconds,missing,
  url:ready?'records://review/'+kind+'/'+id+'/'+fingerprint:null,
  minDuration:kind==='week'?480:0};
}
async function prepare(root,kind,id,signal,send){
 let snapshot=await inspect(root,kind,id);
 if(!snapshot.complete)throw Error('Completa las escenas antes de revisar: '+snapshot.missing.join(', '));
 if(snapshot.ready)return snapshot;
 const tmp=media.temporary(root),parts=[],settings=store.getSettings(root);
 const sourceSequence=sequenceFor(root,kind,id),logo=await logos.normalize(root,settings.logo);
 fs.mkdirSync(folder(root),{recursive:true});
 const destination=filename(root,kind,id,snapshot.hash);
 try{
  const progress=()=>send({type:'segment',stage:'Vista previa completa',done:parts.length});
  for(let i=0;i<sourceSequence.length;i++){
   if(signal.aborted)throw Error('Generación cancelada');
   const entry=sourceSequence[i];
   if(entry.transition){
    send({type:'status',message:'Preparando transición'});
    parts.push(await media.renderTransition(tmp,entry.title,signal));continue;
   }
   send({type:'status',message:'Preparando '+entry.title});
   const p=store.getProject(root,entry.projectId);
   const result=await media.compileScene(root,p,entry.scene,kind==='week',tmp,signal,progress,logo);
   parts.push(...result.segments);
  }
  const provisional=path.join(tmp,'revision-completa.mp4');
  send({type:'status',message:'Uniendo escenas del video completo'});
  await media.concat(tmp,parts,provisional,signal);
  if(signal.aborted)throw Error('Generación cancelada');
  const latest=await inspect(root,kind,id);
  if(latest.hash!==snapshot.hash)throw Error('Cambió el proyecto durante el render. Actualiza la revisión.');
  // No se marca como exportado y no se modifica el proyecto original.
  if(!fs.existsSync(destination))fs.copyFileSync(provisional,destination);
  // Conservar una sola revisión por proyecto para no llenar el disco D.
  const prefix=kind+'-'+id+'-';
  for(const filename of fs.readdirSync(folder(root))){
   if(filename.startsWith(prefix)&&filename.endsWith('.mp4')&&filename!==path.basename(destination))
    fs.rmSync(path.join(folder(root),filename),{force:true});
  }
  return await inspect(root,kind,id);
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
async function exportApproved(root,kind,id,expectedHash){
 const snapshot=await inspect(root,kind,id);
 if(typeof expectedHash!=='string'||snapshot.hash!==expectedHash)throw Error('El video cambió. Actualiza la vista previa antes de exportar.');
 if(!snapshot.complete||!snapshot.ready)throw Error('Primero genera y revisa el video completo');
 if(kind==='short'&&!snapshot.approved)throw Error('Aprueba Gancho, Desarrollo y Cierre para exportar');
 if(kind==='week'&&snapshot.duration<480)throw Error('El video largo debe alcanzar 8 minutos antes de exportar');
 const source=resolve(root,kind,id,snapshot.hash);
 const destFolder=path.join(root,'Exportaciones',kind==='short'?'Shorts':'Videos-Largos');
 fs.mkdirSync(destFolder,{recursive:true});
 const output=path.join(destFolder,id+'-'+Date.now()+'.mp4');
 try{
  fs.copyFileSync(source,output);
  const finalState=await inspect(root,kind,id);
  if(finalState.hash!==snapshot.hash)throw Error('El proyecto cambió durante la exportación. Vuelve a revisar.');
  if(kind==='short'){
   const p=store.getProject(root,id);
   p.status='exported';p.exports=p.exports||[];
   p.exports.push({at:new Date().toISOString(),mode:'short',file:output,reviewHash:snapshot.hash});
   p.updatedAt=new Date().toISOString();store.atomic(store.projectFile(root,id),p);
  }else{
   const week=store.getWeek(root,id);week.exportedAt=new Date().toISOString();
   week.outputs=week.outputs||[];week.outputs.push(output);store.atomic(store.weekFile(root,id),week);
   for(const pid of week.projectIds){
    const p=store.getProject(root,pid);p.usedBy=p.usedBy||[];
    if(!p.usedBy.includes(id))p.usedBy.push(id);
    store.atomic(store.projectFile(root,pid),p);
   }
  }
  return {file:output,hash:snapshot.hash,duration:snapshot.duration};
 }catch(e){fs.rmSync(output,{force:true});throw e}
}
module.exports={inspect,prepare,exportApproved,resolve,sequenceFor};
