'use strict';
// Director visual determinista. Compartido por Electron y FFmpeg.
// No necesita red ni un servicio de IA: usa ritmo, escena, formato y variedad visual.
(function(root,factory){
 const director=factory();
 if(typeof module==='object'&&module.exports)module.exports=director;
 if(root&&typeof window!=='undefined')root.VisualDirector=director;
})(typeof window!=='undefined'?window:null,function(){
 const VERSION=1;
 const MODES=['push','pull','drift-left','drift-right','rise','fall'];
 const CUTS=['smoothleft','zoomin','hblur','diagtl','fade'];
 const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number(n)||0));
 function hash(s){
  let h=2166136261;
  for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}
  return h>>>0;
 }
 function config(value){
  const v=value||{};
  return {enabled:v.enabled!==false,revision:Math.max(0,Math.min(1000000,Math.floor(Number(v.revision)||0)))};
 }
 function move(mode,intensity,span){
  const scale=clamp(intensity,0,1);
  const delta=(.018+.03*scale)*clamp(span/4,.4,1.25);
  const drift=1.1+1.4*scale;
  const path={
   'push':{a:1.015,b:1.015+delta,x0:0,x1:0,y0:0,y1:0},
   'pull':{a:1.022+delta,b:1.018,x0:0,x1:0,y0:0,y1:0},
   'drift-left':{a:1.04,b:1.048,x0:drift,x1:-drift,y0:0,y1:0},
   'drift-right':{a:1.04,b:1.048,x0:-drift,x1:drift,y0:0,y1:0},
   'rise':{a:1.043,b:1.05,x0:0,x1:0,y0:drift,y1:-drift},
   'fall':{a:1.043,b:1.05,x0:0,x1:0,y0:-drift,y1:drift}
  };
  return {...path[mode],mode};
 }
 function easing(t){const x=clamp(t,0,1);return x*x*(3-2*x)}
 function interpolate(m,position){
  if(!m)return {scale:1,x:0,y:0};
  const p=easing(position);
  return {scale:m.a+(m.b-m.a)*p,x:m.x0+(m.x1-m.x0)*p,y:m.y0+(m.y1-m.y0)*p};
 }
 function choose(list,key,previous){
  const off=hash(key)%list.length;
  for(let i=0;i<list.length;i++){
   const v=list[(off+i)%list.length];
   if(v!==previous)return v;
  }
  return list[off];
 }
 function sequence({projectId='',sceneKey='body',segments=[],duration=0,settings={},format='short'}={}){
  const conf=config(settings);
  const revision=conf.revision;
  const seed=projectId+':'+sceneKey+':'+revision+':'+format;
  const backgroundKind=sceneKey==='closing'?'pull':sceneKey==='hook'?'push':
   choose(['push','pull','drift-right','drift-left'],seed+':back');
  const background=move(backgroundKind,sceneKey==='hook'?.55:.3,Math.max(3,duration));
  // Los planos de acción con video conservan su movimiento original.
  // Se evita repetir dirección y los cambios muy cortos quedan como cortes directos.
  let previous='',previousTransition='',lastAsset=null;
  const items=(segments||[]).map((segment,i)=>{
   const key=seed+':'+segment.assetId+':'+i;
   const span=Math.max(.05,(Number(segment.end)||0)-(Number(segment.start)||0));
   const still=segment.type==='image';
   const list=still?MODES:['push','pull'];
   const motion=still?move(choose(list,key,previous),.55,span):null;
   if(motion)previous=motion.mode;
   let effect='cut';
   const changed=Boolean(lastAsset&&segment.assetId&&segment.assetId!==lastAsset);
   if(changed&&span>.45){
    effect=choose(CUTS,key+':fx',previousTransition);
    previousTransition=effect;
   }
   if(segment.assetId)lastAsset=segment.assetId;
   return {assetId:segment.assetId||null,type:segment.type||null,
    start:Number(segment.start)||0,end:Number(segment.end)||0,
    sourceIndex:i,mode:motion?.mode||'none',motion,
    effect,duration:effect==='cut'?0:clamp(span*.11,.18,.42)};
  });
  return {version:VERSION,revision,enabled:conf.enabled,background:conf.enabled?background:null,
   items:conf.enabled?items.map(x=>x):items.map(x=>({...x,motion:null,effect:'cut',duration:0})),
   sceneKey,duration,format};
 }
 function transitions({projectId='',revision=0,settings={},chapters=[]}={}){
  const conf=config(settings);
  const choices=['smoothleft','zoomin','hblur','diagtl','fade'];
  let prior='';
  return ['hookBody','bodyClosing'].reduce((result,key,i)=>{
   const scene=chapters[i+1]||{};
   const energetic=(Number(scene.duration)||0)>12;
   const list=energetic?choices:['fade','smoothleft','zoomin'];
   const effect=choose(list,projectId+':'+revision+':'+key,prior);
   prior=effect;
   result[key]=conf.enabled?effect:'fade';
   return result;
  },{duration:.42});
 }
 function at(plan,time,assetId){
  const items=plan?.items||[];
  return items.find(x=>x.start<=time+.0001&&x.end>time-.0001&&(!assetId||x.assetId===assetId))||
   items.find(x=>x.assetId===assetId)||null;
 }
 return {VERSION,config,hash,sequence,transitions,interpolate,easing,at};
});
