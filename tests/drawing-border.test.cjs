'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {drawingRect,repair}=require('../backend/drawing-border.cjs');
const store=require('../backend/store.cjs'),media=require('../backend/media.cjs');
test('recupera la foto de un dibujo antiguo sin modificar su MP4 original',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'records-paper-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 store.ensureRoot(root);const project=store.createProject(root,{title:'Marruecos'});
 const src=path.join(root,'ejemplo-pintura.mp4'),rect=drawingRect({width:200,height:200},184,120);
 assert.deepEqual(rect,{width:184,height:120,left:8,top:40});
 await media.command(media.toolPath('ffmpeg'),['-loglevel','error','-f','lavfi','-i','color=c=0xf5f0e8:s=200x200:r=24:d=1',
  '-vf','drawbox=x=8:y=40:w=184:h=120:color=blue:t=fill','-c:v','libx264','-pix_fmt','yuv420p',src]);
 const original=store.importAsset(root,project.id,src);
 const clean=await repair(root,{projectId:project.id,assetId:original.id});
 const after=await media.probe(store.resolveAsset(root,project.id,clean.id));
 assert.equal(after.width,184);assert.equal(after.height,120);assert.equal(after.duration,1);
 assert.equal((await media.probe(store.resolveAsset(root,project.id,original.id))).width,200);
});
