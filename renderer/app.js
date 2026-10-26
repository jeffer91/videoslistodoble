'use strict';
const $=s=>document.querySelector(s);
const state={page:'home',projects:[],weeks:[],project:null,week:null,scene:'hook',orientation:'short',settings:{},status:'',progress:0,recordStream:null,recorder:null,recordParts:[],recTarget:null,editingWeekId:null,waveforms:{},videoDurations:{},showSafe:false,previewIndex:-1};
const names={hook:'Gancho',body:'Desarrollo',closing:'Cierre'};
const order=['hook','body','closing'];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url=(p,id)=>id?'records://asset/'+encodeURIComponent(p.id)+'/'+encodeURIComponent(id):'';
const value=(a,k,f)=>a?.[k]??f;
const fmt=s=>{const n=Number(s)||0;return Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0')};
async function api(key,payload){const r=await window.studio.call(key,payload||{});if(!r.ok)throw Error(r.error||'Error desconocido');return r.data}
function notice(msg,error=false){const el=$('#toast');el.textContent=msg;el.hidden=false;el.classList.toggle('error',error);clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.hidden=true,6500)}
async function loadLibrary(){state.projects=await api('projects:list');state.weeks=await api('weekly:list')}
function titlebar(title,description,buttons=''){return '<div class="topbar"><div><h1>'+esc(title)+'</h1><p>'+esc(description||'')+'</p></div><div class="row wrap">'+buttons+'</div></div>'}
function btn(action,label,cls='',attrs=''){return '<button data-action="'+action+'" class="'+cls+'" '+attrs+'>'+label+'</button>'}
function projectTile(p){return '<article class="card" data-action="open-project" data-id="'+esc(p.id)+'"><div class="row between"><span class="pill">'+(p.status==='exported'?'Short exportado':p.status==='auxiliary'?'Complementario':'En edición')+'</span><span class="muted mini">'+new Date(p.updatedAt).toLocaleDateString('es-EC')+'</span></div><h3>'+esc(p.title)+'</h3><div class="row between"><small>'+(p.exports||[]).length+' exportaciones · '+(p.usedBy||[]).length+' compilaciones</small><strong>Editar →</strong></div></article>'}
function home(){const list=state.projects.filter(p=>p.status!=='auxiliary');return titlebar('Mis proyectos','Tus récords, imágenes y grabaciones se conservan localmente.',btn('new','＋ Nuevo récord')+btn('new-week','Crear video semanal','secondary'))+(list.length?'<div class="grid">'+list.map(projectTile).join('')+'</div>':'<div class="empty"><h2>Empieza creando tu primer récord</h2><p>Sube tres videos, fotografías o clips de apoyo, edita y exporta tu Short.</p>'+btn('new','Crear primer proyecto')+'</div>')}
function weeksPage(){return titlebar('Compilaciones semanales','La app incorpora automáticamente los Shorts exportados que aún no se han utilizado.',btn('new-week','＋ Crear recopilación'))+(state.weeks.length?'<div class="grid">'+state.weeks.map(w=>'<article class="card" data-action="open-week" data-id="'+esc(w.id)+'"><div class="row between"><span class="pill">'+(w.exportedAt?'Exportada':'En edición')+'</span><small>'+new Date(w.createdAt).toLocaleDateString('es-EC')+'</small></div><h3>'+esc(w.title)+'</h3><small>'+w.projectIds.length+' récords</small><strong>Revisar →</strong></article>').join('')+'</div>':'<div class="empty">Todavía no hay recopilaciones. Exporta Shorts y crea el primer video largo.</div>')}
function assetLabel(asset){return asset.type==='video'?'▣':asset.type==='image'?'▧':'♫'}
function assetPicker(p,onlyVideo){const as=p.assets.filter(a=>onlyVideo?a.type==='video':a.type==='video'||a.type==='image');return as.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>').join('')}
function mediaRows(){const p=state.project,s=p.scenes[state.scene];if(state.scene==='closing')return '<p class="muted mini">El cierre presenta al narrador en primer plano, sin fotografías de apoyo.</p>';
 return '<div class="list">'+(s.media||[]).map((m,i)=>{
  const a=p.assets.find(x=>x.id===m.assetId);if(!a)return '';
  return '<div class="asset"><div class="row"><span class="fileicon">'+assetLabel(a)+'</span><div><strong>'+esc(a.name)+'</strong><small style="display:block">'+(a.type==='video'?'Clip de apoyo · audio silenciado':'Fotografía original')+'</small></div></div><div class="row wrap">'+(a.type==='video'?'<label class="mini">Velocidad <select data-media-speed="'+i+'"><option value="1" '+(m.speed===1?'selected':'')+'>1,0×</option><option value="1.1" '+(m.speed===1.1?'selected':'')+'>1,1×</option><option value="1.2" '+(m.speed===1.2?'selected':'')+'>1,2×</option></select></label>':'')+btn('move-media','↑','secondary','data-index="'+i+'" data-delta="-1"')+btn('move-media','↓','secondary','data-index="'+i+'" data-delta="1"')+btn('remove-media','×','danger','data-index="'+i+'"')+'</div></div>';
 }).join('')+'</div>'+(state.scene==='hook'?'<small>En el gancho se utiliza el primer recurso como fotografía o video de apoyo.</small>':'<small>En desarrollo puedes combinar fotos y clips; se distribuyen automáticamente durante la narración.</small>')}
function waveformHTML(scene){
 const project=state.project;if(!project||!scene.video)return '';
 const id=project.id+':'+scene.video,peaks=state.waveforms[id]||[];
 const duration=state.videoDurations[id]||scene.end||1;
 if(!peaks.length)return '<p class="muted mini">Carga la grabación para mostrar su forma de onda.</p>';
 const count=Math.min(260,peaks.length),width=840,space=width/count;
 const shapes=[];
 for(let k=0;k<count;k++){
  const idx=Math.floor(k*peaks.length/count);
  const timestamp=idx*.1;
  const gap=(scene.silences||[]).find(g=>timestamp>=g.start&&timestamp<g.end);
  const color=gap?(gap.remove?'#d44d60':'#78877d'):'#5cadd5';
  const height=Math.max(3,peaks[idx]*68);
  shapes.push('<rect x="'+(k*space).toFixed(2)+'" y="'+((75-height)/2).toFixed(1)+'" width="'+Math.max(1,space-1).toFixed(2)+'" height="'+height.toFixed(1)+'" fill="'+color+'" rx=".6"/>');
 }
 return '<svg viewBox="0 0 840 75" style="display:block;width:100%;margin-bottom:8px;background:#102116;border-radius:7px" role="img" aria-label="Forma de onda del audio">'+shapes.join('')+'</svg>';
}
function secondsToPixel(s,start,end){return Math.max(0,Math.min(100,(s-start)/(end-start)*100))}
function silenceTimeline(scene){const chunks=[],begin=Math.max(0,Number(scene.start)||0),end=Number(scene.end)>begin?Number(scene.end):begin+1;
 const intervals=(scene.silences||[]).filter(g=>g.end>begin&&g.start<end).sort((a,b)=>a.start-b.start);
 let at=begin;
 for(let i=0;i<intervals.length;i++){const q=intervals[i],s=Math.max(at,q.start),e=Math.min(end,q.end);if(e<=s)continue;
  if(s>at)chunks.push({start:at,end:s,voice:true});
  chunks.push({start:s,end:e,voice:false,remove:q.remove!==false,index:i});at=e}
 if(end>at)chunks.push({start:at,end,voice:true});
 return waveformHTML(scene)+'<div class="timeline">'+chunks.map(c=>'<div title="'+(c.voice?'Voz':c.remove?'Clic para conservar':'Clic para eliminar')+' · '+fmt(c.end-c.start)+'" class="audiochunk '+(c.voice?'voice':c.remove?'cut':'keep')+'" style="flex:'+(c.end-c.start).toFixed(3)+'" '+(c.voice?'':'data-action="toggle-silence" data-index="'+c.index+'"')+'>'+(c.voice?'▥':c.remove?'×':'✓')+'</div>').join('')+'</div>';
}
function sceneView(){
 const p=state.project,s=p.scenes[state.scene],video=p.assets.find(a=>a.id===s.video),media=(s.media||[]).map(m=>p.assets.find(a=>a.id===m.assetId)).filter(Boolean),first=media[0];
 const wide=state.orientation==='wide',style=p.style,appearance=(s.formats||{})[state.orientation]||s;
 const preview=video?'<video class="speaker" id="speaker-preview" src="'+url(p,video.id)+'" playsinline preload="metadata"></video>':'';
 let bg='';
 if(first)bg=first.type==='image'?'<img class="back" src="'+url(p,first.id)+'"><img class="photo" src="'+url(p,first.id)+'">':'<video class="back" src="'+url(p,first.id)+'" muted loop autoplay playsinline></video><video class="photo" src="'+url(p,first.id)+'" muted loop autoplay playsinline></video>';
 else if(video)bg='<video class="back" src="'+url(p,video.id)+'" muted loop autoplay playsinline></video>';
 const speakerPos=appearance.position==='right'?(wide?'73%':'55%'):appearance.position==='center'?(wide?'40%':'31%'):(wide?'3%':'8%');
 const resizedPreview=preview.replace('class="speaker"','class="speaker" style="left:'+speakerPos+';transform:scale('+(Number(appearance.scale||65)/65).toFixed(2)+');transform-origin:bottom center"');
 const previewHTML='<div class="stage '+(wide?'wide ':'')+'style-'+style+'">'+bg+'<div class="headline">'+esc(s.title||p.title)+'</div>' +resizedPreview+(state.scene==='closing'?'<div class="follow">SÍGUENOS</div>':'')+(state.settings.logo?'<img class="logo-moving" src="records://settings/logo" alt="Logo del canal">':'')+'</div>';
 const approved=order.every(k=>p.scenes[k].approved);
 return titlebar(p.title,'Proyecto local · se guarda automáticamente',btn('back','← Biblioteca','secondary')+(state.editingWeekId?btn('return-week','Volver al video semanal','secondary'):'')+btn('export-short','Exportar Short MP4','',''+(!approved?'disabled title="Aprueba las tres escenas primero"':'')))+
 '<div class="steps">'+order.map(k=>'<button data-action="scene" data-id="'+k+'" class="step '+(k===state.scene?'active':'')+'">'+(p.scenes[k].approved?'✓ ':'')+names[k]+'</button>').join('')+'</div>'+
 '<div class="stagegrid"><section><div class="panel"><div class="row between"><h2>Vista previa</h2><div class="row">'+btn('orientation-short','9:16','secondary')+btn('orientation-wide','16:9','secondary')+'</div></div>'+previewHTML+'<div class="row wrap" style="margin-top:16px;justify-content:center">'+btn('play-preview','▶ Reproducir')+btn('pause-preview','Ⅱ Pausa','secondary')+btn('stop-preview','■ Detener','secondary')+'</div><p class="muted mini">La vista previa permite revisar el encuadre; la composición MP4 final se procesa con FFmpeg.</p></div>'+
 '<div class="panel"><h2>Recortes de voz y silencios</h2><p class="muted mini">Silencios desde 0,5 segundos: rojo = se elimina; gris = se conserva. Nada se borra del original.</p>'+
 '<div class="two"><div class="field"><label>Inicio (segundos)</label><input type="number" min="0" step="0.1" data-field="start" value="'+(s.start||0)+'"></div><div class="field"><label>Final (segundos)</label><input type="number" min="0" step="0.1" data-field="end" value="'+(s.end||0)+'"></div></div>'+
 '<div class="field"><label>Barras de recorte · inicio y final</label><input type="range" data-field="start" min="0" max="'+(state.videoDurations[p.id+':'+s.video]||Math.max(1,s.end||180))+'" step="0.1" value="'+(s.start||0)+'"><input type="range" data-field="end" min="0" max="'+(state.videoDurations[p.id+':'+s.video]||Math.max(1,s.end||180))+'" step="0.1" value="'+(s.end||0)+'"></div>'+
 silenceTimeline(s)+'<div class="row wrap" style="margin-top:12px">'+btn('detect-silences','Detectar silencios')+btn('mark-all','Marcar todos','secondary')+btn('unmark-all','Conservar todos','secondary')+'</div></div></section>'+
 '<section><div class="panel"><h2>'+names[state.scene]+'</h2><div class="field"><label>Video principal con tu narración</label><div class="row wrap">'+(video?'<span class="pill">'+esc(video.name)+'</span>':'<span class="muted">Sin grabación</span>')+btn('import-voice','＋ Importar grabación','secondary')+btn('start-recorder','● Grabar ahora','outline')+'</div></div>'+
 '<div class="field"><label>Título del récord</label><input maxlength="120" data-field="title" value="'+esc(s.title||p.title)+'"></div>'+
 '<div class="two"><div class="field"><label>Cifra (opcional)</label><input maxlength="18" data-field="number" value="'+esc(s.number||'')+'"></div><div class="field"><label>Protagonista (opcional)</label><input maxlength="50" data-field="name" value="'+esc(s.name||'')+'"></div></div>'+
 '<div class="field"><label>Plantilla visual del proyecto</label><select data-project-field="style"><option value="historic" '+(style==='historic'?'selected':'')+'>Récord histórico</option><option value="numbers" '+(style==='numbers'?'selected':'')+'>Récord en cifras</option><option value="legends" '+(style==='legends'?'selected':'')+'>Leyendas y récords</option></select></div>'+
 '<div class="two"><div class="field"><label>Composición</label><select data-format-field="layout"><option value="auto" '+(appearance.layout==='auto'?'selected':'')+'>Automática</option><option value="manual" '+(appearance.layout==='manual'?'selected':'')+'>Manual</option></select></div><div class="field"><label>Posición presentador</label><select data-format-field="position">'+['left','right','center'].map(k=>'<option value="'+k+'" '+(appearance.position===k?'selected':'')+'>'+({left:'Izquierda',right:'Derecha',center:'Centro'}[k])+'</option>').join('')+'</select></div></div>'+
 '<div class="field"><label>Tamaño del presentador ('+(appearance.scale||65)+'%)</label><input type="range" min="30" max="100" data-format-field="scale" value="'+(appearance.scale||65)+'"></div>'+
 '<div class="row between"><span class="pill">'+(s.approved?'Escena aprobada':'Pendiente de aprobación')+'</span>'+btn('approve-scene',s.approved?'Modificar aprobación':'✓ Aprobar escena',s.approved?'secondary':'')+'</div></div>'+
 '<div class="panel"><div class="row between"><h2>Recursos visuales</h2>'+(state.scene==='closing'?'':btn('import-media','＋ Fotos o videos','secondary'))+'</div>'+mediaRows()+'</div></section></div>'+
 (state.status?'<div class="panel"><strong>'+esc(state.status)+'</strong><div class="progressbar"><div style="width:'+state.progress+'%"></div></div>'+btn('cancel-render','Cancelar exportación','danger')+'</div>':'');
}
function settingsPage(){const s=state.settings;return titlebar('Configuración','Preferencias locales del programa')+'<div class="panel"><h2>Biblioteca y dispositivos</h2><p>Los proyectos, copias y exportaciones se guardan en <code>D:\\11-Records-Studio</code> en Windows.</p><div class="field"><label>Umbral de detección de silencios (segundos)</label><input type="number" id="silenceThreshold" min=".5" max="5" step=".1" value="'+(s.silenceThreshold||.5)+'"></div><label class="row"><input type="checkbox" id="autoMicrocuts" '+(s.autoMicrocuts?'checked':'')+'> Montaje de apoyo con microcortes opcionales</label><div class="divider"></div><h3>Logo del canal</h3><div class="row wrap"><span class="muted">'+(s.logo?esc(s.logo):'Todavía no se ha importado el logo')+'</span>'+btn('import-logo','Seleccionar logo','secondary')+'</div><div class="row" style="margin-top:15px">'+btn('save-settings','Guardar preferencias')+'</div></div>'}
async function weeklyDuration(){
 const w=state.week;if(!w)return 0;
 let secs=Math.max(0,w.projectIds.length-1);const entries=[w.intro,w.closing,...w.projectIds.map(id=>({projectId:id,scene:'body'}))];
 for(const entry of entries){if(!entry)continue;try{const p=await api('projects:get',{id:entry.projectId}),s=p.scenes[entry.scene];if(s?.video){const info=await api('media:metadata',{projectId:p.id,assetId:s.video});const raw=info.duration;secs+=Math.max(0,(s.end>s.start?s.end:raw)-(s.start||0))-(s.silences||[]).filter(g=>g.remove).reduce((sum,g)=>sum+Math.max(0,Math.min(s.end||raw,g.end)-Math.max(s.start||0,g.start)),0)}}catch(e){}}
 return Math.max(0,secs);
}
function weeklyPage(){
 const w=state.week,ids=w.projectIds,all=state.projects.filter(p=>p.status==='exported');
 const mins=state.weekLength||0;
 return titlebar(w.title,'Compilación 16:9 · los desarrollos se obtienen de los originales',btn('weeks','← Compilaciones','secondary')+btn('export-week','Exportar MP4 16:9'))+
 '<div class="stagegrid"><section><div class="panel"><h2>Secuencia semanal</h2><div class="list">'+
 '<div class="asset"><span>Introducción exclusiva</span>'+btn('edit-week-intro',w.intro?'Editar / grabar':'Preparar introducción','secondary')+'</div>'+
 ids.map((id,i)=>{const p=state.projects.find(x=>x.id===id);return '<div class="asset"><span><strong>'+esc(p?.title||'Récord')+'</strong> <small>· Desarrollo · título original</small></span><div class="row">'+btn('move-record','↑','secondary','data-index="'+i+'" data-delta="-1"')+btn('move-record','↓','secondary','data-index="'+i+'" data-delta="1"')+btn('remove-record','×','danger','data-id="'+id+'"')+'</div></div>'}).join('')+
 '<div class="asset"><span>Cierre exclusivo</span>'+btn('edit-week-closing',w.closing?'Editar / grabar':'Preparar cierre','secondary')+'</div></div>'+
 '<div class="divider"></div><h3>Añadir récord exportado</h3><select id="add-record-select"><option value="">Elige un proyecto…</option>'+all.filter(p=>!ids.includes(p.id)).map(p=>'<option value="'+p.id+'">'+esc(p.title)+'</option>').join('')+'</select> '+btn('add-record','Agregar','secondary')+'</div></section>'+
 '<section><div class="panel"><h2>Duración estimada</h2><h1>'+fmt(mins)+'</h1><div class="progressbar"><div style="width:'+Math.min(100,mins/480*100)+'%"></div></div>'+(mins<480?'<div class="warning">Faltan aproximadamente '+fmt(480-mins)+' para llegar al objetivo de 8 minutos. Añade desarrollos o contenido antes de exportar.</div>':'<div class="success">La compilación alcanza el mínimo de 8 minutos.</div>')+
 '<p class="muted mini">Incluye cada desarrollo una sola vez, sin sus ganchos ni cierres. Una transición automática breve separa los récords. Las imágenes se recomponen desde originales para 16:9.</p>'+
 '<p class="muted mini">Después de exportar, los récords utilizados dejan de aparecer en las próximas compilaciones automáticas. Puedes editar sus fuentes y regenerar esta compilación.</p></div></section></div>'+
 (state.status?'<div class="panel">'+esc(state.status)+btn('cancel-render','Cancelar exportación','danger')+'</div>':'');
}
function render(){
 const el=$('#view');const page=state.page;
 el.innerHTML=page==='home'?home():page==='weeks'?weeksPage():page==='project'?sceneView():page==='week'?weeklyPage():page==='settings'?settingsPage():page==='legacy'?titlebar('Editor web original','Copia exacta de Videoshort v20; disponible para referencia sin persistencia de proyectos.')+'<iframe title="Editor original" src="../legacy/index.html" style="width:100%;height:75vh;border:1px solid #31543b;background:white;border-radius:13px"></iframe>':home();
 document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.action===(page==='project'?'home':page==='week'?'weeks':page)));
}
async function navigate(page){state.page=page;state.status='';await loadLibrary();render()}
async function refreshWaveform(){
 const p=state.project,s=p?.scenes[state.scene];if(!p||!s?.video)return;
 const id=p.id+':'+s.video;
 try{
  const [points,info]=await Promise.all([
   state.waveforms[id]||api('media:waveform',{projectId:p.id,assetId:s.video}),
   state.videoDurations[id]?{duration:state.videoDurations[id]}:api('media:metadata',{projectId:p.id,assetId:s.video})
  ]);
  state.waveforms[id]=points;state.videoDurations[id]=info.duration;
  if(state.page==='project'&&state.project?.id===p.id&&state.project.scenes[state.scene].video===s.video)render();
 }catch(e){console.warn('No se pudo generar la forma de onda:',e)}
}
async function openProject(id,scene='hook'){state.project=await api('projects:get',{id});state.scene=scene;state.orientation='short';state.page='project';state.status='';render();refreshWaveform()}
async function openWeek(id){state.week=await api('weekly:get',{id});state.page='week';state.status='';state.weekLength=0;render();state.weekLength=await weeklyDuration();if(state.page==='week')render()}
let saving=null;
function queueSave(){clearTimeout(saving);saving=setTimeout(async()=>{try{if(state.project)await api('projects:save',state.project)}catch(e){notice(e.message,true)}},250)}
async function saveNow(){clearTimeout(saving);if(state.project)await api('projects:save',state.project)}
async function importFor(target){
 const files=await api('assets:import',{projectId:state.project.id});
 if(!files.length)return;
 state.project=await api('projects:get',{id:state.project.id});
 if(target==='voice'){
  const item=files.find(f=>f.type==='video');if(!item)throw Error('Selecciona un video con tu narración');
  const info=await api('media:metadata',{projectId:state.project.id,assetId:item.id});
  const s=state.project.scenes[state.scene];s.video=item.id;s.start=0;s.end=Math.min(180,info.duration);s.silences=[];s.approved=false;
 }else{
  const s=state.project.scenes[state.scene];if(!s.media)s.media=[];
  for(const item of files.filter(f=>f.type==='image'||f.type==='video'))s.media.push({assetId:item.id,start:0,end:0,speed:1});
  s.approved=false;
 }
 await saveNow();render();if(target==='voice')refreshWaveform();notice('Archivo copiado a la biblioteca local');
}
async function detect(){const p=state.project,s=p.scenes[state.scene];if(!s.video)throw Error('Importa primero un video');
 notice('Analizando pausas del audio…');
 const data=await api('media:analyze',{projectId:p.id,assetId:s.video,threshold:state.settings.silenceThreshold||.5});
 s.silences=data.map(d=>({...d,remove:true}));s.approved=false;queueSave();render();notice(data.length+' silencios detectados (rojo = borrar; gris = conservar)')}
