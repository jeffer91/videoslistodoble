'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const sharp=require('sharp');
const store=require('../backend/store.cjs'),templates=require('../backend/templates.cjs'),shared=require('../backend/global-media.cjs');
const media=require('../backend/media.cjs');
function root(){return fs.mkdtempSync(path.join(os.tmpdir(),'11records-libraries-'))}
async function imageFile(folder,name='foto.png'){
 const file=path.join(folder,name);
 await sharp({create:{width:140,height:200,channels:4,background:'#268e5a'}}).png().toFile(file);return file;
}
test('biblioteca general reutiliza una copia en proyectos sin compartir borrados',{timeout:40000},async()=>{
 const dir=root();
 try{
  store.ensureRoot(dir);const file=await imageFile(dir);
  const item=await shared.importFile(dir,file);
  assert.equal(shared.list(dir).length,1);
  const p=store.createProject(dir,{title:'Proyecto 1'}),q=store.createProject(dir,{title:'Proyecto 2'});
  const a=store.importAsset(dir,p.id,shared.resolve(dir,item.id),item.name);
  const b=store.importAsset(dir,q.id,shared.resolve(dir,item.id),item.name);
  assert.notEqual(a.id,b.id);
  assert.equal(store.getProject(dir,p.id).assets.length,1);
  assert.equal(shared.remove(dir,item.id),true);
  assert.ok(fs.existsSync(store.resolveAsset(dir,p.id,a.id)));
  assert.ok(fs.existsSync(store.resolveAsset(dir,q.id,b.id)));
  assert.equal(store.removeAsset(dir,p.id,a.id),true);
  assert.ok(fs.existsSync(store.resolveAsset(dir,q.id,b.id)));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('fotografía permanece en el proyecto al quitarla de Desarrollo',{timeout:40000},async()=>{
 const dir=root();
 try{
  store.ensureRoot(dir);const p=store.createProject(dir,{title:'Mbappé'});
  const asset=store.importAsset(dir,p.id,await imageFile(dir));
  const project=store.getProject(dir,p.id);
  project.scenes.body.media=[{assetId:asset.id,start:0,end:0,speed:1}];
  store.saveProject(dir,project);
  assert.throws(()=>store.removeAsset(dir,p.id,asset.id),/en uso/);
  project.scenes.body.media=[];store.saveProject(dir,project);
  assert.equal(store.getProject(dir,p.id).assets.length,1);
  assert.ok(fs.existsSync(store.resolveAsset(dir,p.id,asset.id)));
  store.renameAsset(dir,p.id,asset.id,'Foto reutilizable');
  assert.equal(store.getProject(dir,p.id).assets[0].name,'Foto reutilizable');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('fondo de proyecto independiente por escena y compatible con referencias globales heredadas',{timeout:40000},async()=>{
 const dir=root();
 try{
  store.ensureRoot(dir);const p=store.createProject(dir,{title:'Escenas'});
  const img=store.importAsset(dir,p.id,await imageFile(dir));
  const sharedTemplate=await templates.importFile(dir,await imageFile(dir,'global.png'),'short');
  const project=store.getProject(dir,p.id);
  project.backgrounds.short=sharedTemplate.id;
  project.scenes.body.backgrounds={short:{scope:'project',assetId:img.id}};
  project.scenes.closing.backgrounds={short:null};
  store.saveProject(dir,project);
  const got=store.getProject(dir,p.id);
  assert.deepEqual(got.scenes.body.backgrounds.short,{scope:'project',assetId:img.id});
  assert.equal(got.scenes.hook.backgrounds.short,undefined);
  assert.equal(got.scenes.closing.backgrounds.short,null);
  assert.throws(()=>store.removeAsset(dir,p.id,img.id),/en uso/);
  got.scenes.body.backgrounds={};store.saveProject(dir,got);
  assert.equal(store.removeAsset(dir,p.id,img.id),true);
  const missing=store.getProject(dir,p.id);
  missing.scenes.body.backgrounds={short:{scope:'project',assetId:img.id}};
  assert.throws(()=>store.saveProject(dir,missing),/no encontrada/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('portapapeles global conserva imágenes y metadatos',{timeout:40000},async()=>{
 const dir=root();
 try{
  store.ensureRoot(dir);
  const buffer=await sharp({create:{width:88,height:100,channels:4,background:'#aaeefa'}}).png().toBuffer();
  const item=await shared.paste(dir,buffer);
  assert.equal(item.type,'image');
  assert.equal((await sharp(shared.resolve(dir,item.id)).metadata()).format,'png');
  shared.rename(dir,item.id,'Imagen de uso común');
  assert.equal(shared.get(dir,item.id).name,'Imagen de uso común');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('interfaz tiene dos bibliotecas con importación y referencias por escena',()=>{
 const rootFolder=path.join(__dirname,'..');
 const html=fs.readFileSync(path.join(rootFolder,'renderer','index.html'),'utf8');
 const js=fs.readFileSync(path.join(rootFolder,'renderer','app.js'),'utf8');
 const preview=fs.readFileSync(path.join(rootFolder,'backend','media.cjs'),'utf8');
 assert.match(html,/data-action="global-library"/);
 assert.match(html,/data-action="project-library"/);
 assert.match(js,/function globalLibraryPage\(\)/);
 assert.match(js,/function projectLibraryPage\(\)/);
 assert.match(js,/project-template-local/);
 assert.match(preview,/templateId\.scope==='project'/);
});
