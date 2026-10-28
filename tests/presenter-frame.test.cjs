'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const {presenterSize}=require('../renderer/presenter-frame.js');
test('el marco encaja con la grabación cuadrada',()=>{
 const r=presenterSize(720,720,300,533,false,false);
 assert.ok(Math.abs(r.width-r.height)<.01);
 assert.ok(Math.abs(r.width-111)<.01);
});
test('el video vertical mantiene su proporción y el cierre tiene marco mayor',()=>{
 const p=presenterSize(720,1280,300,533,false,false),c=presenterSize(720,720,300,533,false,true);
 assert.ok(Math.abs(p.width/p.height-.5625)<.001);
 assert.ok(c.width>p.width);
 assert.ok(c.height<=533*.59);
 const w=presenterSize(720,720,510,287,true,true);
 assert.ok(w.width<=287*.74);
});
test('editor, revisión y exportación usan el mismo tipo de marco',()=>{
 const read=name=>fs.readFileSync(path.join(root,name),'utf8');
 assert.match(read('renderer/app.js'),/data-presenter-frame/);
 assert.match(read('renderer/live-review.js'),/data-presenter-frame/);
 assert.match(read('renderer/style.css'),/\.presenter-frame > video\.speaker/);
 assert.match(read('renderer/style.css'),/object-fit:cover!important/);
 assert.match(read('backend/media.cjs'),/drawbox=x=0:y=0:w=iw:h=ih/);
 assert.doesNotMatch(read('backend/media.cjs'),/drawtext=text=11 RECORDS/);
 assert.match(read('renderer/app.js'),/corner-top-left/);
 assert.match(read('renderer/live-review.js'),/corner-bottom-right/);
 assert.match(read('renderer/style.css'),/soccer-corner\.svg/);
});

test('el PNG para FFmpeg utiliza cuatro balones vectoriales sin etiquetas',{timeout:30000},async()=>{
 const os=require('node:os'),sharp=require('sharp');
 const {calculate,create}=require('../backend/corner-balls.cjs');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'records-balls-'));
 try{
  const bounds=calculate(false,false,{scale:65,frame:'sport'},true,720,720);
  assert.equal(bounds.videoWidth,bounds.videoHeight);
  const file=await create(folder,bounds),meta=await sharp(file).metadata();
  assert.equal(meta.width,bounds.width);
  assert.equal(meta.height,bounds.height);
  assert.ok(fs.statSync(file).size>300);
  assert.equal(await create(folder,bounds),file);
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const alphaAt=(x,y)=>data[(y*info.width+x)*info.channels+3];
  assert.ok(alphaAt(Math.floor(bounds.ballSize/2),Math.floor(bounds.ballSize/2))>50);
  assert.equal(alphaAt(Math.floor(bounds.width/2),Math.floor(bounds.height/2)),0);
 }finally{fs.rmSync(folder,{recursive:true,force:true})}
});
