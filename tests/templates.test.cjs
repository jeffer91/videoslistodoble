'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const sharp=require('sharp');
const store=require('../backend/store.cjs');
const backgrounds=require('../backend/templates.cjs');
const media=require('../backend/media.cjs');
function root(){return fs.mkdtempSync(path.join(os.tmpdir(),'11-records-plantillas-'))}
test('biblioteca guarda fondos PNG normalizados y conserva el original',{timeout:30000},async()=>{
 const dir=root();
 try{
  store.ensureRoot(dir);
  const original=path.join(dir,'fondo.svg');
  fs.writeFileSync(original,'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600"><rect width="900" height="1600" fill="#dca32b"/></svg>');
  const item=await backgrounds.importFile(dir,original,'short');
  assert.equal(item.format,'short');
  assert.equal(backgrounds.list(dir).length,1);
  assert.equal(path.extname(backgrounds.resolve(dir,item.id,'short')),'.png');
  assert.equal((await sharp(backgrounds.resolve(dir,item.id)).metadata()).format,'png');
  assert.equal(fs.readFileSync(original,'utf8').startsWith('<svg'),true);
  assert.throws(()=>backgrounds.resolve(dir,item.id,'wide'),/formato/);
  assert.throws(()=>backgrounds.resolve(dir,'../../windows/system.ini'),/Identificador/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('predeterminados independientes: nuevos proyectos sí, antiguos no',{timeout:30000},async()=>{
 const dir=root();
 try{
  store.ensureRoot(dir);
  const old=store.createProject(dir,{title:'Anterior'});
  const shortFile=path.join(dir,'fondo.png');
  await sharp({create:{width:108,height:192,channels:4,background:'#102c19'}}).png().toFile(shortFile);
  const a=await backgrounds.importFile(dir,shortFile,'short');
  const b=await backgrounds.importFile(dir,shortFile,'wide');
  backgrounds.setDefault(dir,'short',a.id,store);
  backgrounds.setDefault(dir,'wide',b.id,store);
  const fresh=store.createProject(dir,{title:'Nuevo'});
  assert.deepEqual(fresh.backgrounds,{short:a.id,wide:b.id});
  assert.deepEqual(store.getProject(dir,old.id).backgrounds,{short:null,wide:null});
  fresh.backgrounds.wide=null;
  store.saveProject(dir,fresh);
  assert.equal(store.getProject(dir,fresh.id).backgrounds.wide,null);
  fresh.backgrounds.wide=a.id;
  assert.throws(()=>store.saveProject(dir,fresh),/formato/);
  backgrounds.rename(dir,b.id,'Horizontal dorado');
  assert.equal(backgrounds.get(dir,b.id).name,'Horizontal dorado');
  assert.throws(()=>backgrounds.remove(dir,a.id,store),/predeterminado/);
  backgrounds.setDefault(dir,'short',null,store);
  assert.throws(()=>backgrounds.remove(dir,a.id,store),/utiliza en el proyecto/);
  const copy=store.getProject(dir,fresh.id);
  copy.backgrounds.short=null;store.saveProject(dir,copy);
  assert.equal(backgrounds.remove(dir,a.id,store),true);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('portapapeles copia imagen en biblioteca global',{timeout:30000},async()=>{
 const dir=root();
 try{
  store.ensureRoot(dir);
  const buffer=await sharp({create:{width:300,height:300,channels:3,background:'#008855'}}).png().toBuffer();
  const result=await backgrounds.pasteImage(dir,buffer,'short');
  assert.equal(result.format,'short');
  assert.equal((await sharp(backgrounds.resolve(dir,result.id,'short')).metadata()).width,300);
  assert.equal(store.listProjects(dir).length,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('render FFmpeg usa fondo propio sin desenfoque y deja el medio de apoyo al frente',()=>{
 const original=media.fillAndContain(null,false,true,'titulos.txt',false,{},1,'historic');
 const selected=media.fillAndContain(null,false,true,'titulos.txt',false,{},1,'historic',false,2);
 assert.match(original,/boxblur/);
 assert.doesNotMatch(selected,/boxblur/);
 assert.match(selected,/\[2:v\]scale=\d+:\d+:/);
 assert.match(selected,/\[1:v\]scale=930:1160/);
 assert.match(selected,/\[0:v\]scale=/);
 assert.match(selected,/\[blur\]\[center\]overlay/);
 assert.match(selected,/\[base\]\[speaker\]overlay/);
});
test('vista previa contiene biblioteca y selector de fondo por proyecto',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','renderer','app.js'),'utf8');
 assert.match(source,/class="template-back"/);
 assert.match(source,/data-action="project-template-select"/);
 assert.match(source,/templates:set-default/);
 assert.match(source,/function templateGallery/);
});