async function manageRecording(){
 const modal=$('#modal-root');modal.hidden=false;
 const devices=await navigator.mediaDevices.enumerateDevices().catch(()=>[]);
 const cameras=devices.filter(d=>d.kind==='videoinput'),microphones=devices.filter(d=>d.kind==='audioinput');
 modal.innerHTML='<div class="modalback"><div class="modal"><h2>Grabar con cámara y micrófono</h2><p class="muted">Elige tus dispositivos. Se recordarán para la próxima vez.</p><div class="two"><div class="field"><label>Cámara</label><select id="camera-choice">'+cameras.map(c=>'<option value="'+esc(c.deviceId)+'" '+(state.settings.defaultCamera===c.deviceId?'selected':'')+'>'+esc(c.label||'Cámara')+'</option>').join('')+'</select></div><div class="field"><label>Micrófono</label><select id="mic-choice">'+microphones.map(c=>'<option value="'+esc(c.deviceId)+'" '+(state.settings.defaultMic===c.deviceId?'selected':'')+'>'+esc(c.label||'Micrófono')+'</option>').join('')+'</select></div></div><div class="recorder"><video id="camera-preview" autoplay muted playsinline></video><div class="row">'+btn('record-start','● Iniciar grabación')+btn('record-stop','■ Detener y guardar','danger','disabled')+'</div></div><div class="row" style="margin-top:12px">'+btn('modal-close','Cerrar','secondary')+'</div></div></div>';
}
async function startRecording(){
 const camera=$('#camera-choice')?.value||undefined,mic=$('#mic-choice')?.value||undefined;
 state.settings.defaultCamera=camera||'';state.settings.defaultMic=mic||'';await api('settings:set',state.settings);
 const constraints={video:camera?{deviceId:{ideal:camera}}:true,audio:mic?{deviceId:{ideal:mic}}:true};
 const stream=await navigator.mediaDevices.getUserMedia(constraints);state.recordStream=stream;
 const el=$('#camera-preview');el.srcObject=stream;await el.play();
 const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
 if(!mime)throw Error('No hay grabador de video compatible en este equipo');
 state.recordParts=[];state.recorder=new MediaRecorder(stream,{mimeType:mime});
 state.recorder.ondataavailable=e=>{if(e.data.size)state.recordParts.push(e.data)};
 state.recorder.start(1000);
 document.querySelector('[data-action="record-start"]').disabled=true;
 document.querySelector('[data-action="record-stop"]').disabled=false;
}
async function stopRecording(){
 if(!state.recorder)return;
 const r=state.recorder;await new Promise(resolve=>{r.addEventListener('stop',resolve,{once:true});r.stop()});
 if(state.recordStream)state.recordStream.getTracks().forEach(t=>t.stop());
 state.recordStream=null;state.recorder=null;
 const blob=new Blob(state.recordParts,{type:'video/webm'}),base64=await new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob)});
 const item=await api('assets:record',{projectId:state.project.id,name:'Grabación '+new Date().toLocaleString('es-EC'),data:base64});
 state.project=await api('projects:get',{id:state.project.id});
 const s=state.project.scenes[state.scene];const info=await api('media:metadata',{projectId:state.project.id,assetId:item.id});
 s.video=item.id;s.start=0;s.end=Math.min(info.duration,180);s.silences=[];s.approved=false;
 await saveNow();$('#modal-root').hidden=true;render();refreshWaveform();notice('Grabación guardada en disco D');
}
async function exportNow(kind){const key=kind==='short'?'render:short':'render:weekly';state.status='Preparando exportación local con FFmpeg…';state.progress=3;render();try{
 const result=await api(key,kind==='short'?{projectId:state.project.id}:{id:state.week.id});
 state.status='';notice('Video exportado: '+result.file);await loadLibrary();if(kind==='short')await openProject(state.project.id,state.scene);else await openWeek(state.week.id);
 }catch(e){state.status='';render();notice(e.message,true)}}
