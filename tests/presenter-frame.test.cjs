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
});
