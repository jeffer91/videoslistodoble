'use strict';
// Ajustar el borde a las dimensiones del video visible; sin espacios de relleno.
function presenterSize(videoWidth,videoHeight,stageWidth,stageHeight,wide=false,closing=false){
 const ratio=Math.max(.01,videoWidth/Math.max(1,videoHeight));
 const maxWidth=stageWidth*(closing?(wide?.50:.76):(wide?.23:.37));
 const maxHeight=stageHeight*(closing?(wide?.74:.59):(wide?.72:.54));
 const width=Math.max(1,Math.min(maxWidth,maxHeight*ratio));
 return {width,height:width/ratio};
}
function fitPresenterVideo(video){
 if(!video?.videoWidth||!video?.videoHeight)return;
 const holder=video.closest('[data-presenter-frame]'),stage=holder?.closest('.stage');
 if(!holder||!stage)return;
 const wide=stage.classList.contains('wide'),closing=stage.classList.contains('closing');
 const fit=presenterSize(video.videoWidth,video.videoHeight,stage.clientWidth,stage.clientHeight,wide,closing);
 holder.style.width=fit.width+'px';
 holder.style.aspectRatio=video.videoWidth+' / '+video.videoHeight;
 holder.dataset.aspect=(video.videoWidth/video.videoHeight).toFixed(4);
}
if(typeof document!=='undefined')document.addEventListener('loadedmetadata',e=>{
 if(e.target?.matches?.('[data-presenter-frame] > video.speaker'))fitPresenterVideo(e.target);
},true);

if(typeof module!=='undefined'&&module.exports)module.exports={presenterSize};
