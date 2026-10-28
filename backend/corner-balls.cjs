'use strict';
// Un mismo balón vectorial se muestra en Electron y se rasteriza para FFmpeg.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const icon=path.resolve(__dirname,'../assets/soccer-corner.svg');
function calculate(wide,closing,appearance,testing,videoWidth,videoHeight){
 const W=testing?(wide?480:270):(wide?1920:1080);
 const maxW=(closing?(wide?540:820):(wide?420:400))*
  Math.max(.6,Math.min(1.5,(Number(appearance?.scale)||(closing?95:65))/(closing?95:65)))*W/(wide?1920:1080);
 const maxH=(closing?(wide?760:1150):(wide?730:750))*
  Math.max(.6,Math.min(1.5,(Number(appearance?.scale)||(closing?95:65))/(closing?95:65)))*W/(wide?1920:1080);
 const ratio=(videoWidth>0&&videoHeight>0)?videoWidth/videoHeight:1;
 const factor=Math.min(maxW/Math.max(1,videoWidth||1),maxH/Math.max(1,videoHeight||1));
 const w=Math.max(2,Math.round((videoWidth||1)*factor/2)*2);
 const h=Math.max(2,Math.round((videoHeight||1)*factor/2)*2);
 const outer=Math.max(3,Math.round(11*W/(wide?1920:1080)));
 const ballSize=Math.max(7,Math.min(Math.round(43*W/(wide?1920:1080)),Math.round(Math.min(w,h)/4)));
 return {videoWidth:w,videoHeight:h,outer,width:w+2*outer,height:h+2*outer,ballSize};
}
async function create(ctx,geometry){
 const {width,height,ballSize}=geometry;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||
  width>4000||height>4000)throw Error('Dimensiones de marco inválidas');
 const target=path.join(ctx,'balones-'+width+'x'+height+'.png');
 if(fs.existsSync(target))return target;
 const ball=await sharp(icon).resize(ballSize,ballSize).png().toBuffer();
 const positions=[
  {left:0,top:0},{left:width-ballSize,top:0},
  {left:0,top:height-ballSize},{left:width-ballSize,top:height-ballSize}
 ];
 await sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
  .composite(positions.map(p=>({input:ball,...p}))).png().toFile(target);
 return target;
}
module.exports={calculate,create,icon};
