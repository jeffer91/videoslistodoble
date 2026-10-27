'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const sharp=require('sharp');
const {IMAGE_SET}=require('./image-import.cjs');
const VALID_FORMATS=new Set(['short','wide']);
const VALID_ID=/^[a-f0-9-]{36}$/i;
const dir=root=>path.join(root,'Recursos','Plantillas');
const indexPath=root=>path.join(dir(root),'biblioteca.json');
function ensure(root){fs.mkdirSync(dir(root),{recursive:true})}
function list(root){
 ensure(root);
 if(!fs.existsSync(indexPath(root)))return [];
 const result=JSON.parse(fs.readFileSync(indexPath(root),'utf8'));
 if(!Array.isArray(result))throw Error('El índice de plantillas está dañado');
 return result;
}
function write(root,items){
 ensure(root);
 const target=indexPath(root),temp=target+'.'+process.pid+'.tmp';
 fs.writeFileSync(temp,JSON.stringify(items,null,2),'utf8');
 fs.renameSync(temp,target);
}
function get(root,id){
 if(typeof id!=='string'||!VALID_ID.test(id))throw Error('Identificador de plantilla inválido');
 const item=list(root).find(t=>t.id===id);
 if(!item)throw Error('La plantilla seleccionada ya no existe');
 return item;
}
function resolve(root,id,format){
 const item=get(root,id);
 if(format&&item.format!==format)throw Error('La plantilla no coincide con el formato del video');
 const folder=path.resolve(dir(root));
 const file=path.resolve(folder,id+'.png');
 if(!file.startsWith(folder+path.sep)||!fs.existsSync(file))throw Error('Archivo de plantilla no encontrado');
 return file;
}
async function convertAndSave(root,name,format,input){
 if(!VALID_FORMATS.has(format))throw Error('Formato de plantilla inválido');
 const id=crypto.randomUUID(),file=path.join(dir(root),id+'.png');
 ensure(root);
 try{
  await sharp(input,{limitInputPixels:65000000,animated:false,failOn:'error'})
   .rotate().resize({width:4096,height:4096,fit:'inside',withoutEnlargement:true})
   .png({compressionLevel:8}).toFile(file);
  const meta=await sharp(file).metadata();
  const item={id,format,name:String(name||'Fondo personalizado').trim().slice(0,100)||'Fondo personalizado',createdAt:new Date().toISOString(),width:meta.width,height:meta.height};
  write(root,[...list(root),item]);
  return item;
 }catch(err){
  if(fs.existsSync(file))fs.rmSync(file,{force:true});
  throw err;
 }
}
async function importFile(root,source,format){
 const ext=path.extname(source).toLowerCase();
 if(!IMAGE_SET.has(ext))throw Error('El archivo no es una imagen compatible: '+ext);
 const stat=fs.statSync(source);
 if(!stat.isFile()||!stat.size||stat.size>200*1024*1024)throw Error('La imagen está vacía o supera 200 MB');
 return convertAndSave(root,path.parse(source).name,format,source);
}
async function pasteImage(root,buffer,format){
 if(!Buffer.isBuffer(buffer)||buffer.length<20||buffer.length>50*1024*1024)throw Error('Portapapeles sin imagen válida');
 return convertAndSave(root,'Imagen pegada '+new Date().toLocaleString('es-EC'),format,buffer);
}
function rename(root,id,name){
 const items=list(root),item=items.find(t=>t.id===id);
 if(!item)throw Error('Plantilla desconocida');
 const title=String(name||'').trim().slice(0,100);
 if(!title)throw Error('El nombre no puede estar vacío');
 item.name=title;write(root,items);return item;
}
function setDefault(root,format,id,store){
 if(!VALID_FORMATS.has(format))throw Error('Formato inválido');
 if(id!==null)getWithFormat(root,id,format);
 const settings=store.getSettings(root);
 return store.saveSettings(root,{templateDefaults:{...(settings.templateDefaults||{}),[format]:id}});
}
function getWithFormat(root,id,format){
 const item=get(root,id);
 if(item.format!==format)throw Error('La plantilla no corresponde al formato '+format);
 resolve(root,id,format);return item;
}
function remove(root,id,store){
 const item=get(root,id),settings=store.getSettings(root);
 if(Object.values(settings.templateDefaults||{}).includes(id))throw Error('Primero cambia el fondo predeterminado');
 for(const p of store.listProjects(root)){
  const project=store.getProject(root,p.id);
  if(Object.values(project.backgrounds||{}).includes(id)||
    Object.values(project.scenes||{}).some(scene=>Object.values(scene.backgrounds||{}).includes(id)))
    throw Error('Esta plantilla se utiliza en el proyecto '+project.title);
 }
 const items=list(root).filter(t=>t.id!==id);
 write(root,items);
 const file=path.join(dir(root),item.id+'.png');
 if(fs.existsSync(file))fs.rmSync(file,{force:true});
 return true;
}
module.exports={list,get,resolve,importFile,pasteImage,rename,setDefault,getWithFormat,remove};
