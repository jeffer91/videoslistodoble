'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const store=require('../backend/store.cjs'),images=require('../backend/image-import.cjs');
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
test('guardar imágenes del portapapeles conserva recursos y verifica tipo',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'records-paste-'));
 try{
  store.ensureRoot(root);const p=store.createProject(root,{title:'Pegar'});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
  const item=store.saveImageBuffer(root,p.id,png);
  assert.equal(item.type,'image');
  assert.deepEqual(fs.readFileSync(store.resolveAsset(root,p.id,item.id)),png);
  assert.equal(store.getProject(root,p.id).assets.length,1);
  assert.throws(()=>store.saveImageBuffer(root,p.id,Buffer.from('invalid')),/PNG válida/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('SVG se convierte a PNG válido para renderizar',{timeout:40000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'records-svg-'));
 try{
  store.ensureRoot(root);const p=store.createProject(root,{title:'Formatos'});
  const f=path.join(root,'prueba.svg');
  fs.writeFileSync(f,'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#ffcc00"/></svg>');
  const item=await images.importImage(root,p.id,f,store);
  assert.match(item.name,/prueba\.svg/);
  assert.deepEqual(fs.readFileSync(store.resolveAsset(root,p.id,item.id)).subarray(0,8),PNG);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('lista extensiones comunes y avanzadas',()=>{
 assert.ok(images.IMAGE_EXTENSIONS.length>=30);
 for(const ext of ['.jfif','.tiff','.bmp','.tga','.ico','.avif','.heic','.svg','.psd','.dds','.jp2'])assert.ok(images.IMAGE_SET.has(ext));
});
