'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sharp=require('sharp');
const {spawnSync}=require('node:child_process');
const {IMAGE_SET}=require('./image-import.cjs');
const VIDEO_EXT=new Set(['.mp4','.mov','.mkv','.webm','.avi']);
const ID=/^[a-f0-9-]{36}$/i;
const folder=root=>path.join(root,'Recursos','Medios');
const index=root=>path.join(folder(root),'biblioteca.json');
function list(root){fs.mkdirSync(folder(root),{recursive:true});return fs.existsSync(index(root))?JSON.parse(fs.readFileSync(index(root),'utf8')):[]}
function write(root,items){fs.mkdirSync(folder(root),{recursive:true});const tmp=index(root)+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(items,null,2));fs.renameSync(tmp,index(root))}
function get(root,id){if(typeof id!=='string'||!ID.test(id))throw Error('Identificador inválido');const item=list(root).find(x=>x.id===id);if(!item)throw Error('Recurso global inexistente');return item}
function resolve(root,id){const item=get(root,id);const base=path.resolve(folder(root)),file=path.resolve(base,item.file);if(!file.startsWith(base+path.sep)||!fs.existsSync(file))throw Error('Archivo no encontrado');return file}
async function importFile(root,source,name){
 const ext=path.extname(source).toLowerCase(),isImage=IMAGE_SET.has(ext),isVideo=VIDEO_EXT.has(ext);
 if(!isImage&&!isVideo)throw Error('Solo se permiten imágenes y videos compatibles');
 const stat=fs.statSync(source),max=isImage?200*1024*1024:2*1024*1024*1024;
 if(!stat.isFile()||!stat.size||stat.size>max)throw Error('El archivo está vacío o excede el límite permitido');
 const id=crypto.randomUUID(),destExt=isImage?'.png':ext,relative=id+destExt,dest=path.join(folder(root),relative);
 fs.mkdirSync(folder(root),{recursive:true});
 try{
  if(isImage){
   try{
    await sharp(source,{limitInputPixels:65000000,animated:false,failOn:'error'}).rotate()
     .resize({width:4096,height:4096,fit:'inside',withoutEnlargement:true}).png().toFile(dest);
   }catch(err){
    if(fs.existsSync(dest))fs.rmSync(dest,{force:true});
    const ffmpeg=require('ffmpeg-static');
    const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',source,'-frames:v','1',
      '-vf',"scale=w='min(iw,4096)':h='min(ih,4096)':force_original_aspect_ratio=decrease",dest],{windowsHide:true,timeout:90000,encoding:'utf8'});
    if(result.error||result.status!==0)throw Error('No se pudo convertir la imagen: '+(result.stderr||err.message).slice(0,180));
   }
  }else fs.copyFileSync(source,dest);
  const item={id,name:String(name||path.basename(source)).slice(0,120),type:isImage?'image':'video',file:relative,size:fs.statSync(dest).size,createdAt:new Date().toISOString()};
  write(root,[...list(root),item]);return item;
 }catch(err){if(fs.existsSync(dest))fs.rmSync(dest,{force:true});throw err}
}
async function paste(root,buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length<20||buffer.length>50*1024*1024)throw Error('Imagen del portapapeles inválida');
 const id=crypto.randomUUID(),file=id+'.png',dest=path.join(folder(root),file);
 fs.mkdirSync(folder(root),{recursive:true});
 await sharp(buffer,{limitInputPixels:65000000}).png().toFile(dest);
 const item={id,name:'Imagen pegada '+new Date().toLocaleString('es-EC'),type:'image',file,size:fs.statSync(dest).size,createdAt:new Date().toISOString()};
 write(root,[...list(root),item]);return item;
}
function rename(root,id,name){const items=list(root),item=items.find(x=>x.id===id),value=String(name||'').trim().slice(0,120);if(!item||!value)throw Error('Nombre o recurso inválido');item.name=value;write(root,items);return item}
function remove(root,id){const item=get(root,id);write(root,list(root).filter(x=>x.id!==id));fs.rmSync(resolveFile(root,item),{force:true});return true}
function resolveFile(root,item){return path.join(folder(root),item.file)}
module.exports={list,get,resolve,importFile,paste,rename,remove};
