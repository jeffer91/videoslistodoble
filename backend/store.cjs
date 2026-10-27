'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const TYPES={'.mp4':'video','.mov':'video','.mkv':'video','.webm':'video','.avi':'video','.jpg':'image','.jpeg':'image','.png':'image','.webp':'image','.gif':'image','.wav':'audio','.mp3':'audio','.m4a':'audio','.aac':'audio'};
const safeId=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{5,90}$/.test(s);
const uid=()=>crypto.randomUUID();
const makeScenes=()=>({
 hook:{video:null,start:0,end:0,silences:[],title:'',number:'',name:'',layout:'auto',position:'left',scale:65},
 body:{video:null,start:0,end:0,silences:[],title:'',number:'',name:'',layout:'auto',position:'left',scale:65,media:[]},
 closing:{video:null,start:0,end:0,silences:[],title:'',number:'',name:'',layout:'auto',position:'center',scale:80}
});
function ensureRoot(root){for(const dir of ['Proyectos','Compilaciones','Exportaciones/Shorts','Exportaciones/Videos-Largos','Recursos','Recursos/Plantillas','Respaldos','Configuracion','Temporales'])fs.mkdirSync(path.join(root,dir),{recursive:true});const logo=path.join(root,'Recursos','logo-11-records.png'),source=path.join(__dirname,'..','assets','logo-11-records.png');if(!fs.existsSync(logo)&&fs.existsSync(source))fs.copyFileSync(source,logo);const settings=getSettings(root);if(!settings.logo&&fs.existsSync(logo))saveSettings(root,{logo})}
function readJSON(file){return JSON.parse(fs.readFileSync(file,'utf8'))}
function atomic(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(obj,null,2),'utf8');fs.renameSync(tmp,file)}
function projectFile(root,id){if(!safeId(id))throw Error('Identificador de proyecto inválido');return path.join(root,'Proyectos',id,'proyecto.json')}
function weekFile(root,id){if(!safeId(id))throw Error('Identificador de compilación inválido');return path.join(root,'Compilaciones',id,'compilacion.json')}
function getProject(root,id){const p=readJSON(projectFile(root,id));if(p.id!==id)throw Error('Inconsistencia de proyecto');return p}
function createProject(root,x){const id=uid(),now=new Date().toISOString();const scenes=makeScenes();for(const [key,scene] of Object.entries(scenes)){scene.formats={short:{layout:'auto',position:key==='closing'?'center':'left',scale:key==='closing'?95:65},wide:{layout:'auto',position:key==='closing'?'center':'right',scale:key==='closing'?95:65}};scene.backgrounds={}};const p={schema:1,id,title:String(x.title||'Nuevo récord').slice(0,120),createdAt:now,updatedAt:now,status:'editing',assets:[],style:'historic',backgrounds:{short:getSettings(root).templateDefaults?.short||null,wide:getSettings(root).templateDefaults?.wide||null},scenes,exports:[],usedBy:[]};atomic(projectFile(root,id),p);return p}
function assertAssetRefs(p){const ids=new Set((p.assets||[]).map(a=>a.id));for(const scene of Object.values(p.scenes||{})){if(scene.video&&!ids.has(scene.video))throw Error('Video no encontrado en la biblioteca');for(const m of scene.media||[])if(!ids.has(m.assetId))throw Error('Recurso no encontrado en el proyecto')}}
function saveProject(root,x){const original=getProject(root,x.id);
 const editable=['title','style','scenes','status','backgrounds'];const next={...original};
 for(const key of editable)if(x[key]!==undefined)next[key]=x[key];
 if(!['historic','numbers','legends'].includes(next.style))throw Error('Plantilla inválida');
 assertAssetRefs(next);
 for(const scene of Object.values(next.scenes||{})){
  if(scene.backgrounds===undefined)continue;
  if(!scene.backgrounds||typeof scene.backgrounds!=='object'||Array.isArray(scene.backgrounds))throw Error('Fondos de escena inválidos');
  for(const format of ['short','wide']){
   if(!Object.prototype.hasOwnProperty.call(scene.backgrounds,format))continue;
   const id=scene.backgrounds[format];
   if(id!==null)require('./templates.cjs').getWithFormat(root,id,format);
  }
 }
 if(next.backgrounds!==undefined){
  if(!next.backgrounds||Array.isArray(next.backgrounds)||typeof next.backgrounds!=='object')throw Error('Fondos de proyecto inválidos');
  for(const format of ['short','wide']){
   const id=next.backgrounds[format]||null;
   if(id!==null)require('./templates.cjs').getWithFormat(root,id,format);
  }
 }
 next.updatedAt=new Date().toISOString();atomic(projectFile(root,next.id),next);return next}
