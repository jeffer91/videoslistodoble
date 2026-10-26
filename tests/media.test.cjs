'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {retainedRanges,selectedDuration,timeline}=require('../backend/media.cjs');
test('silencios se eliminan solo si están marcados en rojo',()=>{
 const scene={start:1,end:10,silences:[
  {start:2,end:3,remove:true},
  {start:4,end:4.5,remove:false},
  {start:7,end:8,remove:true}
 ]};
 const ranges=retainedRanges(scene,12);
 assert.deepEqual(ranges,[{start:1,end:2},{start:3,end:7},{start:8,end:10}]);
 assert.equal(selectedDuration(scene,12),7);
});
test('recursos se distribuyen sin perder tramo de narración',()=>{
 const scene={start:0,end:10,silences:[],media:[]};
 const pieces=timeline(scene,10,[{type:'image',id:'1'},{type:'image',id:'2'}]);
 assert.equal(Math.round(pieces.reduce((n,p)=>n+p.end-p.start,0)),10);
 assert.equal(pieces[0].medium.id,'1');
 assert.equal(pieces.at(-1).medium.id,'2');
});
