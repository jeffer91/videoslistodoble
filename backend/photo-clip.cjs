'use strict';
const path=require('node:path'),fs=require('node:fs');
const sharp=require('sharp');
const media=require('./media.cjs'),store=require('./store.cjs');

async function generate(root,options,signal,drawingRuntime){
 const {projectId,assetId,style,seconds,glow,focus,crop}=options;
 if(!['still','in','out','pan','lapiz','pintura'].includes(style)||!Number.isFinite(seconds)||seconds<1||seconds>180)
  throw Error('Selecciona un efecto y una duración entre 1 y 180 segundos.');
 if(!Array.isArray(crop)||crop.length!==4||!crop.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||
   crop[2]-crop[0]<.02||crop[3]-crop[1]<.02||!Array.isArray(focus)||focus.length!==2||!focus.every(v=>Number.isFinite(v)&&v>=0&&v<=1))
  throw Error('Encuadre inválido.');
 const p=store.getProject(root,projectId),asset=p.assets.find(x=>x.id===assetId&&x.type==='image');
 if(!asset)throw Error('Selecciona una foto del proyecto.');
 const tmp=media.temporary(root);
 try{
  const source=store.resolveAsset(root,projectId,assetId);
  const {data,info}=await sharp(source).rotate().png().toBuffer({resolveWithObject:true});
  const x=Math.floor(crop[0]*info.width),y=Math.floor(crop[1]*info.height);
  const file=path.join(tmp,'encuadre.png');
  const rect={left:x,top:y,width:Math.max(1,Math.round(crop[2]*info.width)-x),height:Math.max(1,Math.round(crop[3]*info.height)-y)};
  const cropped=await sharp(data).extract(rect).resize({width:1440,height:1440,fit:'inside'}).png().toFile(file);
  const output=path.join(tmp,'clip.mp4');
  if(['lapiz','pintura'].includes(style)){
   const runtime=await drawingRuntime();
   const paper=path.join(tmp,'papel.mp4');
   await media.command(runtime.exe,[...runtime.args,file,paper,style,String(Math.max(3,seconds)),media.toolPath('ffmpeg')],signal);
   const border=require('./drawing-border.cjs');
   await border.cropClip(paper,output,border.drawingRect(await media.probe(paper),cropped.width,cropped.height),signal);
  }else{
   const frames=Math.ceil(seconds*30),progress='min(1,on/'+Math.max(1,frames-1)+')';
   const z={in:'1+0.18*'+progress,out:'1.18-0.18*'+progress,pan:'1.15',still:'1'}[style];
   const w=Math.max(2,2*Math.round(540*rect.width/Math.max(rect.width,rect.height)));
   const h=Math.max(2,2*Math.round(540*rect.height/Math.max(rect.width,rect.height)));
   const fx=style==='pan'?progress:String(focus[0]);
   let filter="zoompan=z='"+z+"':x='(iw-iw/zoom)*("+fx+")':y='(ih-ih/zoom)*"+focus[1]+"':d="+frames+":s="+w+"x"+h+":fps=30";
   if(glow)filter+=",eq=brightness='0.08*pow(sin(PI*t/"+seconds+"),8)':eval=frame";
   await media.command(media.toolPath('ffmpeg'),['-loglevel','error','-y','-i',file,'-vf',filter,'-frames:v',String(frames),'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-movflags','+faststart',output],signal);
  }
  const duration=(await media.probe(output)).duration;
  return {asset:store.importAsset(root,projectId,output,path.parse(asset.name).name+'-'+style+'.mp4'),duration};
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
module.exports={generate};