function importAsset(root,id,source,displayName){
 const p=getProject(root,id),ext=path.extname(source).toLowerCase(),type=TYPES[ext];
 if(!type)throw Error('Formato de medio no admitido: '+ext);
 const stat=fs.statSync(source);if(!stat.isFile()||stat.size>2*1024*1024*1024)throw Error('Archivo inválido o superior a 2 GB');
 const assetId=uid();const filename=assetId+ext;const dest=path.join(root,'Proyectos',id,'Originales',filename);
 fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);
 const item={id:assetId,type,name:displayName||path.basename(source),file:'Originales/'+filename,size:stat.size};
 p.assets.push(item);p.updatedAt=new Date().toISOString();atomic(projectFile(root,id),p);return {...item,url:'records://asset/'+id+'/'+assetId};
}
function saveImageBuffer(root,id,data){
 const buffer=Buffer.isBuffer(data)?data:Buffer.from(data||[]);
 const signature=Buffer.from([137,80,78,71,13,10,26,10]);
 if(buffer.length<24||buffer.length>50*1024*1024||!buffer.subarray(0,8).equals(signature))
  throw Error('El portapapeles no contiene una imagen PNG válida o es demasiado grande');
 const p=getProject(root,id),assetId=uid(),rel='Originales/'+assetId+'.png';
 const dest=path.join(root,'Proyectos',id,rel);
 fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,buffer);
 const now=new Date(),item={id:assetId,type:'image',name:'Imagen pegada '+now.toLocaleString('es-EC')+'.png',file:rel,size:buffer.length};
 p.assets.push(item);p.updatedAt=now.toISOString();atomic(projectFile(root,id),p);
 return {...item,url:'records://asset/'+id+'/'+assetId};
}
function saveRecording(root,id,name,data){if(typeof data!=='string'||data.length>280000000)throw Error('Grabación demasiado grande');
 const buffer=Buffer.from(data,'base64');if(buffer.length<100)throw Error('Grabación vacía');
 const ext='.webm',assetId=uid(),rel='Originales/'+assetId+ext;
 const file=path.join(root,'Proyectos',id,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,buffer);
 const p=getProject(root,id),item={id:assetId,type:'video',name:String(name||'Grabación')+'.webm',file:rel,size:buffer.length};p.assets.push(item);atomic(projectFile(root,id),p);
 return {...item,url:'records://asset/'+id+'/'+assetId};
}
function resolveAsset(root,projectId,assetId){
 const p=getProject(root,projectId);if(!safeId(assetId))throw Error('Identificador inválido');
 const asset=p.assets.find(a=>a.id===assetId);if(!asset)throw Error('Recurso desconocido');
 const dir=path.resolve(root,'Proyectos',projectId),file=path.resolve(dir,asset.file);
 if(!file.startsWith(dir+path.sep))throw Error('Ruta de recurso no permitida');
 if(!fs.statSync(file).isFile())throw Error('Recurso no es archivo');
 return file;
}
function listProjects(root){return fs.readdirSync(path.join(root,'Proyectos'),{withFileTypes:true}).filter(e=>e.isDirectory()&&safeId(e.name)).flatMap(e=>{try{const p=getProject(root,e.name);return [{id:p.id,title:p.title,createdAt:p.createdAt,updatedAt:p.updatedAt,status:p.status,style:p.style,usedBy:p.usedBy||[],exports:p.exports||[]}]}catch(_){return []}}).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}
function deleteProject(root,id){const p=getProject(root,id);if((p.usedBy||[]).length)throw Error('Este proyecto está utilizado en una compilación y no puede borrarse');fs.rmSync(path.dirname(projectFile(root,id)),{recursive:true,force:true});return true}
function importLogo(root,source){const ext=path.extname(source).toLowerCase();if(!['.png','.jpg','.jpeg','.webp'].includes(ext))throw Error('Logo inválido');
 const dst=path.join(root,'Recursos','logo'+ext);fs.copyFileSync(source,dst);const settings=getSettings(root);settings.logo=dst;saveSettings(root,settings);return dst}