function playback(){const v=$('#speaker-preview');if(!v)return;const s=state.project.scenes[state.scene];if(v.paused){if(v.currentTime<s.start||v.currentTime>=s.end)v.currentTime=s.start;v.play().catch(e=>notice(e.message,true))}}
document.addEventListener('timeupdate',e=>{if(e.target?.id!=='speaker-preview')return;const s=state.project?.scenes[state.scene];if(!s)return;const v=e.target;if(s.end&&v.currentTime>=s.end){v.pause();return}for(const q of s.silences||[])if(q.remove&&v.currentTime>=q.start&&v.currentTime<q.end-.05){v.currentTime=q.end;break}},true);
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b)return;
 const action=b.dataset.action;try{
  if(['home','weeks','settings','legacy'].includes(action))return await navigate(action);
  if(action==='back')return await navigate('home');
  if(action==='new'){
   const name=prompt('Título del nuevo récord:','Nuevo récord');if(!name||!name.trim())return;
   const p=await api('projects:create',{title:name.trim()});await loadLibrary();return await openProject(p.id)
  }
  if(action==='open-project'){state.editingWeekId=null;return await openProject(b.dataset.id)}
  if(action==='open-week')return await openWeek(b.dataset.id);
  if(action==='new-week'){
   const w=await api('weekly:create',{title:'Récords de la semana'});await loadLibrary();return await openWeek(w.id)
  }
  if(action==='scene'){await saveNow();state.scene=b.dataset.id;render();return refreshWaveform()}
  if(action==='import-voice')return await importFor('voice');
  if(action==='import-media')return await importFor('media');
  if(action==='detect-silences')return await detect();
  if(action==='toggle-silence'){const s=state.project.scenes[state.scene];s.silences[Number(b.dataset.index)].remove=!s.silences[Number(b.dataset.index)].remove;s.approved=false;queueSave();return render()}
  if(action==='mark-all'||action==='unmark-all'){const s=state.project.scenes[state.scene];s.silences.forEach(q=>q.remove=action==='mark-all');s.approved=false;queueSave();return render()}
  if(action==='remove-media'||action==='move-media'){
   const s=state.project.scenes[state.scene],i=Number(b.dataset.index),j=i+Number(b.dataset.delta);
   if(action==='remove-media')s.media.splice(i,1);else if(j>=0&&j<s.media.length)[s.media[i],s.media[j]]=[s.media[j],s.media[i]];
   s.approved=false;queueSave();return render();
  }
  if(action==='approve-scene'){const s=state.project.scenes[state.scene];if(!s.video)throw Error('Primero sube o graba el video principal');
   s.approved=!s.approved;await saveNow();return render()}
  if(action==='orientation-short'||action==='orientation-wide'){state.orientation=action==='orientation-wide'?'wide':'short';return render()}
  if(action==='play-preview')return playback();
  if(action==='pause-preview'){const v=$('#speaker-preview');if(v)v.pause();return}
  if(action==='stop-preview'){const v=$('#speaker-preview');if(v){v.pause();v.currentTime=Number(state.project.scenes[state.scene].start)||0}return}
  if(action==='export-short'){await saveNow();if(!order.every(k=>state.project.scenes[k].approved))throw Error('Aprueba todas las escenas');return await exportNow('short')}
  if(action==='cancel-render'){await api('render:cancel');return notice('Cancelando proceso…')}
  if(action==='start-recorder')return await manageRecording();
  if(action==='record-start')return await startRecording();
  if(action==='record-stop')return await stopRecording();
  if(action==='modal-close'){if(state.recordStream)state.recordStream.getTracks().forEach(t=>t.stop());state.recordStream=null;$('#modal-root').hidden=true;return}
  if(action==='import-logo'){await api('assets:import-logo');state.settings=await api('settings:get');return render()}
  if(action==='save-settings'){state.settings.silenceThreshold=Number($('#silenceThreshold').value)||.5;state.settings.autoMicrocuts=$('#autoMicrocuts').checked;state.settings=await api('settings:set',state.settings);return notice('Preferencias guardadas')}
  if(action==='edit-week-intro'||action==='edit-week-closing'){
   state.editingWeekId=state.week.id;
   const entry=action==='edit-week-intro'?state.week.intro:state.week.closing;
   if(!entry)throw Error('No se encontró el proyecto auxiliar de la compilación');
   return await openProject(entry.projectId,entry.scene);
  }
  if(action==='return-week'){await saveNow();const id=state.editingWeekId;state.editingWeekId=null;return await openWeek(id)}
  if(action==='move-record'||action==='remove-record'||action==='add-record'){
   const w=state.week;
   if(action==='add-record'){const id=$('#add-record-select')?.value;if(!id)return;w.projectIds.push(id)}
   else if(action==='remove-record')w.projectIds=w.projectIds.filter(x=>x!==b.dataset.id);
   else{const i=Number(b.dataset.index),j=i+Number(b.dataset.delta);if(j>=0&&j<w.projectIds.length)[w.projectIds[i],w.projectIds[j]]=[w.projectIds[j],w.projectIds[i]]}
   await api('weekly:save',w);return await openWeek(w.id);
  }
  if(action==='export-week')return await exportNow('week');
 }catch(err){notice(err.message,true);console.error(err)}
});
document.addEventListener('change',e=>{
 const p=state.project;if(!p||state.page!=='project')return;
 const s=p.scenes[state.scene],el=e.target;
 if(el.dataset.field){s[el.dataset.field]=['start','end','scale'].includes(el.dataset.field)?Number(el.value):el.value;s.approved=false;queueSave();if(el.dataset.field==='start'||el.dataset.field==='end')render()}
 else if(el.dataset.formatField){
   if(!s.formats)s.formats={};
   if(!s.formats[state.orientation])s.formats[state.orientation]={};
   s.formats[state.orientation][el.dataset.formatField]=el.dataset.formatField==='scale'?Number(el.value):el.value;
   s.approved=false;queueSave();render();
 }
 else if(el.dataset.projectField){p[el.dataset.projectField]=el.value;order.forEach(k=>p.scenes[k].approved=false);queueSave();render()}
 else if(el.dataset.mediaSpeed!==undefined){s.media[Number(el.dataset.mediaSpeed)].speed=Number(el.value)||1;s.approved=false;queueSave()}
});
document.addEventListener('input',e=>{
 const el=e.target;if(el.dataset.field==='title'&&state.page==='project'){state.project.scenes[state.scene].title=el.value;state.project.scenes[state.scene].approved=false;queueSave()}
});
window.studio.onProgress(detail=>{state.status=detail.message||('Procesando segmentos: '+(detail.done||0));if(state.page==='project'||state.page==='week'){const banner=$('#view .panel:last-child');if(banner&&state.status)banner.dataset.progress=state.status}});
(async()=>{try{state.settings=await api('settings:get');await loadLibrary();render()}catch(e){$('#view').innerHTML='<div class="warning">No se pudo iniciar la aplicación: '+esc(e.message)+'</div>'}})();
