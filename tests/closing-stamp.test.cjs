'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('soltar y mover el sello usa el tiempo de la pista ampliada y conserva un solo golpe',()=>{
 const handlers={},cursor={style:{}},track={getBoundingClientRect:()=>({left:-200,width:1000}),querySelector:()=>cursor};
 const scene={video:'toma',start:1,end:10,approved:true,cuts:[{mode:'both',start:7,end:8}]};
 const state={page:'project',scene:'closing',project:{scenes:{closing:scene}}};
 const context={state,document:{addEventListener:(k,f)=>handlers[k]=f},editorDuration:()=>10,
  WaveZoom:{timeAtPointer:(x,left,width,duration)=>(x-left)/width*duration},
  render(){},queueSave(){},notice(){}};
 const api=vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/closing-stamp.js'),'utf8')+'\nClosingStamp',context);
 const block={classList:{contains:()=>false}};
 const drag=(x)=>{
  const transfer={setData(){}};
  handlers.dragstart({target:{closest:()=>block},clientX:100,dataTransfer:transfer});
  handlers.drop({target:{closest:()=>track},clientX:x,dataTransfer:transfer,preventDefault(){}});
 };
 drag(200);assert.equal(api.timing(scene),4);assert.equal(scene.approved,false);
 block.classList.contains=()=>true;block.getBoundingClientRect=()=>({left:90});
 drag(410);assert.equal(api.timing(scene),6);
 drag(560);assert.equal(api.timing(scene),6);
 assert.equal(api.timing({...scene,video:'otra toma'}),null);
 api.place(null);assert.equal(api.timing(scene),null);
});
