'use strict';
const path=require('node:path'),fs=require('node:fs');
const sharp=require('sharp');
const media=require('./media.cjs'),store=require('./store.cjs');
const STYLES=['still','in','out','pan','lapiz','pintura','profundidad','destacado','impacto'];
// Modelo U²-Net que separa al protagonista del fondo (Profundidad 2.5D y Jugador destacado).
const SUBJECT={url:'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx',
 sha256:'8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491',limit:200*1024*1024,label:'el modelo de recorte'};
async function subjectModel(root,signal){
 if(process.env.RECORDS_SUBJECT_MODEL!==undefined)return process.env.RECORDS_SUBJECT_MODEL||null;
 return require('./verified-download.cjs').ensure(path.join(root,'Recursos','Modelos','u2net.onnx'),SUBJECT,signal);
}

async function generate(root,options,signal,drawingRuntime){
 const {projectId,assetId,style,seconds,glow,focus,crop}=options;
 if(!STYLES.includes(style)||!Number.isFinite(seconds)||seconds<1||seconds>180)
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
   // Movimientos de cámara y efectos con capas: motor de animación (fotogramas con precisión de subpíxel).
   const runtime=await drawingRuntime();
   let model=null;
   if(['profundidad','destacado'].includes(style)){
    try{model=await subjectModel(root,signal)}catch(error){if(signal?.aborted)throw error}
   }
   const options=JSON.stringify({focus,glow:Boolean(glow),model});
   await media.command(runtime.exe,[...runtime.args,file,output,style,String(seconds),media.toolPath('ffmpeg'),options],signal);
  }
  const duration=(await media.probe(output)).duration;
  return {asset:store.importAsset(root,projectId,output,path.parse(asset.name).name+'-'+style+'.mp4'),duration};
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
module.exports={generate,STYLES,SUBJECT};
