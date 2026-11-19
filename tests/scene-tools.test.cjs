'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../renderer/app.js'),'utf8');
test('las herramientas de escena separan grabación, cortes A/B e imágenes con referencia de voz',()=>{
 const scene={video:'voice',end:8,media:[]};
 const state={project:{assets:[{id:'voice',name:'Toma'}],scenes:{closing:scene}},scene:'closing',
  waveforms:{},waveErrors:{},cutUndo:[],cutRedo:[],cutZoom:1};
 const ctx={state,names:{closing:'Cierre'},selectedTemplate:()=>null,btn:(a,l)=>'<button data-action="'+a+'">'+l+'</button>',
  esc:String,fmt:String,rangeSelection:()=>({start:0,end:1}),editorDuration:()=>8,WaveZoom:require('../renderer/wave-zoom.js'),
  $:()=>({currentTime:4}),mediaRows:()=>'',PhotoTrack:{track:()=>'<div class="photo-track"></div>'},
  ClosingStamp:{track:()=>'<div class="stamp-track"></div>',controls:()=>''}};
 const panel=vm.runInNewContext(source.slice(source.indexOf('function makeWaveTicks'),source.indexOf('function selectedTemplate'))+
   source.slice(source.indexOf('const sceneTools='),source.indexOf('function sceneView'))+'\nscenePanelHTML',ctx);
 state.editorPanel='recording';const take=panel();
 assert.match(take,/start-recorder/);assert.doesNotMatch(take,/cut-marker-a|photo-add/);
 state.editorPanel='audio';const cut=panel();
 assert.match(cut,/cut-marker-a/);assert.match(cut,/cut-add/);assert.doesNotMatch(cut,/photo-track|stamp-track|photo-add|start-recorder/);
 state.editorPanel='resources';const images=panel();
 assert.match(images,/photo-add/);assert.match(images,/photo-track/);assert.match(images,/stamp-track/);
 assert.match(images,/Narración de referencia/);assert.match(images,/wave-playhead" style="left:50%/);
 assert.doesNotMatch(images,/cut-marker-a|cut-add|start-recorder/);
});
