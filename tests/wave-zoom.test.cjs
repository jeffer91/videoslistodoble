'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const zoom=require('../renderer/wave-zoom.js');
test('ampliar multiplica realmente el ancho visible de la onda',()=>{
 assert.equal(zoom.widthFor(45.671,830,1),830);
 assert.equal(zoom.widthFor(45.671,830,4),3320);
 assert.equal(zoom.widthFor(45.671,830,16),13280);
 assert.equal(zoom.clampZoom(0),1);assert.equal(zoom.clampZoom(20),16);
});
test('el segmento final sigue localizable tras ampliar',()=>{
 const seconds=45.671,width=zoom.widthFor(seconds,830,8),left=zoom.scrollForTime(45,seconds,width,830);
 assert.ok(left>0);
 const center=(left+830/2)/width*seconds;
 assert.ok(Math.abs(center-45)<.03);
 assert.equal(zoom.timeAtPointer(-5,100,830,seconds),0);
 assert.ok(zoom.timeAtPointer(515,100,830,seconds)>22);
});
test('la interfaz utiliza los controles de zoom y evita recrear la grabación',()=>{
 const src=fs.readFileSync(path.join(__dirname,'..','renderer','app.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'..','renderer','index.html'),'utf8');
 assert.match(src,/el\.dataset\.cutZoom!==undefined/);
 assert.match(src,/setCutZoom\(el\.value\)/);
 assert.match(src,/wave-zoom-fit/);
 assert.match(html,/wave-zoom\.js/);
});