function getSettings(root){const file=path.join(root,'Configuracion','ajustes.json');return fs.existsSync(file)?readJSON(file):{logo:null,silenceThreshold:0.5,autoMicrocuts:true,defaultCamera:'',defaultMic:'',templateDefaults:{short:null,wide:null}}}
function saveSettings(root,x){const prev=getSettings(root);const settings={...prev,...Object.fromEntries(Object.entries(x).filter(([k])=>['logo','silenceThreshold','autoMicrocuts','defaultCamera','defaultMic','templateDefaults'].includes(k)))};atomic(path.join(root,'Configuracion','ajustes.json'),settings);return settings}
function createWeek(root,x){const id=uid();const eligible=listProjects(root).filter(p=>p.exports.length&&!(p.usedBy||[]).length).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));const now=new Date().toISOString();
 const helper=createProject(root,{title:'Intro y cierre - '+String(x.title||'Récords de la semana').slice(0,90)});helper.status='auxiliary';atomic(projectFile(root,helper.id),helper);
 const w={schema:1,id,title:String(x.title||'Récords de la semana').slice(0,120),createdAt:now,updatedAt:now,projectIds:eligible.filter(p=>p.status!=='auxiliary').map(p=>p.id),intro:{projectId:helper.id,scene:'hook'},closing:{projectId:helper.id,scene:'closing'},supportProjectId:helper.id,assets:[],minSeconds:480,exportedAt:null,outputs:[]};
 atomic(weekFile(root,id),w);return w}
function getWeek(root,id){return readJSON(weekFile(root,id))}
function saveWeek(root,x){const old=getWeek(root,x.id);const w={...old};for(const k of ['title','projectIds','intro','closing'])if(x[k]!==undefined)w[k]=x[k];if(!Array.isArray(w.projectIds)||w.projectIds.some(id=>!safeId(id)))throw Error('Lista de récords inválida');if(new Set(w.projectIds).size!==w.projectIds.length)throw Error('Hay récords duplicados');w.projectIds.forEach(id=>getProject(root,id));w.updatedAt=new Date().toISOString();atomic(weekFile(root,w.id),w);return w}
function listWeeks(root){return fs.readdirSync(path.join(root,'Compilaciones'),{withFileTypes:true}).filter(e=>e.isDirectory()&&safeId(e.name)).flatMap(e=>{try{return [getWeek(root,e.name)]}catch(_){return []}}).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}
function resolveManagedPath(root,filename){const file=path.resolve(filename),base=path.resolve(root);if(!file.startsWith(base+path.sep))throw Error('Solo se pueden abrir rutas dentro de la biblioteca');return file}
module.exports={ensureRoot,createProject,getProject,saveProject,listProjects,deleteProject,importAsset,saveImageBuffer,saveRecording,resolveAsset,projectFile,weekFile,createWeek,getWeek,saveWeek,listWeeks,importLogo,getSettings,saveSettings,resolveManagedPath,atomic};
