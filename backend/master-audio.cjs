'use strict';
// Ajustes de montaje sobre el vídeo ya ensamblado. La música nunca sustituye la voz.
const fs=require('node:fs');
const media=require('./media.cjs');
function settings(master={}){
 const speed=Number(master.speed??1),musicLevel=Number(master.musicLevel??18);
 if(![.5,.75,1,1.25,1.5,2].includes(speed))throw Error('Velocidad global inválida');
 if(!Number.isFinite(musicLevel)||musicLevel<0||musicLevel>40)throw Error('Volumen musical inválido');
 return {speed,musicLevel};
}
function filterGraph(master,hasMusic){
 const {speed,musicLevel}=settings(master);
 const filters=[];
 if(speed!==1)filters.push('[0:v]setpts=(PTS-STARTPTS)/'+speed+',fps=30,format=yuv420p[v]');
 if(hasMusic){
  // La narración controla cuánto desciende la pista musical. Conserva los silencios.
  filters.push('[0:a]atempo='+speed+',aresample=48000,asplit=2[narration][detector]');
  filters.push('[1:a]aresample=48000,loudnorm=I=-18:TP=-3:LRA=8,volume='+(musicLevel/100).toFixed(3)+'[bed]');
  filters.push('[bed][detector]sidechaincompress=threshold=0.024:ratio=9:attack=35:release=380[ducked]');
  filters.push('[narration][ducked]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]');
 }else filters.push('[0:a]atempo='+speed+',loudnorm=I=-16:TP=-1.5:LRA=11[a]');
 return filters.join(';');
}
async function render(input,output,master={},musicFile=null,signal){
 const {speed}=settings(master),hasMusic=Boolean(musicFile);
 const info=await media.probe(input),maxDuration=Math.max(.1,info.duration/speed);
 const args=['-hide_banner','-loglevel','error','-y','-i',input];
 if(hasMusic){
  if(!fs.existsSync(musicFile))throw Error('No se encontró la música de fondo');
  args.push('-stream_loop','-1','-i',musicFile);
 }
 args.push('-filter_complex',filterGraph(master,hasMusic),'-map',speed===1?'0:v:0':'[v]','-map','[a]');
 if(speed===1)args.push('-c:v','copy');
 else args.push('-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-r','30');
 args.push('-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t',maxDuration.toFixed(3),'-movflags','+faststart',output);
 await media.command(media.toolPath('ffmpeg'),args,signal);
 return output;
}
module.exports={settings,filterGraph,render};
