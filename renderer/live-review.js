'use strict';
// Reproductor de montaje: no crea ni concatena MP4. Usa los recursos originales,
// copias compatibles individuales cuando Electron las necesita, y el reloj de las escenas.
const live={playing:false,index:-1,globalTime:0,projects:{},timelines:{},token:0,changing:false,loading:false,ended:false};
function liveChapters(){return (state.reviewInfo?.chapters||[]).filter(c=>!c.transition)}
function liveProject(chapter){return live.projects[chapter.projectId]||null}
function liveVideo(){return document.getElementById('final-review-video')}
function liveTickLabel(){
 const el=document.getElementById('review-clock');
 if(el)el.textContent=fmt(live.globalTime)+' / '+fmt(state.reviewInfo?.duration||0);
 const seek=document.getElementById('review-seekbar');
 if(seek&&!(seek.matches(':active')))seek.value=String(live.globalTime);
 document.querySelectorAll('[data-review-chapter]').forEach((e,i)=>e.classList.toggle('review-active',i===live.index));
}
function liveSourceTime(chapter,elapsed){
 let left=Math.max(0,elapsed);
 for(const range of chapter.ranges||[]){
  if(left<=range.duration)return range.start+left*chapter.playbackSpeed;
  left-=range.duration;
 }
 return chapter.ranges?.at(-1)?.end||0;
}
function liveOutputOffset(chapter,sourceTime){
 let elapsed=0;
 for(const r of chapter.ranges||[]){
  if(sourceTime<r.start)return elapsed;
  if(sourceTime<r.end)return elapsed+(sourceTime-r.start)/chapter.playbackSpeed;
  elapsed+=r.duration;
 }
 return chapter.duration;
}
function liveFindChapter(time){
 const chapters=liveChapters();
 if(!chapters.length)return -1;
 const at=Math.max(0,time);
 let idx=chapters.findIndex((ch,i)=>at>=ch.start-.005&&at<ch.start+ch.duration-.005);
 if(idx<0)idx=chapters.findIndex(ch=>ch.start>=at-.01);
 return idx>=0?idx:chapters.length-1;
}
function liveFrameClass(p,scene,wide){
 const v=scene.formats?.[wide?'wide':'short']||{};
 return {frame:v.frame||'gold',position:v.position||'left',scale:Number(v.scale)||65};
}
function liveBackground(p,scene,format){
 const choice=Object.prototype.hasOwnProperty.call(scene.backgrounds||{},format)?scene.backgrounds[format]:p.backgrounds?.[format];
 if(!choice)return '';
 if(typeof choice==='object'&&choice.scope==='project')return url(p,choice.assetId);
 const match=state.templates.find(t=>t.id===choice&&t.format===format);
 return match?'records://template/'+encodeURIComponent(match.id):'';
}
function liveStageHTML(chapter){
 const p=liveProject(chapter);
 if(!p)return '<div class="review-empty">Cargando escena…</div>';
 const s=p.scenes[chapter.scene],wide=state.reviewKind==='week',appearance=liveFrameClass(p,s,wide),background=liveBackground(p,s,wide?'wide':'short');
 const closing=chapter.scene==='closing',frame=appearance.frame;
 const side=closing?'50%':appearance.position==='right'?(wide?'73%':'55%'):appearance.position==='center'?'50%':(wide?'3%':'8%');
 const speakerStyle='left:'+side+';--closing-scale:'+(Math.max(.7,Math.min(1.4,appearance.scale/95))).toFixed(2)+';transform:scale('+(appearance.scale/65).toFixed(2)+');transform-origin:bottom center';
 const backdrop=background?'<img class="template-back" src="'+esc(background)+'" alt="">':'<div class="fallback-back"></div>';
 const first=(s.media||[]).map(m=>p.assets.find(a=>a.id===m.assetId)).find(a=>a?.type==='image');
 const support=closing?'':'<img id="review-support-image" class="photo" alt="" '+(first?'src="'+url(p,first.id)+'"':'')+' hidden>'+
  '<video id="review-support-video" class="photo" muted playsinline preload="metadata" hidden></video>';
 return '<div class="stage '+(wide?'wide ':'')+(closing?'closing ':'')+'live-stage style-'+esc(p.style||'historic')+'">'+
  backdrop+support+'<div class="headline">'+esc(s.title||p.title)+'</div>'+
  '<video id="final-review-video" class="speaker live-speaker frame-'+frame+'" data-asset="'+esc(chapter.assetId)+'" style="'+speakerStyle+'" playsinline preload="metadata"></video>'+
  (closing?'<div class="follow">SÍGUENOS</div>':'')+
  (state.settings.logo?'<img class="logo-moving" src="records://settings/logo" alt="">':'')+
  '<div id="review-fx-overlay" class="review-fx-overlay"></div>'+
  '</div>';
}
async function liveLoadScene(index,offset=0,autoplay=false){
 const chapters=liveChapters(),ch=chapters[index];
 if(!ch||!ch.assetId)return;
 const token=++live.token;
 live.changing=true;live.index=index;live.globalTime=ch.start+Math.max(0,Math.min(ch.duration,offset));
 const root=document.getElementById('review-live-stage');
 if(!root)return;
 root.innerHTML=liveStageHTML(ch);
 liveTickLabel();
 const video=liveVideo();
 if(!video)return;
 const scene=liveProject(ch)?.scenes[ch.scene];
 const key=ch.projectId+':'+ch.assetId;
 const overlay=document.getElementById('review-fx-overlay');
 if(overlay&&index>0){
  const type=state.reviewKind==='short'?(index===1?state.project.transitions?.hookBody:state.project.transitions?.bodyClosing):'fade';
  overlay.className='review-fx-overlay fx-'+(type||'fade');
  overlay.addEventListener('animationend',()=>{overlay.className='review-fx-overlay'},{once:true});
 }
 const message=document.getElementById('review-live-message');
 if(message)message.textContent='Preparando '+ch.label+'…';
 try{
  const cached=state.previewUrls[key];
  const source=cached||await ensurePreview(ch.projectId,ch.assetId);
  if(token!==live.token||state.page!=='review')return;
  video.src=source;
  video.playbackRate=ch.playbackSpeed||1;
  video.preservesPitch=true;
  video.addEventListener('loadedmetadata',async()=>{
   if(token!==live.token)return;
   try{video.currentTime=liveSourceTime(ch,offset)}catch(_){}
   live.changing=false;
   if(message)message.textContent='Vista previa en tiempo real · sin generar MP4';
   liveUpdateSupport();
   if(autoplay){try{await video.play();live.playing=true}catch(e){if(message)message.textContent=e.message}}
  },{once:true});
  video.load();
  const tkey=ch.projectId+':'+ch.scene;
  if(!live.timelines[tkey])api('media:timeline',{projectId:ch.projectId,scene:ch.scene}).then(data=>{
   live.timelines[tkey]=data;if(token===live.token)liveUpdateSupport();
  }).catch(()=>{});
 }catch(e){
  live.changing=false;live.playing=false;
  if(message)message.textContent='No se pudo reproducir '+ch.label+': '+e.message;
 }
}
function liveUpdateSupport(){
 const ch=liveChapters()[live.index],video=liveVideo();
 if(!ch||!video)return;
 const list=live.timelines[ch.projectId+':'+ch.scene]||[];
 const segment=list.find(x=>video.currentTime>=x.start-.02&&video.currentTime<x.end-.02);
 const photo=document.getElementById('review-support-image'),clip=document.getElementById('review-support-video');
 if(!photo&&!clip)return;
 if(!segment?.assetId){
  if(photo)photo.hidden=true;if(clip){clip.pause();clip.hidden=true}return;
 }
 if(segment.type==='image'){
  if(clip){clip.hidden=true;clip.pause()}
  if(photo){
   if(photo.dataset.asset!==segment.assetId){photo.src=url(liveProject(ch),segment.assetId);photo.dataset.asset=segment.assetId}
   photo.hidden=false;
  }
 }else if(segment.type==='video'&&clip){
  if(photo)photo.hidden=true;
  const key=ch.projectId+':'+segment.assetId;
  if(state.previewUrls[key]){
   if(clip.dataset.asset!==segment.assetId){clip.src=state.previewUrls[key];clip.dataset.asset=segment.assetId;clip.load()}
   clip.hidden=false;
   const wanted=(segment.mediaStart||0)+(video.currentTime-segment.start)*(segment.speed||1);
   if(Math.abs(clip.currentTime-wanted)>.45)try{clip.currentTime=wanted}catch(_){}
   clip.playbackRate=(segment.speed||1)*(ch.playbackSpeed||1);
   if(!video.paused)clip.play().catch(()=>{});else clip.pause();
  }else{
   clip.hidden=true;
   if(!state.previewPending[key])ensurePreview(ch.projectId,segment.assetId).then(liveUpdateSupport).catch(()=>{});
  }
 }
}
function liveOnTimeUpdate(e){
 if(e.target?.id!=='final-review-video'||live.changing||state.page!=='review')return;
 const ch=liveChapters()[live.index];if(!ch)return;
 const video=e.target;
 // Los fragmentos eliminados nunca aparecen en la reproducción final.
 const ranges=ch.ranges||[];
 const current=ranges.find(r=>video.currentTime>=r.start-.025&&video.currentTime<r.end-.015);
 if(!current){
  const next=ranges.find(r=>r.start>video.currentTime+.01);
  if(next){video.currentTime=next.start;return}
  liveNextScene();return;
 }
 live.globalTime=Math.min(ch.start+ch.duration,ch.start+liveOutputOffset(ch,video.currentTime));
 if(ch.duration>0&&live.globalTime>=ch.start+ch.duration-.045){liveNextScene();return}
 const scene=liveProject(ch)?.scenes[ch.scene];
 video.muted=(scene?.cuts||[]).some(c=>c.mode==='audio'&&video.currentTime>=c.start&&video.currentTime<c.end);
 liveTickLabel();liveUpdateSupport();
}
function liveNextScene(){
 if(live.changing)return;
 const next=live.index+1;
 if(next>=liveChapters().length){live.playing=false;liveVideo()?.pause();live.globalTime=state.reviewInfo?.duration||live.globalTime;liveTickLabel();return}
 const wasPlaying=live.playing;
 liveLoadScene(next,0,wasPlaying);
}
async function liveSeek(seconds,autoplay){
 const duration=state.reviewInfo?.duration||0;
 live.globalTime=Math.min(duration,Math.max(0,Number(seconds)||0));
 const idx=liveFindChapter(live.globalTime);
 const ch=liveChapters()[idx];
 if(!ch)return;
 if(idx!==live.index||!liveVideo())await liveLoadScene(idx,live.globalTime-ch.start,autoplay);
 else{
  const video=liveVideo(),offset=Math.max(0,live.globalTime-ch.start);
  video.currentTime=liveSourceTime(ch,offset);
  if(autoplay){await video.play();live.playing=true}
  liveTickLabel();liveUpdateSupport();
 }
}
async function liveStart(){
 const ch=liveChapters()[live.index];
 if(!ch){await liveSeek(0,true);return}
 const v=liveVideo();if(!v){await liveSeek(live.globalTime,true);return}
 try{await v.play();live.playing=true}catch(e){notice('Reproducción: '+e.message,true)}
}
function livePause(){live.playing=false;liveVideo()?.pause();document.getElementById('review-support-video')?.pause()}
function liveStop(){livePause();liveSeek(0,false)}
async function livePrepare(){
 ++live.token;livePause();live.index=-1;live.globalTime=0;live.projects={};live.timelines={};
 const chapters=liveChapters();
 for(const ch of chapters){
  if(!ch.projectId||live.projects[ch.projectId])continue;
  live.projects[ch.projectId]=state.project?.id===ch.projectId?state.project:
   await api('projects:get',{id:ch.projectId});
 }
 if(state.page==='review'&&chapters.some(c=>c.assetId))await liveSeek(0,false);
}
document.addEventListener('timeupdate',liveOnTimeUpdate,true);
document.addEventListener('ended',e=>{if(e.target?.id==='final-review-video')liveNextScene()},true);
