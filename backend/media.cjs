'use strict';
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{spawn}=require('node:child_process');
const store=require('./store.cjs');
const templates=require('./templates.cjs');
const logoTools=require('./logo.cjs');
const bins={};
function toolPath(which){
 if(bins[which])return bins[which];
 let p=which==='ffmpeg'?(require('ffmpeg-static')):(require('ffprobe-static').path);
 if(!p)throw Error('No se encontró '+which);
 p=p.replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
 return bins[which]=p;
}
async function command(exe,args,signal,onLine,cwd){
 return new Promise((resolve,reject)=>{
  const child=spawn(exe,args,{cwd:cwd||undefined,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stderr='',stdout='',done=false;
  const hardLimit=process.env.RECORDS_RENDER_TEST_MODE==='1'?15000:0;
  const timer=hardLimit?setTimeout(()=>{child.kill('SIGKILL');finish(Error('Proceso multimedia agotó tiempo de prueba: '+args.slice(0,7).join(' ')+' '+stderr.slice(-700)))},hardLimit):null;
  const onAbort=()=>child.kill('SIGTERM');
  if(signal){if(signal.aborted)child.kill('SIGTERM');signal.addEventListener('abort',onAbort,{once:true})}
  child.stdout.on('data',d=>{stdout+=d.toString();if(stdout.length>250000)stdout=stdout.slice(-250000)});
  child.stderr.on('data',d=>{const s=d.toString();stderr=(stderr+s).slice(-70000);if(onLine)onLine(s)});
  child.on('error',e=>finish(e));
  child.on('close',code=>finish(code===0?null:Error((signal&&signal.aborted?'Cancelado. ':'' )+(stderr.slice(-1800)||'Proceso terminado con código '+code))));
  function finish(err){if(done)return;done=true;if(timer)clearTimeout(timer);if(signal)signal.removeEventListener('abort',onAbort);if(err)reject(err);else resolve({stdout,stderr})}
 });
}
async function probe(file){
 const r=await command(toolPath('ffprobe'),['-v','error','-show_entries',
  'format=duration:stream=codec_type,duration','-of','json',file]);
 const data=JSON.parse(r.stdout),streams=data.streams||[];
 const numeric=x=>Number.isFinite(Number(x))&&Number(x)>0?Number(x):0;
 let duration=Math.max(numeric(data.format?.duration),...streams.map(s=>numeric(s.duration)),0);
 // MediaRecorder de Electron genera WebM sin duración en los encabezados.
 // Recuperamos el tiempo del último paquete real sin alterar la grabación.
 if(!duration){
  const packets=await command(toolPath('ffprobe'),['-v','error','-select_streams','v:0',
   '-show_entries','packet=pts_time,dts_time,duration_time','-of','compact=p=0:nk=0',file]);
  for(const line of packets.stdout.split(/\r?\n/)){
   const pts=/\bpts_time=([0-9.]+)/.exec(line)||/\bdts_time=([0-9.]+)/.exec(line);
   if(!pts)continue;
   const packetDuration=/\bduration_time=([0-9.]+)/.exec(line);
   duration=Math.max(duration,Number(pts[1])+(packetDuration?Number(packetDuration[1]):0));
  }
 }
 return {duration,hasAudio:streams.some(x=>x.codec_type==='audio')};
}
async function detectSilences(file,threshold){
 const sec=Math.max(.5,Math.min(5,Number(threshold)||.5));
 const duration=(await probe(file)).duration;
 const r=await command(toolPath('ffmpeg'),['-hide_banner','-nostats','-i',file,'-af','silencedetect=noise=-34dB:d='+sec,'-f','null',process.platform==='win32'?'NUL':'-']);
 const starts=[...r.stderr.matchAll(/silence_start:\s*([0-9.]+)/g)].map(m=>Number(m[1]));
 const ends=[...r.stderr.matchAll(/silence_end:\s*([0-9.]+)/g)].map(m=>Number(m[1]));
 return starts.map((s,i)=>({start:Math.max(0,s),end:Math.min(duration,ends[i]??duration),remove:true})).filter(s=>s.end-s.start>=sec-.05);
}
async function waveform(file){
 return new Promise((resolve,reject)=>{
  const child=spawn(toolPath('ffmpeg'),['-hide_banner','-loglevel','error','-i',file,'-vn','-ac','1','-ar','100','-t','180','-c:a','pcm_s16le','-f','s16le','pipe:1'],{windowsHide:true});
  let parts=[],errors='',size=0;
  child.stdout.on('data',d=>{size+=d.length;if(size<=1000000)parts.push(d)});
  child.stderr.on('data',d=>errors+=d.toString().slice(-2000));
  child.on('error',reject);
  child.on('close',code=>{
   if(code!==0)return reject(Error('No se pudo leer la forma de onda: '+errors.slice(-180)));
   const bytes=Buffer.concat(parts),out=[];
   for(let k=0;k+1<bytes.length;k+=20){
    let n=0,sum=0;
    for(let j=k;j<Math.min(bytes.length-1,k+20);j+=2){const v=bytes.readInt16LE(j)/32768;sum+=v*v;n++}
    out.push(Math.min(1,Math.sqrt(Math.sqrt(sum/Math.max(1,n)))*1.3));
   }
   resolve(out.slice(0,1800));
  });
 });
}
function retainedRanges(scene,realDuration){
 const first=Math.max(0,Number(scene?.start)||0);
 const end=Math.min(realDuration,Number(scene?.end)>first?Number(scene.end):realDuration);
 if(!(end>first))return [];
 const toRemove=[...(scene.silences||[]).filter(x=>x.remove),...(scene.cuts||[]).filter(x=>x.mode==='both')].map(x=>({start:Math.max(first,Number(x.start)||0),end:Math.min(end,Number(x.end)||0)})).filter(x=>x.end>x.start).sort((a,b)=>a.start-b.start);
 const intervals=[];let at=first;
 for(const gap of toRemove){if(gap.start>at+.04)intervals.push({start:at,end:gap.start});at=Math.max(at,gap.end)}
 if(end>at+.04)intervals.push({start:at,end});
 return intervals.filter(x=>x.end-x.start>.05);
}
function selectedDuration(scene,dur){return retainedRanges(scene,dur).reduce((n,x)=>n+x.end-x.start,0)}
function sanitizeTitle(title){return String(title||'RÉCORD DEL FÚTBOL').replace(/[\r\n\t]/g,' ').trim().slice(0,92)}
function chooseMedia(scene){return scene.media||[]}
// Divide en los límites de recortes por pista; el audio y el video conservan el mismo reloj.
// Las acciones audio/video no acortan el archivo. Únicamente 'both' quita tiempo.
function splitByEdits(entries,cuts=[]){
 const edits=cuts.filter(c=>c&&['audio','video'].includes(c.mode)&&Number(c.end)>Number(c.start));
 const result=[];
 for(const entry of entries){
  const bounds=[entry.start,entry.end];
  for(const c of edits){
   if(c.end<=entry.start||c.start>=entry.end)continue;
   bounds.push(Math.max(entry.start,Number(c.start)),Math.min(entry.end,Number(c.end)));
  }
  bounds.sort((a,b)=>a-b);
  for(let i=0;i<bounds.length-1;i++){
   const start=bounds[i],end=bounds[i+1];
   if(end-start<0.0001)continue;
   const mid=(start+end)/2;
   const muted=edits.some(c=>c.mode==='audio'&&mid>=c.start&&mid<c.end);
   const frozen=edits.some(c=>c.mode==='video'&&mid>=c.start&&mid<c.end);
   result.push({...entry,start,end,
    mediaStart:entry.medium?.type==='video'?(Number(entry.mediaStart)||0)+(start-entry.start)*(Number(entry.speed)||1):entry.mediaStart,
    muteAudio:muted,freezeVideo:frozen});
  }
 }
 return result;
}

const crypto=require('node:crypto');
const previewPromises=new Map();
async function preparePreview(root,projectId,assetId,force=false){
 const source=store.resolveAsset(root,projectId,assetId);
 const asset=store.getProject(root,projectId).assets.find(a=>a.id===assetId);
 if(!asset||asset.type!=='video')throw Error('El recurso no es un video');
 const stat=fs.statSync(source);
 const fingerprint=crypto.createHash('sha256').update(String(stat.size)+':'+String(stat.mtimeMs)).digest('hex').slice(0,12);
 const folder=path.join(root,'Proyectos',projectId,'Previews');
 const out=path.join(folder,assetId+'-'+fingerprint+'.mp4');
 if(!force&&fs.existsSync(out)&&fs.statSync(out).size>1000)return {url:'records://preview/'+encodeURIComponent(projectId)+'/'+encodeURIComponent(assetId),duration:(await probe(out)).duration};
 const key=projectId+':'+assetId+':'+fingerprint;
 if(!previewPromises.has(key)){
  previewPromises.set(key,(async()=>{
   fs.mkdirSync(folder,{recursive:true});
   const temp=path.join(folder,assetId+'-'+fingerprint+'-'+crypto.randomUUID()+'.tmp.mp4');
   try{
    await command(toolPath('ffmpeg'),['-hide_banner','-loglevel','error','-y',
     '-fflags','+genpts','-i',source,
     '-map','0:v:0','-map','0:a:0?','-vf','fps=30,format=yuv420p',
     '-c:v','libx264','-preset','veryfast','-crf','24',
     '-c:a','aac','-b:a','128k','-ar','48000',
     '-avoid_negative_ts','make_zero','-movflags','+faststart',
     '-max_muxing_queue_size','1024',temp]);
    if(!fs.existsSync(temp)||fs.statSync(temp).size<1000)throw Error('No se produjo un video compatible');
    if(force&&fs.existsSync(out))fs.rmSync(out,{force:true});
    fs.renameSync(temp,out);
   }finally{if(fs.existsSync(temp))fs.rmSync(temp,{force:true})}
  })().finally(()=>previewPromises.delete(key)));
 }
 await previewPromises.get(key);
 return {url:'records://preview/'+encodeURIComponent(projectId)+'/'+encodeURIComponent(assetId),duration:(await probe(out)).duration};
}
function resolvePreview(root,projectId,assetId){
 const src=store.resolveAsset(root,projectId,assetId),stat=fs.statSync(src);
 const fingerprint=crypto.createHash('sha256').update(String(stat.size)+':'+String(stat.mtimeMs)).digest('hex').slice(0,12);
 const base=path.join(root,'Proyectos',projectId,'Previews');
 const output=path.join(base,assetId+'-'+fingerprint+'.mp4');
 if(!fs.existsSync(output))throw Error('El video de vista previa aún no está preparado');
 return output;
}
async function getPreviewTimeline(root,projectId,key){
 if(!['hook','body','closing'].includes(key))throw Error('Escena inválida');
 const project=store.getProject(root,projectId),scene=project.scenes[key];
 if(!scene?.video)return [];
 const voice=store.resolveAsset(root,projectId,scene.video),duration=(await probe(voice)).duration;
 const resources=chooseMedia(scene).map(m=>{
  const asset=project.assets.find(a=>a.id===m.assetId);
  if(!asset)return null;
  return {...m,assetId:asset.id,type:asset.type,sourceStart:Number(m.start)||0,sourceEnd:Number(m.end)||duration};
 }).filter(Boolean);
 return timeline(scene,duration,resources).map(entry=>({start:entry.start,end:entry.end,assetId:entry.medium?.assetId||null,
  type:entry.medium?.type||null,mediaStart:entry.mediaStart||0,speed:entry.speed||1}));
}
function ffFilterPath(p){return p.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'").replace(/,/g,'\\,')}
function ffFont(){return process.platform==='win32'?"fontfile='"+ffFilterPath(path.join(process.env.WINDIR||'C:/Windows','Fonts','arialbd.ttf'))+"'":'font=Sans'}
function fillAndContain(src,wide,withPresenter,titleFile,withLogo,appearance,speed,theme,freezeVideo=false,templateIndex=null,sceneKey='body'){
 const testing=process.env.RECORDS_RENDER_TEST_MODE==='1';const W=testing?(wide?480:270):(wide?1920:1080),H=testing?(wide?270:480):(wide?1080:1920);
 const closing=sceneKey==='closing';
 const contentW=closing?(wide?1220:950):(wide?1380:930),contentH=closing?(wide?1000:1500):(wide?825:1160);
 const pos=appearance?.position||(wide?'right':'left');
 const factor=Math.max(.6,Math.min(1.5,(Number(appearance?.scale)||65)/65));
 const px=closing?'(W-w)/2':wide?(pos==='right'?1440:pos==='center'?760:65):(pos==='right'?600:pos==='center'?350:58),py=closing?(wide?90:390):(wide?235:820);
 const pw=Math.round((wide?420:400)*factor),ph=Math.round((wide?660:580)*factor);
 const voiceInput=freezeVideo?'[frozen]':'[0:v]';
 const pad=withPresenter?'[1:v]':voiceInput;
 const f=[];
 if(freezeVideo)f.push('[0:v]trim=end_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=3600[frozen]');
 if(withPresenter&&Math.abs((Number(speed)||1)-1)>.001)f.push('[1:v]setpts=(PTS-STARTPTS)/'+Math.max(.5,Math.min(2,Number(speed))).toFixed(3)+'[timed]');
 const bgInput=withPresenter&&Math.abs((Number(speed)||1)-1)>.001?'[timed]':pad;
 if(Number.isInteger(templateIndex)){
  // La plantilla sustituye solo el fondo. La fotografía o clip de apoyo permanece delante.
  f.push('['+templateIndex+':v]scale='+W+':'+H+':force_original_aspect_ratio=increase,crop='+W+':'+H+',setsar=1[blur]');
  f.push(bgInput+'scale='+contentW+':'+contentH+':force_original_aspect_ratio=decrease,setsar=1[center]');
 }else{
  f.push(bgInput+'split=2[back][foreground]');
  const lowW=Math.ceil(W/5),lowH=Math.ceil(H/5);
  f.push('[back]scale='+lowW+':'+lowH+':force_original_aspect_ratio=increase,crop='+lowW+':'+lowH+',boxblur=8:1,scale='+W+':'+H+':flags=bicubic[blur]');
  f.push('[foreground]scale='+contentW+':'+contentH+':force_original_aspect_ratio=decrease,setsar=1[center]');
 }
 f.push('[blur][center]overlay=(W-w)/2:'+(closing?py:'(H-h)/2')+'[base]');
 if(withPresenter){
  f.push(voiceInput+'scale='+pw+':'+ph+':force_original_aspect_ratio=decrease,setsar=1[speaker]');
  f.push('[base][speaker]overlay='+px+':'+py+'[visual]');
 }else f.push('[base]null[visual]');
 const strip=theme==='numbers'?'0xb92d42':theme==='legends'?'0xd8b56a':'0x2fcb6b';
 f.push('[visual]drawbox=x=0:y='+ (H-16) +':w='+W+':h=16:color='+strip+':t=fill[decorated]');
 let input='decorated';
 if(titleFile){
  f.push('['+input+']drawtext=textfile=\''+ffFilterPath(titleFile)+'\':fontcolor=white:fontsize='+(wide?54:50)+':'+ffFont()+':box=1:boxcolor=black@0.65:boxborderw=22:x=(w-text_w)/2:y='+(wide?56:160)+'[titled]');
  input='titled';
 }
 if(withLogo){
  const s=wide?68:58;
  f.push('['+(withPresenter?2:1)+':v]format=rgba,scale='+s+':-1:flags=lanczos[logo]');
  const xx='if(lt(mod(t,24),6),(W-w)*mod(t,24)/6,if(lt(mod(t,24),12),W-w,if(lt(mod(t,24),18),(W-w)*(1-(mod(t,24)-12)/6),0)))';
  const yy='if(lt(mod(t,24),6),0,if(lt(mod(t,24),12),(H-h)*(mod(t,24)-6)/6,if(lt(mod(t,24),18),H-h,(H-h)*(1-(mod(t,24)-18)/6))))';
  f.push('['+input+'][logo]overlay=x=\''+xx+'\':y=\''+yy+'\':eval=frame:shortest=0[vout]');
 }else f.push('['+input+']null[vout]');
 return f.join(';');
}
async function renderPiece(ctx,voice,mediaAsset,start,length,target,wide,title,signal,progress,logo,mediaStart=0,speed=1,appearance=null,theme='historic',edit={},templateFile=null,sceneKey='body'){
 if(!(length>.06))return;
 const testing=process.env.RECORDS_RENDER_TEST_MODE==='1';const W=testing?(wide?480:270):(wide?1920:1080),H=testing?(wide?270:480):(wide?1080:1920);
 const withPresenter=Boolean(mediaAsset),hasLogo=Boolean(logo&&fs.existsSync(logo));
 const titleFile=path.join(ctx,'title-'+path.basename(target)+'.txt');
 fs.writeFileSync(titleFile,sanitizeTitle(title),'utf8');
 const voiceInfo=await probe(voice);
 const args=['-hide_banner','-loglevel','error','-y','-ss',String(start),'-i',voice];
 if(withPresenter){
  if(mediaAsset.type==='image')args.push('-loop','1','-i',mediaAsset.file);
  else args.push('-stream_loop','-1','-ss',String(mediaStart),'-i',mediaAsset.file);
 }
 if(hasLogo)args.push('-loop','1','-i',logo);
 const templateIndex=templateFile?1+(withPresenter?1:0)+(hasLogo?1:0):null;
 if(templateFile)args.push('-loop','1','-i',templateFile);
 if(!voiceInfo.hasAudio)args.push('-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000');
 const filter=fillAndContain(null,wide,withPresenter,path.basename(titleFile),hasLogo,appearance,speed,theme,edit.freezeVideo===true,templateIndex,sceneKey);
 args.push('-filter_complex',filter);
 args.push('-map','[vout]');
 if(voiceInfo.hasAudio)args.push('-map','0:a:0','-af','aresample=async=1:first_pts=0,dynaudnorm=f=150:g=15'+(edit.muteAudio?',volume=0':''));
 else args.push('-map',String(1+(withPresenter?1:0)+(hasLogo?1:0)+(templateFile?1:0))+':a:0');
 args.push('-t',String(length),'-r','30','-s',W+'x'+H,'-c:v','libx264','-preset','veryfast','-crf','21',
  '-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-b:a','160k','-movflags','+faststart',target);
 await command(toolPath('ffmpeg'),args,signal,null,ctx);
 if(progress)progress();
}
function timeline(scene,duration,mediaEntries){
 const ranges=retainedRanges(scene,duration);
 const total=ranges.reduce((n,r)=>n+r.end-r.start,0);
 if(!mediaEntries.length)return ranges.map(r=>({...r,medium:null,mediaStart:0,speed:1}));
 const slot=total/mediaEntries.length,output=[];let accumulated=0;
 for(const r of ranges){let start=r.start;while(start<r.end-.05){
  const index=Math.min(mediaEntries.length-1,Math.floor((accumulated+.0001)/slot));
  const remainingSlot=(index+1)*slot-accumulated;
  const item=mediaEntries[index],speed=item.speed||1;
  const cut=Math.min(r.end-start,remainingSlot,item.type==='video'?4:100000);
  if(cut<=.04)break;
  const effectiveSpeed=item.type==='video'?speed:1;
  const sourceDuration=Math.max(.01,(Number(item.sourceEnd)||0)-(Number(item.sourceStart)||0));
  const clipStart=item.type==='video'?(Number(item.sourceStart)||0)+(((accumulated-index*slot)*effectiveSpeed + (item.microcuts===false?0:Math.floor(accumulated/4)*.12))%sourceDuration):0;
  output.push({start,end:start+cut,medium:item,mediaStart:clipStart,speed:effectiveSpeed});
  start+=cut;accumulated+=cut;
 }}
 return output;
}
async function compileScene(root,p,key,wide,tmp,signal,progress,logo){
 const scene=p.scenes[key];if(!scene||!scene.video)throw Error('Falta video de '+key+' en '+p.title);
 const voice=store.resolveAsset(root,p.id,scene.video),voiceInfo=await probe(voice);
 const length=selectedDuration(scene,voiceInfo.duration);
 if(length<.5)throw Error('La escena '+key+' quedó vacía');
 const autoMicrocuts=store.getSettings(root).autoMicrocuts!==false;
 const media=await Promise.all(chooseMedia(scene).map(async m=>{
  const asset=p.assets.find(a=>a.id===m.assetId);
  if(!asset)throw Error('Recurso ausente');
  const file=store.resolveAsset(root,p.id,asset.id);
  const duration=asset.type==='video'?(await probe(file)).duration:0;
  return {file,type:asset.type,sourceStart:Math.max(0,Number(m.start)||0),sourceEnd:Math.min(duration||voiceInfo.duration,Number(m.end)>0?Number(m.end):duration||voiceInfo.duration),speed:Math.max(.5,Math.min(2,Number(m.speed)||1)),microcuts:autoMicrocuts&&m.microcuts!==false}
 }));
 const entries=splitByEdits(timeline(scene,voiceInfo.duration,media),scene.cuts||[]);
 const format=wide?'wide':'short';
 const templateId=Object.prototype.hasOwnProperty.call(scene.backgrounds||{},format)?scene.backgrounds[format]:p.backgrounds?.[format];
 const templateFile=templateId?(typeof templateId==='string'
  ?templates.resolve(root,templateId,wide?'wide':'short')
  :templateId.scope==='project'?store.resolveAsset(root,p.id,templateId.assetId):null):null;
 const appearance=scene.formats?.[wide?'wide':'short']||scene;
 const segments=[];
 for(let i=0;i<entries.length;i++){
  if(signal.aborted)throw Error('Cancelado');
  const m=entries[i],output=path.join(tmp,'part-'+String(fs.readdirSync(tmp).length).padStart(5,'0')+'.mp4');
  await renderPiece(tmp,voice,m.medium,m.start,m.end-m.start,output,wide,scene.title||p.title,signal,progress,logo,m.mediaStart,m.speed,appearance,p.style,m,templateFile,key);
  segments.push(output);
 }
 return {segments,duration:length};
}
async function concat(tmp,segments,destination,signal){
 if(!segments.length)throw Error('No existen segmentos para exportar');
 const manifest=path.join(tmp,'lista.txt');
 // FFmpeg concat demuxer uses single-quoted names; temporary names contain no quotes.
 fs.writeFileSync(manifest,segments.map(s=>"file '"+s.replace(/\\/g,'/').replace(/'/g,"'\\''")+"'").join('\n'));
 await command(toolPath('ffmpeg'),['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',manifest,'-c','copy','-movflags','+faststart',destination],signal);
}
function temporary(root){const dir=path.join(root,'Temporales');fs.mkdirSync(dir,{recursive:true});return fs.mkdtempSync(path.join(dir,'render-'))}
async function exportShort(root,id,signal,send){
 const p=store.getProject(root,id),tmp=temporary(root),settings=store.getSettings(root);const pieces=[];
 const cleanLogo=await logoTools.normalize(root,settings.logo);
 try{
  let count=0;const progress=()=>send({type:'segment',done:++count,stage:'Short'});
  for(const key of ['hook','body','closing']){send({type:'status',message:'Procesando '+key});const r=await compileScene(root,p,key,false,tmp,signal,progress,cleanLogo);pieces.push(...r.segments)}
  const output=path.join(root,'Exportaciones','Shorts',p.id+'-'+Date.now()+'.mp4');
  await concat(tmp,pieces,output,signal);
  const original=store.getProject(root,id);original.status='exported';original.exports.push({at:new Date().toISOString(),mode:'short',file:output});original.updatedAt=new Date().toISOString();store.atomic(store.projectFile(root,id),original);
  send({type:'complete',file:output});return {file:output};
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
async function renderTransition(tmp,title,signal){
 const output=path.join(tmp,'transition-'+Date.now()+'.mp4'),textfile=path.join(tmp,'tr-'+Date.now()+'.txt');
 fs.writeFileSync(textfile,sanitizeTitle(title),'utf8');
 const f="drawtext=textfile='"+path.basename(textfile)+"':fontcolor=white:fontsize=70:"+ffFont()+":x=(w-text_w)/2:y=(h-text_h)/2";
 await command(toolPath('ffmpeg'),['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=0x122c1c:s=1920x1080:r=30:d=1',
  '-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000','-vf',f,'-t','1','-r','30','-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2',output],signal,null,tmp);
 return output;
}
async function exportWeekly(root,id,signal,send){
 const week=store.getWeek(root,id),tmp=temporary(root),settings=store.getSettings(root),pieces=[];
 const cleanLogo=await logoTools.normalize(root,settings.logo);
 try{
  if(!week.projectIds.length)throw Error('No existen récords para recopilar');
  if(!week.intro||!week.closing)throw Error('Graba o importa la introducción y el cierre del video largo');
  let sum=0;
  const sequence=[week.intro,...week.projectIds.map(pid=>({projectId:pid,scene:'body'})),week.closing];
  for(const e of sequence){
   const p=store.getProject(root,e.projectId),scene=p.scenes[e.scene],info=await probe(store.resolveAsset(root,p.id,scene.video));
   sum+=selectedDuration(scene,info.duration);
  }
  sum+=Math.max(0,week.projectIds.length-1);
  if(sum<480)throw Error('La recopilación tiene '+Math.round(sum/60)+' minutos. Agrega contenido para alcanzar 8 minutos antes de exportar.');
  const progress=()=>send({type:'segment',stage:'Video largo',done:pieces.length});
  for(let i=0;i<sequence.length;i++){
   if(signal.aborted)throw Error('Cancelado');
   const e=sequence[i],p=store.getProject(root,e.projectId);
   if(i>1&&i<sequence.length-1)pieces.push(await renderTransition(tmp,p.title,signal));
   send({type:'status',message:'Adaptando a 16:9: '+p.title});
   const r=await compileScene(root,p,e.scene,true,tmp,signal,progress,cleanLogo);
   pieces.push(...r.segments);
  }
  const output=path.join(root,'Exportaciones','Videos-Largos',week.id+'-'+Date.now()+'.mp4');
  await concat(tmp,pieces,output,signal);
  const w=store.getWeek(root,id);w.exportedAt=new Date().toISOString();w.outputs.push(output);store.atomic(store.weekFile(root,id),w);
  for(const pid of week.projectIds){const p=store.getProject(root,pid);if(!p.usedBy.includes(id))p.usedBy.push(id);store.atomic(store.projectFile(root,pid),p)}
  send({type:'complete',file:output});return {file:output,duration:sum};
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
}
module.exports={probe,detectSilences,waveform,retainedRanges,selectedDuration,timeline,splitByEdits,fillAndContain,preparePreview,resolvePreview,getPreviewTimeline,exportShort,exportWeekly,toolPath};
