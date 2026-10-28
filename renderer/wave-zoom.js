'use strict';
function clampZoom(value){return Math.max(1,Math.min(16,Math.round(Number(value)||1)))}
function widthFor(duration,viewportWidth,zoom){
 const seconds=Math.max(.01,Number(duration)||.01);
 const viewport=Math.max(1,Number(viewportWidth)||1);
 return Math.min(30000,Math.round(Math.max(590,viewport,seconds*4)*clampZoom(zoom)));
}
function scrollForTime(time,duration,contentWidth,viewportWidth){
 const total=Math.max(.01,Number(duration)||.01);
 const full=Math.max(0,Number(contentWidth)||0),view=Math.max(0,Number(viewportWidth)||0);
 return Math.max(0,Math.min(Math.max(0,full-view),Math.max(0,Math.min(total,Number(time)||0))/total*full-view/2));
}
function timeAtPointer(clientX,left,width,duration){
 return Math.max(0,Math.min(Math.max(0,Number(duration)||0),
  ((Number(clientX)||0)-(Number(left)||0))/Math.max(1,Number(width)||1)*(Number(duration)||0)));
}
const WaveZoom={clampZoom,widthFor,scrollForTime,timeAtPointer};
if(typeof module!=='undefined'&&module.exports)module.exports=WaveZoom;
if(typeof window!=='undefined')window.WaveZoom=WaveZoom;
