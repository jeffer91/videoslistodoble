'use strict';
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const media=require('./media.cjs'),store=require('./store.cjs');

async function cropClip(source,output,rect,signal){
 const {width,height,left,top}=rect;
 await media.command(media.toolPath('ffmpeg'),['-loglevel','error','-y','-i',source,'-vf',
  'crop='+width+':'+height+':'+left+':'+top+',setsar=1','-map','0:v:0','-map','0:a?',
  '-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',output],signal);
}
function drawingRect(canvas,w,h){
 // The drawing engine fits the opaque photograph inside 92% of its square paper.
 const scale=Math.min(canvas.width*.92/w,canvas.height*.92/h);
 const width=Math.max(2,2*Math.floor(w*scale/2)),height=Math.max(2,2*Math.floor(h*scale/2));
 return {width,height,left:Math.round((canvas.width-width)/2),top:Math.round((canvas.height-height)/2)};
}
async function repair(root,{projectId,assetId},signal){
 const asset=store.getProject(root,projectId).assets.find(a=>a.id===assetId && a.type==='video');
 if(!asset)throw Error('Selecciona un clip de dibujo.');
 const source=store.resolveAsset(root,projectId,assetId),tmp=media.temporary(root);
 try{
  const frame=path.join(tmp,'final.png'),output=path.join(tmp,'sin-marco.mp4');
  await media.command(media.toolPath('ffmpeg'),['-loglevel','error','-sseof','-0.25','-i',source,'-frames:v','1',frame],signal);
  const {data,info:{width:w,height:h}}=await sharp(frame).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  const paper=[245,240,232];
  const rows=new Uint32Array(h),cols=new Uint32Array(w);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=3*(y*w+x);
   if(paper.some((value,c)=>Math.abs(value-data[i+c])>20)){rows[y]++;cols[x]++;}
  }
  const left=cols.findIndex(n=>n>h*.015),right=cols.findLastIndex(n=>n>h*.015);
  const top=rows.findIndex(n=>n>w*.015),bottom=rows.findLastIndex(n=>n>w*.015);
  if(left<2||top<2||right>w-3||bottom>h-3||right-left<w*.08||bottom-top<h*.08)
   throw Error('No se identificó un marco de papel uniforme en este clip.');
  await cropClip(source,output,{left,top,width:2*Math.floor((right-left+1)/2),height:2*Math.floor((bottom-top+1)/2)},signal);
  return store.importAsset(root,projectId,output,'Dibujo sin marco.mp4');
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
module.exports={cropClip,drawingRect,repair};
