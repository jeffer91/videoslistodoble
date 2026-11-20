'use strict';
// Ajustes de montaje sobre el vídeo ya ensamblado. La música nunca sustituye la voz.
const fs=require('node:fs');
const media=require('./media.cjs');
function settings(master={}){
 const speed=require('./store.cjs').exportSpeed(master.speed),musicLevel=Number(master.musicLevel??18);
 if(!Number.isFinite(musicLevel)||musicLevel<0||musicLevel>40)throw Error('Volumen musical inválido');
 return {speed,musicLevel};
}
// Volumen de redes: YouTube, TikTok, Instagram y Facebook reproducen a unos −14 LUFS.
const TARGET=-14;
const MEASURE='loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json';
/** Ganancia exacta y limitador de picos (−1,5 dB): el volumen no «respira» como con loudnorm dinámico. */
function gainFilter(gain){
 return 'volume='+Math.max(-20,Math.min(20,gain)).toFixed(2)+'dB,alimiter=limit=0.84:attack=4:release=60:level=false:asc=1';
}
function readMeasure(stderr){
 const json=stderr.match(/\{\s*"input_i"[\s\S]*?\}/g)?.at(-1);
 if(!json)return null;
 const value=Number(JSON.parse(json).input_i);
 return Number.isFinite(value)&&value>-70?value:null;
}
/**
 * Calcula la ganancia final en dos mediciones solo de audio: la segunda incluye el limitador,
 * que resta volumen en voces con muchos picos, y se compensa esa diferencia.
 */
async function targetGain(measure){
 const first=await measure(MEASURE);
 if(first===null)return null;
 let gain=TARGET-first;
 const second=await measure(gainFilter(gain)+','+MEASURE);
 if(second!==null)gain+=Math.max(-3,Math.min(4,TARGET-second));
 return gain;
}
function loudness(gain){return gain===null||gain===undefined?'loudnorm=I=-14:TP=-1.5:LRA=11':gainFilter(gain)}
function filterGraph(master,hasMusic,end='loudnorm=I=-14:TP=-1.5:LRA=11',video=true){
 const {speed,musicLevel}=settings(master);
 const filters=[];
 if(video&&speed!==1)filters.push('[0:v]setpts=(PTS-STARTPTS)/'+speed+',fps=30,format=yuv420p[v]');
 if(hasMusic){
  // La narración controla cuánto desciende la pista musical. Conserva los silencios.
  filters.push('[0:a]atempo='+speed+',aresample=48000,asplit=2[narration][detector]');
  // Hueco en las frecuencias de la voz: la música suena llena y la voz queda delante.
  filters.push('[1:a]aresample=48000,loudnorm=I=-18:TP=-3:LRA=8,equalizer=f=2600:t=q:w=1.4:g=-5,equalizer=f=1000:t=q:w=1.2:g=-2,volume='+(musicLevel/100).toFixed(3)+'[bed]');
  filters.push('[bed][detector]sidechaincompress=threshold=0.024:ratio=9:attack=35:release=380[ducked]');
  filters.push('[narration][ducked]amix=inputs=2:duration=first:normalize=0,'+STEREO+end+'[a]');
 }else filters.push('[0:a]atempo='+speed+','+STEREO+end+'[a]');
 return filters.join(';');
}
// Se mide ya en estéreo a 48 kHz: lo mismo que se codifica (pasar de mono a estéreo después sube el volumen).
const STEREO='aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,';
const NULL=process.platform==='win32'?'NUL':'-';
async function render(input,output,master={},musicFile=null,signal){
 const {speed}=settings(master),hasMusic=Boolean(musicFile);
 const info=await media.probe(input),maxDuration=Math.max(.1,info.duration/speed);
 const inputs=['-i',input];
 if(hasMusic){
  if(!fs.existsSync(musicFile))throw Error('No se encontró la música de fondo');
  inputs.push('-stream_loop','-1','-i',musicFile);
 }
 let gain=null;
 try{
  gain=await targetGain(async end=>readMeasure((await media.command(media.toolPath('ffmpeg'),['-hide_banner','-nostats',...inputs,
   '-filter_complex',filterGraph(master,hasMusic,end,false),'-map','[a]','-t',maxDuration.toFixed(3),'-f','null',NULL],signal)).stderr));
 }catch(error){if(signal?.aborted)throw error}
 const args=['-hide_banner','-loglevel','error','-y',...inputs];
 args.push('-filter_complex',filterGraph(master,hasMusic,loudness(gain)),'-map',speed===1?'0:v:0':'[v]','-map','[a]');
 if(speed===1)args.push('-c:v','copy');
 else args.push('-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-r','30');
 args.push('-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t',maxDuration.toFixed(3),'-movflags','+faststart',output);
 await media.command(media.toolPath('ffmpeg'),args,signal);
 return output;
}
module.exports={settings,filterGraph,loudness,readMeasure,targetGain,gainFilter,render};
