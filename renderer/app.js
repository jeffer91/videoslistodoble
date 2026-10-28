'use strict';
const $=s=>document.querySelector(s);
const state={page:'home',projects:[],weeks:[],project:null,week:null,scene:'hook',orientation:'short',settings:{},templates:[],globalAssets:[],globalTab:'backgrounds',projectFilter:'all',status:'',progress:0,recordStream:null,recordCapture:null,recordTimer:null,recorder:null,recordParts:[],recordDraft:null,recordDraftUrl:null,recordFormat:'square',recordStartAt:0,silencesOpen:false,editorPanel:'audio',cutZoom:1,cutSelection:{start:0,end:1},cutMode:'both',cutUndo:[],cutRedo:[],playSelectionOnly:false,recTarget:null,editingWeekId:null,waveforms:{},waveErrors:{},videoDurations:{},showSafe:false,previewIndex:-1,previewUrls:{},previewErrors:{},previewTimelines:{},previewPending:{},reviewKind:'short',reviewInfo:null,reviewBusy:false,reviewError:'',reviewOutput:null};
const names={hook:'Gancho',body:'Desarrollo',closing:'Cierre'};
const order=['hook','body','closing'];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url=(p,id)=>id?'records://asset/'+encodeURIComponent(p.id)+'/'+encodeURIComponent(id):'';
const value=(a,k,f)=>a?.[k]??f;
const fmt=s=>{const n=Number(s)||0;return Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0')};
async function api(key,payload){const r=await window.studio.call(key,payload||{});if(!r.ok)throw Error(r.error||'Error desconocido');return r.data}
function notice(msg,error=false){const el=$('#toast');el.textContent=msg;el.hidden=false;el.classList.toggle('error',error);clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.hidden=true,6500)}
async function loadLibrary(){const [projects,weeks,templates,globalAssets]=await Promise.all([api('projects:list'),api('weekly:list'),api('templates:list'),api('global:list')]);state.projects=projects;state.weeks=weeks;state.templates=templates;state.globalAssets=globalAssets}
function titlebar(title,description,buttons=''){return '<div class="topbar"><div><h1>'+esc(title)+'</h1><p>'+esc(description||'')+'</p></div><div class="row wrap">'+buttons+'</div></div>'}
function btn(action,label,cls='',attrs=''){return '<button data-action="'+action+'" class="'+cls+'" '+attrs+'>'+label+'</button>'}
function projectTile(p){return '<article class="card" data-action="open-project" data-id="'+esc(p.id)+'"><div class="row between"><span class="pill">'+(p.status==='exported'?'Short exportado':p.status==='auxiliary'?'Complementario':'En edición')+'</span><span class="muted mini">'+new Date(p.updatedAt).toLocaleDateString('es-EC')+'</span></div><h3>'+esc(p.title)+'</h3><div class="row between"><small>'+(p.exports||[]).length+' exportaciones · '+(p.usedBy||[]).length+' compilaciones</small><strong>Editar →</strong></div></article>'}
function home(){const list=state.projects.filter(p=>p.status!=='auxiliary');return titlebar('Mis proyectos','Tus récords, imágenes y grabaciones se conservan localmente.',btn('new','＋ Nuevo récord')+btn('new-week','Crear video semanal','secondary'))+(list.length?'<div class="grid">'+list.map(projectTile).join('')+'</div>':'<div class="empty"><h2>Empieza creando tu primer récord</h2><p>Sube tres videos, fotografías o clips de apoyo, edita y exporta tu Short.</p>'+btn('new','Crear primer proyecto')+'</div>')}
function weeksPage(){return titlebar('Compilaciones semanales','La app incorpora automáticamente los Shorts exportados que aún no se han utilizado.',btn('new-week','＋ Crear recopilación'))+(state.weeks.length?'<div class="grid">'+state.weeks.map(w=>'<article class="card" data-action="open-week" data-id="'+esc(w.id)+'"><div class="row between"><span class="pill">'+(w.exportedAt?'Exportada':'En edición')+'</span><small>'+new Date(w.createdAt).toLocaleDateString('es-EC')+'</small></div><h3>'+esc(w.title)+'</h3><small>'+w.projectIds.length+' récords</small><strong>Revisar →</strong></article>').join('')+'</div>':'<div class="empty">Todavía no hay recopilaciones. Exporta Shorts y crea el primer video largo.</div>')}
function assetLabel(asset){return asset.type==='video'?'▣':asset.type==='image'?'▧':'♫'}
function assetPicker(p,onlyVideo){const as=p.assets.filter(a=>onlyVideo?a.type==='video':a.type==='video'||a.type==='image');return as.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>').join('')}
function mediaRows(){
 const p=state.project,s=p.scenes[state.scene];
 if(state.scene==='closing')return '<p class="muted mini">El cierre presenta al narrador en primer plano y no necesita recursos de apoyo.</p>';
 return '<div class="list">'+(s.media||[]).map((m,i)=>{
  const a=p.assets.find(x=>x.id===m.assetId);if(!a)return '';
  let controls='';
  if(a.type==='video'){
   controls='<div class="row wrap" style="margin-top:9px">'+
    '<label class="mini">Desde (s) <input style="width:76px" type="number" min="0" step=".1" data-media-start="'+i+'" value="'+(m.start||0)+'"></label>'+
    '<label class="mini">Hasta (s, 0 = final) <input style="width:80px" type="number" min="0" step=".1" data-media-end="'+i+'" value="'+(m.end||0)+'"></label>'+
    '<label class="mini">Velocidad <select data-media-speed="'+i+'">'+[1,1.1,1.2].map(v=>'<option value="'+v+'" '+(Number(m.speed||1)===v?'selected':'')+'>'+v.toFixed(1)+'×</option>').join('')+'</select></label>'+
    '<label class="mini"><input type="checkbox" data-media-micro="'+i+'" '+(m.microcuts!==false?'checked':'')+'> Microcortes</label>'+
    '</div>';
  }
  return '<div class="asset" style="display:block"><div class="row between"><div class="row">'+(a.type==='image'?'<img class="asset-thumb" src="'+url(p,a.id)+'" alt="">':'<span class="fileicon">'+assetLabel(a)+'</span>')+'<div><strong>'+esc(a.name)+'</strong><small style="display:block">'+(a.type==='video'?'Clip de apoyo · audio silenciado':'Fotografía original')+'</small></div></div>'+
   '<div class="row">'+btn('move-media','↑','secondary','data-index="'+i+'" data-delta="-1"')+btn('move-media','↓','secondary','data-index="'+i+'" data-delta="1"')+btn('remove-media','×','danger','data-index="'+i+'"')+'</div></div>'+controls+'</div>';
 }).join('')+'</div><p class="muted mini">Puedes seleccionar múltiples imágenes o pegar una captura desde Windows o el navegador con Ctrl+V. Los recursos se muestran en secuencia.</p>';
}

function editorDuration(){
 if(!state.project)return 0;
 const scene=state.project.scenes[state.scene];
 const id=state.project.id+':'+scene.video,el=$('#speaker-preview');
 const fromVideo=Number(el?.duration),duration=Number(state.videoDurations[id])||Number(scene.end)|| (Number.isFinite(fromVideo)?fromVideo:0);
 return Math.min(180,Math.max(0,duration));
}
function rangeSelection(){
 const duration=editorDuration(),a=Math.max(0,Math.min(duration,Number(state.cutSelection.start)||0));
 const b=Math.max(a,Math.min(duration,Number(state.cutSelection.end)||0));
 return {start:a,end:b};
}
function updateCutMarker(which,value,preview=false){
 const duration=editorDuration();if(!duration)return;
 const minGap=.06,selection=rangeSelection();
 const val=Math.max(0,Math.min(duration,Number(value)||0));
 if(which==='a')state.cutSelection.start=Math.min(val,Math.max(0,selection.end-minGap));
 else state.cutSelection.end=Math.max(val,Math.min(duration,selection.start+minGap));
 if(!preview)return render();
 const container=$('#edit-wave-content'),a=$('[data-trim-drag="a"]'),b=$('[data-trim-drag="b"]'),highlight=$('#edit-wave-selection');
 const selectionNow=rangeSelection();
 if(container&&a&&b&&highlight){
  a.style.left=100*selectionNow.start/duration+'%';
  b.style.left=100*selectionNow.end/duration+'%';
  highlight.style.left=100*selectionNow.start/duration+'%';
  highlight.style.width=100*(selectionNow.end-selectionNow.start)/duration+'%';
 }
 const ia=$('#cut-marker-a'),ib=$('#cut-marker-b');
 if(ia)ia.value=selectionNow.start.toFixed(2);
 if(ib)ib.value=selectionNow.end.toFixed(2);
}
function editTypeName(mode){return mode==='audio'?'Silenciar audio':mode==='video'?'Congelar imagen':'Eliminar audio + video'}
function waveformEditorHTML(scene){
 const id=state.project.id+':'+scene.video,peaks=state.waveforms[id]||[],duration=editorDuration();
 if(!scene.video)return '<p class="muted mini">Importa o graba un video para editarlo.</p>';
 if(!duration)return '<div class="wave-loading"><strong>Preparando editor de recortes…</strong><p class="muted mini">'+esc(state.waveErrors[id]||'Leyendo duración de la grabación. Los marcadores aparecerán automáticamente.')+'</p>'+btn('retry-waveform','↻ Reintentar carga','secondary')+'</div>';
 const selection=rangeSelection(),zoom=Math.max(1,Math.min(8,Number(state.cutZoom)||1));
 const width=Math.min(23000,Math.round(Math.max(590,duration*4)*zoom));
 const viewPeaks=peaks.length?peaks:Array.from({length:Math.min(1800,Math.ceil(duration*10))},()=>0);
 const count=Math.min(viewPeaks.length,Math.ceil(width/2.6)),barWidth=width/count;
 const rendered=[];
 const actualWaveDuration=Math.min(180,duration),sampleStep=actualWaveDuration/viewPeaks.length;
 for(let i=0;i<count;i++){
  const index=Math.min(viewPeaks.length-1,Math.floor(i*viewPeaks.length/count));
  const t=index*sampleStep,peak=Math.min(1,Number(viewPeaks[index])||0);
  const height=Math.max(2,peak*56);
  rendered.push('<rect x="'+(i*barWidth).toFixed(2)+'" y="'+((66-height)/2).toFixed(2)+'" width="'+Math.max(1,barWidth-.8).toFixed(2)+'" height="'+height.toFixed(2)+'" fill="#76bce8" rx=".6"/>');
 }
 const marked=[
  ...(scene.silences||[]).filter(c=>c.remove).map(c=>({...c,mode:'both'})),
  ...(scene.cuts||[])
 ];
 const overlays=marked.map(c=>{
  const a=Math.max(0,Math.min(duration,Number(c.start)||0)),b=Math.max(a,Math.min(duration,Number(c.end)||0));
  const color=c.mode==='audio'?'rgba(218,161,63,.34)':c.mode==='video'?'rgba(130,94,215,.34)':'rgba(207,71,83,.35)';
  return '<div class="wave-edit-range" title="'+esc(editTypeName(c.mode))+'" style="left:'+(100*a/duration)+'%;width:'+(100*(b-a)/duration)+'%;background:'+color+'"></div>';
 }).join('');
 const ticks=[];const step=duration<=12?1:duration<=30?2:duration<=70?5:10;
 for(let t=0;t<=duration;t+=step)ticks.push('<span class="wave-tick" style="left:'+(100*t/duration)+'%">'+fmt(t)+'</span>');
 return '<div class="wave-editor">'+(state.waveErrors[id]?'<p class="wave-error">'+esc(state.waveErrors[id])+' '+btn('retry-waveform','Reintentar','secondary')+'</p>':'')+
  '<div class="row between wave-controls"><strong>Ondas de voz</strong><label class="row mini">Zoom <input type="range" data-cut-zoom min="1" max="8" step="1" value="'+zoom+'"> '+zoom+'×</label></div>'+
  '<div class="wave-scroll" id="edit-wave-scroll"><div class="wave-content" id="edit-wave-content" style="width:'+width+'px" data-wave-seek="1">'+
   '<div class="wave-ruler">'+ticks.join('')+'</div>'+
   '<div class="wave-bars">'+
    '<svg viewBox="0 0 '+width+' 66" preserveAspectRatio="none" aria-label="Forma de onda del audio">'+rendered.join('')+'</svg>'+
   '</div>'+overlays+
   '<div id="edit-wave-selection" class="wave-current-selection" style="left:'+(100*selection.start/duration)+'%;width:'+(100*(selection.end-selection.start)/duration)+'%"></div>'+
   '<div id="edit-wave-playhead" class="wave-playhead" style="left:0%"></div>'+
   '<button type="button" class="wave-handle" data-trim-drag="a" style="left:'+(100*selection.start/duration)+'%" title="Arrastra el inicio">A</button>'+
   '<button type="button" class="wave-handle" data-trim-drag="b" style="left:'+(100*selection.end/duration)+'%" title="Arrastra el final">B</button>'+
  '</div></div>'+
  '<div class="row between wave-legend"><span>Rojo: eliminar · Amarillo: silenciar · Violeta: congelar</span><span>'+fmt(duration)+' total</span></div>'+
  '<div class="two"><div class="field"><label>Marcador A (segundos)</label><input id="cut-marker-a" type="number" data-cut-marker="a" step=".01" min="0" max="'+duration+'" value="'+selection.start.toFixed(2)+'"></div>'+
  '<div class="field"><label>Marcador B (segundos)</label><input id="cut-marker-b" type="number" data-cut-marker="b" step=".01" min="0" max="'+duration+'" value="'+selection.end.toFixed(2)+'"></div></div>'+
  '<div class="row wrap cut-actions">'+
   btn('play-cut','▶ Escuchar selección','secondary')+
   btn('cut-mode','Audio + video',state.cutMode==='both'?'active':'secondary','data-mode="both"')+
   btn('cut-mode','Solo audio',state.cutMode==='audio'?'active':'secondary','data-mode="audio"')+
   btn('cut-mode','Solo video',state.cutMode==='video'?'active':'secondary','data-mode="video"')+
   btn('cut-add','✂ Aplicar recorte')+
  '</div></div>';
}
function recutListHTML(scene){
 const cuts=scene.cuts||[];
 return '<div class="row between cut-list-head"><strong>Recortes aplicados: '+cuts.length+'</strong><div class="row">'+
 btn('cut-undo','Deshacer','secondary',state.cutUndo.length?'':'disabled')+
 btn('cut-redo','Rehacer','secondary',state.cutRedo.length?'':'disabled')+
 '</div></div>'+
 (cuts.length?'<div class="cut-list">'+cuts.map((c,i)=>'<div class="cut-chip"><span>'+esc(editTypeName(c.mode))+' · '+Number(c.start).toFixed(2)+'–'+Number(c.end).toFixed(2)+' s</span>'+btn('cut-remove','×','danger','data-index="'+i+'" title="Eliminar este recorte"')+'</div>').join('')+'</div>':'<p class="muted mini">Sin recortes manuales. Los originales se conservan intactos.</p>');
}
function silenceTimeline(scene){
 return '<details class="minor-details"><summary>Detección automática de silencios ('+(scene.silences||[]).length+')</summary>'+
 '<p class="muted mini">Puedes marcar silencios detectados para eliminar audio y video a la vez. Un suspiro también se puede seleccionar manualmente con A y B.</p>'+
 '<div class="row wrap">'+btn('detect-silences','Detectar silencios','secondary')+btn('mark-all','Marcar todos','secondary')+btn('unmark-all','Conservar todos','secondary')+'</div>'+
 '<div class="cut-list">'+(scene.silences||[]).map((s,i)=>'<button class="silence-item '+(s.remove?'removed':'kept')+'" data-action="toggle-silence" data-index="'+i+'">'+Number(s.start).toFixed(2)+'–'+Number(s.end).toFixed(2)+' s · '+(s.remove?'Eliminar':'Conservar')+'</button>').join('')+'</div></details>';
}

function selectedTemplate(project,format,sceneKey=state.scene){
 const scene=project?.scenes?.[sceneKey],id=Object.prototype.hasOwnProperty.call(scene?.backgrounds||{},format)
  ?scene.backgrounds[format]:(project?.backgrounds?.[format]||null);
 if(id&&typeof id==='object'&&id.scope==='project'){
  const asset=project.assets.find(a=>a.id===id.assetId);
  return asset?.type==='image'?{id:asset.id,assetId:asset.id,scope:'project',name:asset.name,format}:null;
 }
 return state.templates.find(t=>t.id===id&&t.format===format)||null;
}
function templateUrl(t){return t?(t.scope==='project'?url(state.project,t.assetId):'records://template/'+encodeURIComponent(t.id)):''}
function templateGallery(format){
 const items=state.templates.filter(t=>t.format===format),defaultId=state.settings.templateDefaults?.[format]||null;
 return '<section class="template-section"><h3>'+(format==='short'?'Shorts 9:16':'Videos largos 16:9')+'</h3>'+
 '<div class="row wrap template-toolbar">'+btn('template-upload','＋ Subir imágenes','secondary','data-format="'+format+'"')+
 btn('template-paste','▣ Pegar imagen','outline','data-format="'+format+'"')+'</div>'+
 '<div class="template-grid">'+(items.length?items.map(item=>'<div class="template-tile">'+
 '<img loading="lazy" src="'+templateUrl(item)+'" alt="'+esc(item.name)+'"><strong title="'+esc(item.name)+'">'+esc(item.name)+'</strong>'+
 (defaultId===item.id?'<span class="pill">Predeterminada</span>'+btn('template-clear-default','Quitar predeterminado','secondary','data-format="'+format+'"'):btn('template-default','Usar por defecto','secondary','data-format="'+format+'" data-id="'+item.id+'"'))+
 '<div class="row wrap">'+btn('template-rename','Renombrar','secondary','data-id="'+item.id+'"')+
 btn('template-delete','Eliminar','danger','data-id="'+item.id+'"')+'</div></div>').join(''):'<p class="muted mini">Sin fondos. Sube una imagen para empezar.</p>')+
 '</div></section>';
}
function backgroundChooser(){
 const format=state.orientation,scene=state.project?.scenes?.[state.scene];
 const current=Object.prototype.hasOwnProperty.call(scene?.backgrounds||{},format)?scene.backgrounds[format]:state.project?.backgrounds?.[format]||null;
 const list=state.templates.filter(t=>t.format===format),local=(state.project?.assets||[]).filter(a=>a.type==='image'),root=$('#modal-root');
 root.hidden=false;
 root.innerHTML='<div class="modalback"><div class="modal template-picker">'+
 '<div class="row between"><h2>Fondo '+(format==='short'?'9:16':'16:9')+'</h2>'+btn('template-picker-close','× Cerrar','secondary')+'</div>'+
 '<p class="muted mini">Fondo exclusivo para '+names[state.scene]+'. Las otras escenas conservan el suyo.</p>'+
 '<div class="row wrap">'+btn('project-template-upload','＋ Subir fondo','secondary')+
 btn('project-template-paste','▣ Pegar al proyecto','outline')+
 btn('project-template-inherit','Heredar fondo general','secondary')+
 btn('project-template-select','Sin fondo','secondary','data-id=""')+'</div>'+
 '<h3 class="library-heading">Biblioteca general</h3>'+
 '<div class="template-grid template-modal-grid">'+list.map(t=>
 '<button class="template-choice '+(t.id===current?'selected':'')+'" data-action="project-template-select" data-id="'+t.id+'">'+
 '<img src="'+templateUrl(t)+'" alt=""><span>'+esc(t.name)+'</span></button>').join('')+'</div>'+
 '<h3 class="library-heading">Imágenes de este proyecto</h3>'+
 (local.length?'<div class="template-grid template-modal-grid">'+local.map(a=>
 '<button class="template-choice" data-action="project-template-local" data-id="'+a.id+'"><img src="'+url(state.project,a.id)+'" alt=""><span>'+esc(a.name)+'</span></button>').join('')+'</div>':'<p class="muted mini">No hay imágenes exclusivas. Usa «Subir fondo» para añadir una.</p>')+'</div></div>';
}
async function importTemplate(format,paste=false,assign=false){
 let files=[],errors=[];
 if(paste)files=[await api('templates:paste',{format})];
 else{
  const response=await api('templates:import',{format});
  files=response.files||[];errors=response.errors||[];
 }
 if(files.length){
  // La importación no cambia los fondos predeterminados sin una elección explícita.
  state.templates=await api('templates:list');
  if(assign&&state.project){
   const scene=state.project.scenes[state.scene];scene.backgrounds={...(scene.backgrounds||{}),[format]:files[0].id};
   scene.approved=false;
   await saveNow();
   const modal=$('#modal-root');modal.hidden=true;modal.innerHTML='';
  }
  render();notice(files.length+' fondo(s) guardado(s) en el disco D');
 }else if(errors.length)notice(errors[0].name+': '+errors[0].message,true);
 if(assign&&!files.length)backgroundChooser();
}
function sceneView(){
 const p=state.project,s=p.scenes[state.scene],video=p.assets.find(a=>a.id===s.video),media=(s.media||[]).map(m=>p.assets.find(a=>a.id===m.assetId)).filter(Boolean),first=media[0];
 const wide=state.orientation==='wide',style=p.style,appearance=(s.formats||{})[state.orientation]||s;
 const currentBackground=selectedTemplate(p,state.orientation);
 const speakerPos=state.scene==='closing'?'50%':appearance.position==='right'?(wide?'73%':'55%'):appearance.position==='center'?(wide?'40%':'31%'):(wide?'3%':'8%');
 const presenterStyle='left:'+speakerPos+';transform:scale('+(Number(appearance.scale||65)/65).toFixed(2)+');transform-origin:bottom center;--closing-scale:'+(Math.max(.8,Math.min(1.35,(Number(appearance.scale)||95)/95))).toFixed(2);
 const previewSrc=video?(state.previewUrls[p.id+':'+video.id]||''):'';
 const preview=video?'<video class="speaker" id="speaker-preview" data-asset="'+esc(video.id)+'" style="'+presenterStyle+'" '+(previewSrc?'src="'+previewSrc+'"':'')+' playsinline preload="metadata"></video>'+
  '<video class="speaker speaker-frozen" id="speaker-frozen" style="'+presenterStyle+'" '+(previewSrc?'src="'+previewSrc+'"':'')+' muted playsinline preload="metadata" hidden></video>':'';
 let bg='';
 if(currentBackground)bg='<img class="template-back" src="'+templateUrl(currentBackground)+'" alt="Fondo del video">';
 else if(first&&first.type==='image')bg='<img class="back" src="'+url(p,first.id)+'">';
 else bg='<div class="fallback-back"></div>';
 if(state.scene!=='closing'){
  bg+='<img class="photo" id="support-image" src="'+(first&&first.type==='image'?url(p,first.id):'')+'" '+(first&&first.type==='image'?'':'hidden')+' alt="Fotografía de apoyo">';
  bg+='<video class="photo" id="support-video" muted playsinline preload="metadata" hidden></video>';
 }
 const previewHTML='<div class="stage '+(wide?'wide ':'')+'style-'+style+' '+(state.scene==='closing'?'closing':'')+'">'+bg+'<div class="headline">'+esc(s.title||p.title)+'</div>'+preview+(state.scene==='closing'?'<div class="follow">SÍGUENOS</div>':'')+(state.settings.logo?'<img class="logo-moving" src="records://settings/logo" alt="Logo del canal">':'')+'</div>';
 const approved=order.every(k=>p.scenes[k].approved);
 const open=k=>state.editorPanel===k?' open':'';
 const details=(key,summary,content)=>'<details name="scene-tool" data-tool="'+key+'" class="panel panel-fold scene-tool"'+open(key)+'><summary>'+summary+'</summary>'+content+'</details>';
 const recording= '<div class="field"><label>Video principal con tu narración</label><div class="row wrap">'+(video?'<span class="pill">'+esc(video.name)+'</span>':'<span class="muted">Sin grabación</span>')+btn('import-voice','＋ Importar grabación','secondary')+btn('start-recorder','● Grabar ahora','outline')+'</div></div>'+
 '<div class="field"><label>Título del récord</label><input maxlength="120" data-field="title" value="'+esc(s.title||p.title)+'"></div>'+
 '<div class="two"><div class="field"><label>Cifra (opcional)</label><input maxlength="18" data-field="number" value="'+esc(s.number||'')+'"></div><div class="field"><label>Protagonista (opcional)</label><input maxlength="50" data-field="name" value="'+esc(s.name||'')+'"></div></div>'+
 '<div class="field"><label>Fondo de '+names[state.scene]+' ('+(wide?'16:9':'9:16')+')</label><div class="row template-project-choice">'+(currentBackground?'<img src="'+templateUrl(currentBackground)+'" alt="">':'<div class="template-empty">Sin fondo</div>')+'<div class="template-choice-info"><strong>'+esc(currentBackground?.name||'Fondo desenfocado')+'</strong><small>'+(currentBackground?'Biblioteca de fondos':'Fondo automático')+'</small></div>'+btn('choose-template','Cambiar fondo','secondary')+'</div></div>'+
 '<div class="field"><label>Plantilla visual del proyecto</label><select data-project-field="style"><option value="historic" '+(style==='historic'?'selected':'')+'>Récord histórico</option><option value="numbers" '+(style==='numbers'?'selected':'')+'>Récord en cifras</option><option value="legends" '+(style==='legends'?'selected':'')+'>Leyendas y récords</option></select></div>'+
 '<div class="two"><div class="field"><label>Composición</label><select data-format-field="layout"><option value="auto" '+(appearance.layout==='auto'?'selected':'')+'>Automática</option><option value="manual" '+(appearance.layout==='manual'?'selected':'')+'>Manual</option></select></div><div class="field"><label>Posición presentador</label>'+(state.scene==='closing'?'<input value="Centro · primer plano" disabled>':'<select data-format-field="position">'+['left','right','center'].map(k=>'<option value="'+k+'" '+(appearance.position===k?'selected':'')+'>'+({left:'Izquierda',right:'Derecha',center:'Centro'}[k])+'</option>').join('')+'</select>')+'</div></div>'+
 '<div class="field"><label>Tamaño del presentador ('+(appearance.scale||65)+'%)</label><input type="range" min="30" max="100" data-format-field="scale" value="'+(appearance.scale||65)+'"></div>';
 const resources=(state.scene==='closing'?'':'<div class="row wrap">'+btn('import-media','＋ Importar imágenes y videos','secondary')+btn('paste-image','▣ Pegar imagen','outline')+btn('choose-project-media','Desde biblioteca del proyecto','secondary')+'</div>')+mediaRows();
 const audio='<p class="muted mini">Mueve A y B sobre la onda para seleccionar el suspiro u otra parte. El original nunca se borra.</p>'+
 '<div class="two"><div class="field"><label>Inicio del video (s)</label><input type="number" min="0" step="0.1" data-field="start" value="'+(s.start||0)+'"></div><div class="field"><label>Final del video (s)</label><input type="number" min="0" step="0.1" data-field="end" value="'+(s.end||0)+'"></div></div>'+
 waveformEditorHTML(s)+recutListHTML(s)+silenceTimeline(s);
 return titlebar(p.title,'Proyecto local · se guarda automáticamente',btn('back','← Mis proyectos','secondary')+btn('project-library','Biblioteca del proyecto','secondary')+(state.editingWeekId?btn('return-week','Volver al video semanal','secondary'):'')+btn('open-review','▶ Revisar video completo'))+
 '<div class="steps">'+order.map(k=>'<button data-action="scene" data-id="'+k+'" class="step '+(k===state.scene?'active':'')+'">'+(p.scenes[k].approved?'✓ ':'')+names[k]+'</button>').join('')+'<button data-action="open-review" class="step">▶ Revisar</button></div>'+
 '<div class="stagegrid"><section><div class="panel preview-panel"><div class="row between"><h2>Vista previa</h2><div class="row">'+btn('orientation-short','9:16','secondary')+btn('orientation-wide','16:9','secondary')+'</div></div>'+
 previewHTML+'<div class="preview-status" id="preview-status">'+(video?(previewSrc?'Video listo':'Preparando reproducción compatible…'):'Importa una grabación')+'</div><div class="row wrap playback-controls">'+btn('play-preview','▶ Reproducir')+btn('pause-preview','Ⅱ Pausa','secondary')+btn('stop-preview','■ Detener','secondary')+btn('retry-preview','↻ Reparar video','secondary')+'</div></div></section>'+
 '<section class="scene-tools">'+
 details('recording','Grabación y composición'+(video?' · '+esc(video.name):' · Sin grabación'),recording)+
 details('resources','Recursos visuales · '+(s.media||[]).length,resources)+
 details('audio','Audio y recortes'+((s.cuts||[]).length?' · '+s.cuts.length+' recorte(s)':''),audio)+
 '<div class="panel approval-panel"><span class="pill">'+(s.approved?'Escena aprobada':'Pendiente de aprobación')+'</span>'+btn('approve-scene',s.approved?'Modificar aprobación':'✓ Aprobar escena',s.approved?'secondary':'')+'</div></section></div>'+
 (state.status?'<div class="panel"><strong>'+esc(state.status)+'</strong><div class="progressbar"><div style="width:'+state.progress+'%"></div></div>'+btn('cancel-render','Cancelar exportación','danger')+'</div>':'');
}

function globalMediaUrl(item){return 'records://global-media/'+encodeURIComponent(item.id)}
function globalLibraryPage(){
 const tab=state.globalTab,buttons=btn('global-tab','Fondos',tab==='backgrounds'?'active':'secondary','data-tab="backgrounds"')+
  btn('global-tab','Fotos y clips',tab==='media'?'active':'secondary','data-tab="media"');
 const current=state.project?'<span class="pill">Proyecto conectado: '+esc(state.project.title)+'</span>':'<span class="muted mini">Abre un proyecto para copiar recursos directamente.</span>';
 const mediaControls='<div class="row wrap">'+btn('global-import','＋ Importar fotos o clips','secondary')+btn('global-paste','▣ Pegar imagen','outline')+'</div>';
 const cards=state.globalAssets.length?'<div class="library-grid">'+state.globalAssets.map(item=>'<article class="library-card">'+
  (item.type==='image'?'<img loading="lazy" src="'+globalMediaUrl(item)+'" alt="'+esc(item.name)+'">':'<div class="library-video">▣ Video</div>')+
  '<strong title="'+esc(item.name)+'">'+esc(item.name)+'</strong><small>'+esc(item.type==='image'?'Imagen compartida':'Video compartido')+'</small>'+
  '<div class="row wrap">'+(state.project?btn('global-copy-project','Copiar al proyecto','','data-id="'+item.id+'"'):'')+
  btn('global-rename','Renombrar','secondary','data-id="'+item.id+'"')+btn('global-delete','Eliminar','danger','data-id="'+item.id+'"')+'</div></article>').join('')+'</div>':'<div class="empty">No hay fotos ni clips compartidos. Importa tus primeros recursos.</div>';
 return titlebar('Biblioteca general','Fondos y medios disponibles para todos tus proyectos')+
  '<div class="panel"><div class="row wrap">'+buttons+'</div><p class="muted mini">Los fondos y medios se guardan en Recursos del disco D; los proyectos mantienen sus propios originales.</p>'+current+'</div>'+
  (tab==='backgrounds'?'<div class="panel"><h2>Fondos reutilizables</h2>'+templateGallery('short')+templateGallery('wide')+'</div>':
   '<div class="panel"><div class="row between"><h2>Fotografías y videos compartidos</h2>'+mediaControls+'</div>'+cards+'</div>');
}
function assetUsedInProject(project,item){
 return order.flatMap(key=>{
  const scene=project.scenes[key];if(!scene)return [];
  const used=[];
  if(scene.video===item.id)used.push(names[key]+' · narración');
  if((scene.media||[]).some(m=>m.assetId===item.id))used.push(names[key]+' · apoyo');
  if(Object.values(scene.backgrounds||{}).some(bg=>bg?.scope==='project'&&bg.assetId===item.id))used.push(names[key]+' · fondo');
  return used;
 });
}
function projectLibraryPage(){
 const p=state.project;if(!p)return titlebar('Biblioteca del proyecto','Abre un proyecto para acceder a sus recursos')+btn('home','Mis proyectos','secondary');
 const filters=['all','image','video'];
 const tabs=filters.map(k=>btn('project-filter',({all:'Todos',image:'Fotos',video:'Videos'}[k]),state.projectFilter===k?'active':'secondary','data-type="'+k+'"')).join('');
 const items=p.assets.filter(a=>state.projectFilter==='all'||a.type===state.projectFilter);
 const cards=items.length?'<div class="library-grid">'+items.map(a=>{
  const usage=assetUsedInProject(p,a),isVideo=a.type==='video';
  return '<article class="library-card">'+(a.type==='image'?'<img loading="lazy" src="'+url(p,a.id)+'" alt="'+esc(a.name)+'">':'<div class="library-video">'+(isVideo?'▣ Video':'♫ Audio')+'</div>')+
   '<strong title="'+esc(a.name)+'">'+esc(a.name)+'</strong>'+
   '<small>'+(usage.length?esc(usage.join(' · ')):'Sin asignar · disponible para reutilizar')+'</small>'+
   '<div class="row wrap">'+(a.type==='image'?btn('project-asset-background','Fondo '+names[state.scene],'secondary','data-id="'+a.id+'"'):'')+
   ((isVideo||a.type==='image')&&state.scene!=='closing'?btn('project-asset-attach','Apoyo '+names[state.scene],'secondary','data-id="'+a.id+'"'):'')+
   (isVideo?btn('project-asset-voice','Narración '+names[state.scene],'secondary','data-id="'+a.id+'"'):'')+
   btn('project-asset-publish','Compartir en general','secondary','data-id="'+a.id+'"')+
   btn('project-asset-rename','Renombrar','secondary','data-id="'+a.id+'"')+
   btn('project-asset-delete','Eliminar','danger','data-id="'+a.id+'"')+'</div></article>';
 }).join('')+'</div>':'<div class="empty">No hay recursos de este tipo en el proyecto.</div>';
 return titlebar('Biblioteca del proyecto',p.title,btn('open-current-project','← Volver al editor','secondary'))+
 '<div class="panel"><div class="row between"><h2>Mis recursos</h2><div class="row wrap">'+btn('project-assets-upload','＋ Subir fotos o videos','secondary')+btn('project-assets-paste','▣ Pegar imagen','outline')+'</div></div>'+
 '<p class="muted mini">Las imágenes y grabaciones permanecen aquí aunque las quites de una escena. Eliminar definitivamente requiere que no estén en uso.</p>'+
 '<div class="row wrap">'+tabs+'</div>'+cards+'</div>';
}
function projectMediaPicker(){
 const p=state.project,usable=(p?.assets||[]).filter(a=>a.type==='image'||a.type==='video'),root=$('#modal-root');
 root.hidden=false;root.innerHTML='<div class="modalback"><div class="modal template-picker">'+
 '<div class="row between"><h2>Elegir apoyo para '+names[state.scene]+'</h2>'+btn('template-picker-close','× Cerrar','secondary')+'</div>'+
 '<p class="muted mini">Estas fotografías y clips ya están guardados en este proyecto. No se duplican.</p>'+
 '<div class="library-grid">'+usable.map(a=>'<div class="library-card">'+(a.type==='image'?'<img src="'+url(p,a.id)+'" alt="">':'<div class="library-video">▣ Video</div>')+
 '<strong>'+esc(a.name)+'</strong>'+btn('picker-attach','Usar en '+names[state.scene],'secondary','data-id="'+a.id+'"')+'</div>').join('')+'</div></div></div>';
}
async function refreshProjectAssets(){state.project=await api('projects:get',{id:state.project.id});render()}
async function setSceneBackground(id){
 const a=state.project?.assets.find(x=>x.id===id);
 if(!a||a.type!=='image')throw Error('Selecciona una imagen de la biblioteca del proyecto');
 const scene=state.project.scenes[state.scene];
 scene.backgrounds={...(scene.backgrounds||{}),[state.orientation]:{scope:'project',assetId:id}};
 scene.approved=false;await saveNow();render();
}
async function attachExisting(id){
 const a=state.project?.assets.find(x=>x.id===id);
 if(!a||!['image','video'].includes(a.type))throw Error('Recurso inexistente');
 if(state.scene==='closing')throw Error('El cierre está reservado para el presentador y su fondo');
 const scene=state.project.scenes[state.scene];
 if(!scene.media)scene.media=[];
 scene.media.push({assetId:id,start:0,end:0,speed:1,microcuts:true});
 scene.approved=false;await saveNow();render();prepareScenePreview();
}
async function assignNarration(id){
 const a=state.project.assets.find(x=>x.id===id);
 if(!a||a.type!=='video')throw Error('Selecciona un video');
 const info=await api('media:metadata',{projectId:state.project.id,assetId:id});
 const scene=state.project.scenes[state.scene];
 scene.video=id;scene.start=0;scene.end=Math.min(180,info.duration||0);scene.cuts=[];scene.silences=[];scene.approved=false;
 await saveNow();resetCutEditor();render();refreshWaveform();prepareScenePreview();
}
async function uploadProjectOnly(kind='media',paste=false){
 if(!state.project)throw Error('Abre un proyecto primero');
 await saveNow();
 const response=paste?{files:[await api('assets:paste-image',{projectId:state.project.id})],errors:[]}
  :await api('assets:import',{projectId:state.project.id,kind});
 await refreshProjectAssets();
 const files=(response.files||[]).filter(Boolean),errors=response.errors||[];
 if(errors.length)notice(errors[0].name+': '+errors[0].message,true);
 else if(files.length)notice(files.length+' recurso(s) guardado(s) en la biblioteca del proyecto');
 return files;
}
function renameResourceModal(scope,id,name){
 const modal=$('#modal-root');modal.hidden=false;
 modal.innerHTML='<div class="modalback"><div class="modal"><h2>Renombrar recurso</h2>'+
 '<div class="field"><label>Nombre</label><input id="library-rename-name" maxlength="120" value="'+esc(name)+'"></div>'+
 '<div class="row wrap">'+btn('library-rename-confirm','Guardar','','data-scope="'+scope+'" data-id="'+id+'"')+btn('template-picker-close','Cancelar','secondary')+'</div></div></div>';
}
function deleteResourceModal(scope,id,name){
 const modal=$('#modal-root');modal.hidden=false;
 modal.innerHTML='<div class="modalback"><div class="modal"><h2>Eliminar recurso</h2><p>¿Eliminar <strong>'+esc(name)+'</strong>? Esta operación borra el archivo de esa biblioteca. Los recursos en uso en el proyecto están protegidos.</p>'+
 '<div class="row wrap">'+btn('library-delete-confirm','Eliminar','danger','data-scope="'+scope+'" data-id="'+id+'"')+
 btn('template-picker-close','Cancelar','secondary')+'</div></div></div>';
}

function reviewPage(){
 const short=state.reviewKind==='short',m=state.reviewInfo,busy=state.reviewBusy;
 const title=short?state.project?.title:state.week?.title;
 const back=btn('review-back','← Volver '+(short?'al editor':'a la compilación'),'secondary');
 const chapters=m?.chapters||[],duration=m?.duration||0;
 const preview=m?.ready?'<video id="final-review-video" controls playsinline preload="metadata" src="'+esc(m.url)+'"></video>':
  '<div class="review-empty"><span>▶</span><strong>'+ (busy?'Generando MP4…':'Vista previa pendiente')+'</strong>'+
  '<small>'+(m?.missing?.length?'Completa las escenas indicadas':'Genera el video para revisar el montaje real')+'</small></div>';
 const timeline=duration?'<div class="review-timeline">'+chapters.map((c,i)=>
  '<button data-action="review-seek" data-start="'+c.start+'" class="review-part review-color-'+i%3+'" style="flex:'+Math.max(2,c.duration)+'" title="'+esc(c.label)+'">'+esc(c.transition?'·':c.label)+'</button>').join('')+'</div>':'';
 const progress=busy?'<div class="review-working"><span class="review-spinner"></span><div><strong>Preparando video completo</strong><small id="review-progress-msg">Aplicando los recortes y fondos…</small></div>'+
  btn('cancel-render','Cancelar','danger')+'</div>':'';
 const warning=state.reviewError?'<div class="warning">'+esc(state.reviewError)+'</div>':
  m?.missing?.length?'<div class="warning">Debes completar: '+m.missing.map(esc).join('; ')+'</div>':'';
 const parts=short?order.map(k=>{
  const c=chapters.find(c=>c.scene===k),s=state.project.scenes[k];
  return {projectId:state.project.id,scene:k,label:names[k],start:c?.start||0,duration:c?.duration||0,approved:s.approved};
 }):chapters.filter(c=>!c.transition).map(c=>({...c,approved:true}));
 const sceneCards=parts.map((c,i)=>
  '<article class="review-scene" data-review-chapter="'+i+'"><div class="row between"><strong>'+esc(c.label)+'</strong>'+
  (c.approved?'<span class="review-ok">✓</span>':'<small>Pendiente</small>')+'</div>'+
  '<small>'+(c.duration?fmt(c.duration)+' · Inicio '+fmt(c.start):'Sin narración completa')+'</small>'+
  '<div class="row wrap">'+(c.duration?btn('review-seek','▶ Ver','secondary','data-start="'+c.start+'"'):'')+
  btn('review-edit','✎ Corregir','secondary','data-id="'+esc(c.projectId)+'" data-scene="'+esc(c.scene)+'"')+'</div></article>').join('');
 const buttons=btn('review-build',m?.ready?'↻ Regenerar vista previa':'▶ Generar vista previa','secondary',
  (busy||m?.missing?.length?'disabled':''))+btn('review-export','Exportar MP4','',
   (busy||!m?.canExport?'disabled title="Aprueba las escenas y genera la vista previa"':''));
 const exported=state.reviewOutput?'<div class="review-exported"><strong>MP4 exportado</strong><small>'+esc(state.reviewOutput.file)+'</small>'+
  btn('review-open-output','Abrir MP4','secondary')+'</div>':'';
 return titlebar('Revisión y exportación',title,back)+
 '<div class="review-layout"><section class="panel"><div class="row between"><h2>Video completo · '+(short?'9:16':'16:9')+'</h2>'+
 '<span class="pill">'+(m?.ready?'Vista previa actual':'Pendiente')+'</span></div>'+
 '<div class="review-video '+(short?'portrait':'wide')+'">'+preview+'</div>'+
 (m?.ready?'<div class="row between review-controls"><span id="review-clock">0:00 / '+fmt(duration)+'</span>'+
 '<div class="row wrap">'+btn('review-back-five','−5 s','secondary')+btn('review-forward-five','+5 s','secondary')+
 btn('review-fullscreen','Pantalla completa','secondary')+'</div></div>':'')+
 timeline+progress+warning+'<div class="row wrap review-actions">'+buttons+'</div>'+exported+
 '<p class="muted mini">Es el montaje real de FFmpeg. Exportar reutiliza exactamente el archivo revisado.</p></section>'+
 '<section class="panel"><h2>Revisar por escenas</h2>'+
 '<p class="muted mini">Vuelve a corregir cualquier parte. Después actualiza la revisión antes de exportar.</p>'+
 '<div class="review-chapters">'+sceneCards+'</div>'+
 (!short&&duration<480?'<div class="warning">Para exportar videos largos se necesitan al menos 8 minutos.</div>':'')+
 (short&&!m?.approved?'<div class="warning">Aprueba Gancho, Desarrollo y Cierre antes de exportar. La revisión puede generarse previamente.</div>':'')+
 '</section></div>';
}
async function openReview(kind){
 if(kind==='short'){if(!state.project)throw Error('Abre un proyecto');await saveNow()}
 else if(!state.week)throw Error('Abre un video largo');
 const id=kind==='short'?state.project.id:state.week.id;
 state.reviewKind=kind;state.reviewInfo=null;state.reviewOutput=null;state.reviewError='';state.reviewBusy=false;state.page='review';render();
 try{
  state.reviewInfo=await api('review:status',{kind,id});
  if(state.page!=='review'||state.reviewKind!==kind)return;
  render();
  if(state.reviewInfo.complete&&!state.reviewInfo.ready)await buildReview();
 }catch(e){state.reviewError=e.message;if(state.page==='review')render()}
}
async function buildReview(){
 if(state.reviewBusy)return;
 const kind=state.reviewKind,id=kind==='short'?state.project?.id:state.week?.id;
 if(!id)throw Error('No hay video seleccionado');
 state.reviewBusy=true;state.reviewError='';state.reviewOutput=null;render();
 try{state.reviewInfo=await api('review:build',{kind,id})}
 catch(e){state.reviewError=e.message;try{state.reviewInfo=await api('review:status',{kind,id})}catch(_){}}
 finally{state.reviewBusy=false;if(state.page==='review')render()}
}
async function exportReview(){
 if(state.reviewBusy||!state.reviewInfo?.canExport)throw Error('Revisa y aprueba el video primero');
 const {kind,id,hash}=state.reviewInfo;
 state.reviewBusy=true;state.reviewError='';render();
 try{
  state.reviewOutput=await api('review:export',{kind,id,hash});
  state.reviewInfo=await api('review:status',{kind,id});
  await loadLibrary();
  if(kind==='short')state.project=await api('projects:get',{id});
  else state.week=await api('weekly:get',{id});
 }catch(e){state.reviewError=e.message;try{state.reviewInfo=await api('review:status',{kind,id})}catch(_){}}
 finally{state.reviewBusy=false;if(state.page==='review')render()}
}
function settingsPage(){
 const s=state.settings;
 return titlebar('Configuración','Fondos y preferencias locales')+
 '<div class="panel"><h2>Bibliotecas</h2><p>Los fondos compartidos y archivos del proyecto se gestionan por separado. Las imágenes originales no se borran al retirarlas de una escena.</p>'+btn('global-library','Abrir Biblioteca general','secondary')+'</div>'+
 '<div class="panel"><h2>Biblioteca y dispositivos</h2><p>Los originales y exportaciones se guardan en <code>D:\\11-Records-Studio</code>.</p>'+
 '<div class="field"><label>Umbral de detección de silencios (segundos)</label><input type="number" id="silenceThreshold" min=".5" max="5" step=".1" value="'+(s.silenceThreshold||.5)+'"></div>'+
 '<label class="row"><input type="checkbox" id="autoMicrocuts" '+(s.autoMicrocuts?'checked':'')+'> Montaje de apoyo con microcortes opcionales</label>'+
 '<div class="divider"></div><h3>Logo del canal</h3>'+
 '<div class="row wrap"><span class="muted">'+(s.logo?esc(s.logo):'Todavía no se ha importado el logo')+'</span>'+btn('import-logo','Seleccionar logo','secondary')+'</div>'+
 '<div class="row" style="margin-top:15px">'+btn('save-settings','Guardar preferencias')+'</div></div>';
}
async function weeklyDuration(){
 const w=state.week;if(!w)return 0;
 let secs=Math.max(0,w.projectIds.length-1);const entries=[w.intro,w.closing,...w.projectIds.map(id=>({projectId:id,scene:'body'}))];
 for(const entry of entries){if(!entry)continue;try{const p=await api('projects:get',{id:entry.projectId}),s=p.scenes[entry.scene];if(s?.video){const info=await api('media:metadata',{projectId:p.id,assetId:s.video});const raw=info.duration;secs+=Math.max(0,(s.end>s.start?s.end:raw)-(s.start||0))-(s.silences||[]).filter(g=>g.remove).reduce((sum,g)=>sum+Math.max(0,Math.min(s.end||raw,g.end)-Math.max(s.start||0,g.start)),0)}}catch(e){}}
 return Math.max(0,secs);
}
function weeklyPage(){
 const w=state.week,ids=w.projectIds,all=state.projects.filter(p=>p.status==='exported');
 const mins=state.weekLength||0;
 return titlebar(w.title,'Compilación 16:9 · los desarrollos se obtienen de los originales',btn('weeks','← Compilaciones','secondary')+btn('open-week-review','▶ Revisar y exportar MP4'))+
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
 const waveLeft=$('#edit-wave-scroll')?.scrollLeft||0;
 const oldVideo=$('#speaker-preview'),oldAsset=oldVideo?.dataset.asset;
 const wasPlaying=Boolean(oldVideo&&!oldVideo.paused&&!oldVideo.ended),oldTime=Number(oldVideo?.currentTime)||0;
 el.innerHTML=page==='home'?home():page==='weeks'?weeksPage():page==='global-library'?globalLibraryPage():page==='project-library'?projectLibraryPage():page==='project'?sceneView():page==='review'?reviewPage():page==='week'?weeklyPage():page==='settings'?settingsPage():page==='legacy'?titlebar('Editor web original','Copia exacta de Videoshort v20; disponible para referencia sin persistencia de proyectos.')+'<iframe title="Editor original" src="../legacy/index.html" style="width:100%;height:75vh;border:1px solid #31543b;background:white;border-radius:13px"></iframe>':home();
 document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.action===(page==='project'?'home':page==='week'?'weeks':page)));
 const sidebar=$('#sidebar-project'),title=$('#sidebar-project-title');
 if(sidebar)sidebar.hidden=!state.project;
 if(title&&state.project)title.textContent=state.project.title;
 const wave=$('#edit-wave-scroll');if(wave)wave.scrollLeft=waveLeft;
 const current=$('#speaker-preview');
 if(current&&oldAsset===current.dataset.asset&&current.getAttribute('src')){
  current.addEventListener('loadedmetadata',()=>{
   try{current.currentTime=Math.min(oldTime,Math.max(0,(Number(current.duration)||oldTime)-.03))}catch(_){}
   if(wasPlaying)current.play().catch(e=>previewMessage('No se pudo reanudar: '+e.message,true));
  },{once:true});
 }
 if(current)updateMediaPreview(oldTime);
}
async function navigate(page){state.page=page;state.status='';await loadLibrary();render()}

function mediaKey(project=state.project,scene=state.scene){return project?.id+':'+scene}
function previewAssetKey(id,asset){return id+':'+asset}
async function ensurePreview(projectId,assetId,force=false){
 const key=previewAssetKey(projectId,assetId);
 if(!force&&state.previewUrls[key])return state.previewUrls[key];
 if(state.previewPending[key])return state.previewPending[key];
 const task=(async()=>{
  const result=await api('media:preview',{projectId,assetId,force});
  state.previewUrls[key]=result.url;delete state.previewErrors[key];
  return result.url;
 })().finally(()=>{delete state.previewPending[key]});
 state.previewPending[key]=task;
 return task;
}
function previewMessage(message,error=false){
 const el=$('#preview-status');if(el){el.textContent=message;el.classList.toggle('preview-error',error)}
}
async function prepareScenePreview(force=false){
 if(state.page!=='project'||!state.project)return;
 const projectId=state.project.id,sceneKey=state.scene,assetId=state.project.scenes[sceneKey]?.video;
 if(!assetId)return;
 const cacheKey=previewAssetKey(projectId,assetId);
 if(force){delete state.previewUrls[cacheKey];delete state.previewErrors[cacheKey]}
 previewMessage('Preparando versión MP4 para reproducción…');
 const tasks=await Promise.allSettled([
  ensurePreview(projectId,assetId,force),
  api('media:timeline',{projectId,scene:sceneKey})
 ]);
 if(tasks[1].status==='fulfilled')state.previewTimelines[projectId+':'+sceneKey]=tasks[1].value;
 if(state.page!=='project'||state.project?.id!==projectId||state.scene!==sceneKey||state.project.scenes[sceneKey]?.video!==assetId)return;
 if(tasks[0].status!=='fulfilled'){
  const message=tasks[0].reason?.message||'No se pudo convertir la grabación';
  state.previewErrors[cacheKey]=message;
  previewMessage(message,true);return;
 }
 const src=tasks[0].value,video=$('#speaker-preview'),frozen=$('#speaker-frozen');
 if(video&&video.dataset.asset===assetId&&(force||video.getAttribute('src')!==src)){video.src=src;video.load()}
 if(frozen&&(force||frozen.getAttribute('src')!==src)){frozen.src=src;frozen.load()}
 previewMessage(tasks[1].status==='fulfilled'?'Video y secuencia listos':'Video listo. No se pudo calcular la secuencia.',tasks[1].status!=='fulfilled');
 updateMediaPreview(Number(video?.currentTime)||0);
}
function updateMediaPreview(t){
 if(state.page!=='project'||!state.project)return;
 const segments=state.previewTimelines[mediaKey()]||[];
 if(!segments.length)return;
 const part=segments.find(x=>t>=x.start-.002&&t<x.end-.002);
 const assetId=part?.assetId,kind=part?.type;
 const photo=$('#support-image'),clip=$('#support-video');
 if(!photo&&!clip)return;
 if(state.scene==='closing'||!assetId){
  if(photo)photo.hidden=true;if(clip){clip.pause();clip.hidden=true}return;
 }
 if(kind==='image'){
  if(clip){clip.pause();clip.hidden=true}
  if(photo){
   if(photo.dataset.asset!==assetId){photo.dataset.asset=assetId;photo.src=url(state.project,assetId)}
   photo.hidden=false;
  }
 }else if(kind==='video'&&clip){
  if(photo)photo.hidden=true;
  const key=previewAssetKey(state.project.id,assetId),src=state.previewUrls[key];
  if(!src){
   clip.hidden=true;
   if(!state.previewPending[key])ensurePreview(state.project.id,assetId).then(()=>updateMediaPreview(Number($('#speaker-preview')?.currentTime)||t)).catch(e=>previewMessage('Clip de apoyo: '+e.message,true));
   return;
  }
  clip.hidden=false;
  if(clip.dataset.asset!==assetId){clip.dataset.asset=assetId;clip.src=src;clip.load()}
  const wanted=(Number(part.mediaStart)||0)+(t-part.start)*(Number(part.speed)||1);
  if(Math.abs((clip.currentTime||0)-wanted)>.4)try{clip.currentTime=wanted}catch(_){}
  const presenter=$('#speaker-preview');
  if(presenter&&!presenter.paused)clip.play().catch(()=>{});
  else clip.pause();
 }
}
async function refreshWaveform(){
 const p=state.project,sceneKey=state.scene,s=p?.scenes[sceneKey];if(!p||!s?.video)return;
 const asset=s.video,id=p.id+':'+asset,payload={projectId:p.id,assetId:asset};
 const active=()=>state.page==='project'&&state.project?.id===p.id&&state.scene===sceneKey&&state.project.scenes[sceneKey].video===asset;
 const draw=()=>{if(active())render()};
 // Leer duración y onda por separado: un error de audio no debe bloquear los marcadores.
 const durationTask=(async()=>{
  try{
   const info=state.videoDurations[id]?{duration:state.videoDurations[id]}:await api('media:metadata',payload);
   if(!active())return;
   const seconds=Number(info.duration);
   if(!Number.isFinite(seconds)||seconds<=0)throw Error('No se pudo medir la duración de la grabación');
   state.videoDurations[id]=seconds;
   delete state.waveErrors[id];
   if(!(Number(s.end)>Number(s.start))){s.start=0;s.end=Math.min(180,seconds);queueSave()}
   state.cutSelection.end=Math.min(editorDuration(),Math.max(.08,Number(state.cutSelection.end)||1));
   draw();
  }catch(e){
   if(!active())return;
   const v=$('#speaker-preview'),fromVideo=Number(v?.duration);
   if(Number.isFinite(fromVideo)&&fromVideo>0){
    state.videoDurations[id]=fromVideo;
    if(!(Number(s.end)>Number(s.start))){s.end=Math.min(180,fromVideo);queueSave()}
   }else state.waveErrors[id]='No se pudo leer la duración: '+e.message;
   draw();console.warn('Duración de video:',e);
  }
 })();
 const audioTask=(async()=>{
  try{
   const peaks=Array.isArray(state.waveforms[id])?state.waveforms[id]:await api('media:waveform',payload);
   if(!active())return;
   state.waveforms[id]=Array.isArray(peaks)?peaks:[];
   if(!state.waveforms[id].length)state.waveErrors[id]='La pista de audio no contiene ondas; todavía puedes marcar recortes.';
   else delete state.waveErrors[id];
   draw();
  }catch(e){
   if(!active())return;
   state.waveforms[id]=[];
   state.waveErrors[id]='No se pudo dibujar la onda: '+e.message;
   draw();console.warn('Forma de onda:',e);
  }
 })();
 await Promise.allSettled([durationTask,audioTask]);
}
async function openProject(id,scene='hook'){state.project=await api('projects:get',{id});state.scene=scene;state.orientation='short';state.page='project';state.status='';resetCutEditor();render();refreshWaveform();prepareScenePreview()}
function resetCutEditor(){state.cutSelection={start:0,end:1};state.cutZoom=1;state.cutUndo=[];state.cutRedo=[];state.playSelectionOnly=false;state.editorPanel='audio'}
async function openWeek(id){state.week=await api('weekly:get',{id});state.page='week';state.status='';state.weekLength=0;render();state.weekLength=await weeklyDuration();if(state.page==='week')render()}
let saving=null;
function queueSave(){clearTimeout(saving);saving=setTimeout(async()=>{try{if(state.project)await api('projects:save',state.project)}catch(e){notice(e.message,true)}},250)}
async function saveNow(){clearTimeout(saving);if(state.project)await api('projects:save',state.project)}
async function appendSceneMedia(files){
 if(!files.length)return;
 state.project=await api('projects:get',{id:state.project.id});
 const scene=state.project.scenes[state.scene];
 if(!scene.media)scene.media=[];
 for(const item of files.filter(f=>f.type==='image'||f.type==='video')){
  scene.media.push({assetId:item.id,start:0,end:0,speed:1,microcuts:true});
 }
 scene.approved=false;await saveNow();render();prepareScenePreview();
}
async function importFor(target){
 await saveNow();
 const response=await api('assets:import',{projectId:state.project.id,kind:target});
 const files=Array.isArray(response)?response:response.files||[],errors=response.errors||[];
 if(!files.length){
  if(errors.length)notice(errors[0].name+': '+errors[0].message,true);
  return;
 }
 if(target==='voice'){
  state.project=await api('projects:get',{id:state.project.id});
  const item=files.find(f=>f.type==='video');
  if(!item)throw Error('Selecciona un video con tu narración');
  const info=await api('media:metadata',{projectId:state.project.id,assetId:item.id});
  const s=state.project.scenes[state.scene];
  s.video=item.id;s.start=0;s.end=Math.min(180,info.duration);s.silences=[];s.cuts=[];s.approved=false;resetCutEditor();
  await saveNow();render();refreshWaveform();prepareScenePreview();
 }else await appendSceneMedia(files);
 notice(files.length+' archivo(s) agregado(s) al proyecto'+(errors.length?' · '+errors.length+' no se pudieron importar: '+errors[0].name+': '+errors[0].message:''),errors.length>0);
}
async function pasteImage(silent=false){
 if(state.page!=='project'||state.scene==='closing'||!state.project)return;
 await saveNow();
 const image=await api('assets:paste-image',{projectId:state.project.id});
 if(!image){
  if(!silent)notice('No hay una imagen en el portapapeles. Copia una captura primero.',true);
  return;
 }
 await appendSceneMedia([image]);
 notice('Imagen pegada en los recursos visuales y guardada en D:');
}
async function detect(){const p=state.project,s=p.scenes[state.scene];if(!s.video)throw Error('Importa primero un video');
 notice('Analizando pausas del audio…');
 const data=await api('media:analyze',{projectId:p.id,assetId:s.video,threshold:state.settings.silenceThreshold||.5});
 s.silences=data.map(d=>({...d,remove:true}));s.approved=false;queueSave();render();notice(data.length+' silencios detectados (rojo = borrar; gris = conservar)')}
function releaseCamera(){
 if(state.recordTimer){clearInterval(state.recordTimer);state.recordTimer=null}
 if(state.recordCapture){state.recordCapture.getTracks().forEach(t=>t.stop());state.recordCapture=null}
 if(state.recordStream){state.recordStream.getTracks().forEach(t=>t.stop());state.recordStream=null}
 const v=$('#camera-preview');if(v){v.pause();v.srcObject=null}
}
function discardRecording(){
 state.recordDraft=null;state.recordParts=[];
 if(state.recordDraftUrl){URL.revokeObjectURL(state.recordDraftUrl);state.recordDraftUrl=null}
 const v=$('#record-review');if(v){v.pause();v.removeAttribute('src');v.load()}
}
function closeRecorder(){
 if(state.recorder&&state.recorder.state!=='inactive')state.recorder.stop();
 state.recorder=null;releaseCamera();discardRecording();
 const root=$('#modal-root');root.hidden=true;root.innerHTML='';
}
function captureDimensions(){
 return state.recordFormat==='portrait'?[720,1280]:state.recordFormat==='wide'?[1280,720]:[720,720];
}
function selectRecordFormat(format){
 if(!['square','portrait','wide'].includes(format)||state.recorder?.state==='recording')return;
 state.recordFormat=format;
 const el=$('#record-stage');if(el)el.className='record-stage format-'+format;
 document.querySelectorAll('[data-action="record-format"]').forEach(b=>b.classList.toggle('active',b.dataset.format===format));
 const [w,h]=captureDimensions(),hint=$('#record-resolution');
 if(hint)hint.textContent=w+' × '+h+' px · 30 FPS';
}
async function openCamera(){
 const video=$('#camera-preview');if(!video)return;
 const camera=$('#camera-choice')?.value||state.settings.defaultCamera||undefined;
 const mic=$('#mic-choice')?.value||state.settings.defaultMic||undefined;
 releaseCamera();
 const stream=await navigator.mediaDevices.getUserMedia({
  video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30},...(camera?{deviceId:{ideal:camera}}:{})},
  audio:mic?{deviceId:{ideal:mic}}:true
 });
 if(!$('#camera-preview')){stream.getTracks().forEach(t=>t.stop());return}
 state.recordStream=stream;video.srcObject=stream;await video.play();
 const devices=await navigator.mediaDevices.enumerateDevices().catch(()=>[]);
 for(const [id,kind,track] of [['camera-choice','videoinput',stream.getVideoTracks()[0]],['mic-choice','audioinput',stream.getAudioTracks()[0]]]){
  const select=$('#'+id);if(!select)continue;
  const list=devices.filter(d=>d.kind===kind),selected=track?.getSettings().deviceId||'';
  select.innerHTML=list.map((d,k)=>'<option value="'+esc(d.deviceId)+'" '+(selected===d.deviceId?'selected':'')+'>'+esc(d.label||((kind==='videoinput'?'Cámara ':'Micrófono ')+(k+1)))+'</option>').join('');
 }
}
async function manageRecording(){
 if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('La cámara o el grabador no están disponibles en este equipo');
 closeRecorder();state.recordFormat='square';
 const modal=$('#modal-root');modal.hidden=false;
 modal.innerHTML='<div class="modalback"><div class="modal recorder-modal">'+
 '<div class="row between"><div><h2>Grabar presentador</h2><p class="muted mini">La proporción elegida se guarda en el video real.</p></div>'+btn('modal-close','× Cerrar','secondary')+'</div>'+
 '<div class="two"><div class="field"><label>Cámara</label><select id="camera-choice"></select></div><div class="field"><label>Micrófono</label><select id="mic-choice"></select></div></div>'+
 '<div class="record-format-options">'+
 '<button class="record-format active" data-action="record-format" data-format="square">□ 1:1 Cuadrado</button>'+
 '<button class="record-format" data-action="record-format" data-format="portrait">▯ 9:16 Vertical</button>'+
 '<button class="record-format" data-action="record-format" data-format="wide">▭ 16:9 Horizontal</button></div>'+
 '<div class="record-stage format-square" id="record-stage"><video id="camera-preview" autoplay muted playsinline></video><video id="record-review" controls playsinline hidden></video><span id="record-guide">Encuadre de cámara</span></div>'+
 '<div class="row between recorder-meta"><span id="record-resolution">720 × 720 px · 30 FPS</span><strong id="record-clock">0:00</strong></div>'+
 '<div class="row wrap recorder-actions" id="record-live-actions">'+btn('record-start','● Iniciar grabación')+btn('record-stop','■ Detener','danger','disabled')+'</div>'+
 '<div class="row wrap recorder-actions" id="record-review-actions" hidden>'+btn('record-retry','↻ Repetir','secondary')+btn('record-save','✓ Guardar grabación')+'</div>'+
 '</div></div>';
 try{await openCamera()}catch(e){closeRecorder();throw Error('No se pudo activar cámara y micrófono: '+e.message)}
}
async function startRecording(){
 if(state.recorder?.state==='recording')return;
 if(!state.recordStream)await openCamera();
 const camera=$('#camera-preview');
 if(!camera?.videoWidth||!camera.videoHeight)throw Error('La cámara todavía no está lista');
 const [width,height]=captureDimensions(),canvas=document.createElement('canvas');
 canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d',{alpha:false});
 if(!ctx)throw Error('No se pudo preparar la captura');
 state.recordStartAt=Date.now();
 const draw=()=>{
  if(camera.readyState<2)return;
  const sw=camera.videoWidth,sh=camera.videoHeight,target=width/height,actual=sw/sh;
  const cw=actual>target?sh*target:sw,ch=actual>target?sh:sw/target;
  ctx.drawImage(camera,(sw-cw)/2,(sh-ch)/2,cw,ch,0,0,width,height);
  const clock=$('#record-clock');if(clock)clock.textContent=fmt((Date.now()-state.recordStartAt)/1000);
 };
 draw();
 const videoStream=canvas.captureStream(30);
 state.recordCapture=new MediaStream([...videoStream.getVideoTracks(),...state.recordStream.getAudioTracks()]);
 const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
 if(!mime){releaseCamera();throw Error('No se encontró un codificador de video compatible')}
 try{
  state.recordParts=[];
  state.recorder=new MediaRecorder(state.recordCapture,{mimeType:mime,videoBitsPerSecond:4000000,audioBitsPerSecond:128000});
  state.recorder.ondataavailable=e=>{if(e.data.size)state.recordParts.push(e.data)};
  state.recorder.start(1000);
  state.recordTimer=setInterval(draw,1000/30);
 }catch(e){state.recorder=null;releaseCamera();throw e}
 const start=$('[data-action="record-start"]'),stop=$('[data-action="record-stop"]');
 if(start)start.disabled=true;if(stop)stop.disabled=false;
 document.querySelectorAll('[data-action="record-format"],#camera-choice,#mic-choice').forEach(el=>el.disabled=true);
 state.settings.defaultCamera=$('#camera-choice')?.value||'';
 state.settings.defaultMic=$('#mic-choice')?.value||'';
 try{await api('settings:set',state.settings)}catch(e){console.warn('No se guardó el dispositivo predeterminado',e)}
}
async function stopRecording(){
 const rec=state.recorder;if(!rec||rec.state==='inactive')return;
 await new Promise((resolve,reject)=>{
  rec.addEventListener('stop',resolve,{once:true});
  rec.addEventListener('error',e=>reject(e.error||Error('Falló la grabación')),{once:true});
  rec.stop();
 });
 state.recorder=null;releaseCamera();
 const blob=new Blob(state.recordParts,{type:'video/webm'});
 if(blob.size<100)throw Error('La grabación quedó vacía');
 state.recordDraft=blob;
 state.recordDraftUrl=URL.createObjectURL(blob);
 const live=$('#record-live-actions'),actions=$('#record-review-actions'),camera=$('#camera-preview'),review=$('#record-review');
 if(live)live.hidden=true;if(actions)actions.hidden=false;if(camera)camera.hidden=true;
 if(review){review.hidden=false;review.src=state.recordDraftUrl;review.load()}
 const guide=$('#record-guide');if(guide)guide.textContent='Revisa antes de guardar';
 notice('Grabación lista para revisar');
}
async function retryRecording(){
 discardRecording();
 const live=$('#record-live-actions'),actions=$('#record-review-actions'),camera=$('#camera-preview'),review=$('#record-review');
 if(live)live.hidden=false;if(actions)actions.hidden=true;if(camera)camera.hidden=false;if(review)review.hidden=true;
 const clock=$('#record-clock');if(clock)clock.textContent='0:00';
 const guide=$('#record-guide');if(guide)guide.textContent='Encuadre de cámara';
 const start=$('[data-action="record-start"]'),stop=$('[data-action="record-stop"]');
 if(start)start.disabled=false;if(stop)stop.disabled=true;
 document.querySelectorAll('[data-action="record-format"],#camera-choice,#mic-choice').forEach(el=>el.disabled=false);
 await openCamera();
}
async function saveRecordedVideo(){
 if(!state.recordDraft)throw Error('No hay grabación pendiente');
 const data=await new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result).split(',')[1]);
  reader.onerror=reject;reader.readAsDataURL(state.recordDraft);
 });
 const type={square:'cuadrada 1-1',portrait:'vertical 9-16',wide:'horizontal 16-9'}[state.recordFormat];
 const item=await api('assets:record',{projectId:state.project.id,name:'Grabación '+type+' '+new Date().toLocaleString('es-EC'),data});
 state.project=await api('projects:get',{id:state.project.id});
 const s=state.project.scenes[state.scene],info=await api('media:metadata',{projectId:state.project.id,assetId:item.id});
 s.video=item.id;s.start=0;s.end=Math.min(info.duration,180);s.silences=[];s.cuts=[];s.approved=false;resetCutEditor();
 await saveNow();
 closeRecorder();render();refreshWaveform();prepareScenePreview();notice('Grabación guardada en disco D · '+type);
}
async function exportNow(kind){const key=kind==='short'?'render:short':'render:weekly';state.status='Preparando exportación local con FFmpeg…';state.progress=3;render();try{
 const result=await api(key,kind==='short'?{projectId:state.project.id}:{id:state.week.id});
 state.status='';notice('Video exportado: '+result.file);await loadLibrary();if(kind==='short')await openProject(state.project.id,state.scene);else await openWeek(state.week.id);
 }catch(e){state.status='';render();notice(e.message,true)}}
function saveCutUndo(){
 const scene=state.project.scenes[state.scene];
 state.cutUndo.push(JSON.stringify(scene.cuts||[]));
 if(state.cutUndo.length>30)state.cutUndo.shift();
 state.cutRedo=[];
}
function selectedCutRange(){
 const scene=state.project.scenes[state.scene],dur=editorDuration(),r=rangeSelection();
 const start=Math.max(Number(scene.start)||0,r.start),end=Math.min(Number(scene.end)||dur,r.end);
 if(!dur||end-start<.08)throw Error('Selecciona al menos 0,08 segundos con los marcadores A y B.');
 return {start:Number(start.toFixed(3)),end:Number(end.toFixed(3))};
}
function applyCut(){
 const scene=state.project.scenes[state.scene],{start,end}=selectedCutRange();
 if(!['both','audio','video'].includes(state.cutMode))throw Error('Tipo de recorte inválido');
 if((scene.cuts||[]).some(c=>Number(c.start)<end&&Number(c.end)>start))
  throw Error('La selección se superpone a un recorte anterior; ajusta los marcadores o elimina el recorte.');
 saveCutUndo();
 scene.cuts=[...(scene.cuts||[]),{start,end,mode:state.cutMode}].sort((a,b)=>a.start-b.start);
 scene.approved=false;queueSave();render();
 notice(editTypeName(state.cutMode)+' ('+(end-start).toFixed(2)+' s)');
}
function undoRedoCut(reverse=false){
 const from=reverse?state.cutRedo:state.cutUndo,to=reverse?state.cutUndo:state.cutRedo;
 if(!from.length)return;
 const scene=state.project.scenes[state.scene];
 to.push(JSON.stringify(scene.cuts||[]));
 scene.cuts=JSON.parse(from.pop());scene.approved=false;queueSave();render();
}
function updatePreviewEdits(){
 const video=$('#speaker-preview');
 if(!video||!state.project)return;
 const scene=state.project.scenes[state.scene],t=video.currentTime,dur=editorDuration();
 const playhead=$('#edit-wave-playhead');
 if(playhead&&dur)playhead.style.left=Math.min(100,100*t/dur)+'%';
 updateMediaPreview(t);
 const removed=[...(scene.silences||[]).filter(c=>c.remove),...(scene.cuts||[]).filter(c=>c.mode==='both')].sort((a,b)=>a.start-b.start);
 if(!video.paused){
  const cut=removed.find(c=>t>=c.start&&t<c.end-.025);
  if(cut){video.currentTime=Math.min(scene.end||dur,cut.end);return}
 }
 if(state.playSelectionOnly&&t>=rangeSelection().end-.025){video.pause();state.playSelectionOnly=false;return}
 if((Number(scene.end)>0&&t>=Number(scene.end)-.025)||(dur>0&&t>=dur-.025)){video.pause();const clip=$('#support-video');if(clip)clip.pause();return}
 video.muted=(scene.cuts||[]).some(c=>c.mode==='audio'&&t>=c.start&&t<c.end);
 const frozen=$('#speaker-frozen'),freeze=(scene.cuts||[]).find(c=>c.mode==='video'&&t>=c.start&&t<c.end);
 if(frozen&&freeze){
  frozen.hidden=false;
  if(frozen.dataset.at!==String(freeze.start)){
   frozen.dataset.at=String(freeze.start);frozen.currentTime=freeze.start;frozen.pause();
  }
  video.style.opacity='0';
 }else{
  if(frozen){frozen.hidden=true;delete frozen.dataset.at}
  video.style.opacity='';
 }
}
async function playback(selection=false){
 let video=$('#speaker-preview');if(!video||!state.project)return;
 const projectId=state.project.id,sceneKey=state.scene,scene=state.project.scenes[sceneKey];
 if(!scene.video){previewMessage('Primero importa o graba una narración',true);return}
 const assetId=scene.video,key=previewAssetKey(projectId,assetId);
 if(!state.previewUrls[key]){
  previewMessage('Convirtiendo video para reproducción…');
  try{await ensurePreview(projectId,assetId)}catch(e){previewMessage('No se pudo convertir: '+e.message,true);return}
 }
 if(!state.previewTimelines[mediaKey()])await prepareScenePreview();
 if(state.page!=='project'||state.project.id!==projectId||state.scene!==sceneKey)return;
 video=$('#speaker-preview');if(!video)return;
 const src=state.previewUrls[key];
 if(video.getAttribute('src')!==src){video.src=src;video.load()}
 state.playSelectionOnly=selection;
 const target=selection?selectedCutRange().start:Number(scene.start)||0;
 const launch=()=>{
  if(selection||video.currentTime<Number(scene.start)||(Number(scene.end)>0&&video.currentTime>=Number(scene.end)))
   try{video.currentTime=target}catch(_){}
  video.play().then(()=>{previewMessage('Reproduciendo');updatePreviewEdits()})
   .catch(e=>previewMessage('No se pudo reproducir: '+e.message,true));
 };
 if(video.readyState<1)video.addEventListener('loadedmetadata',launch,{once:true});
 else launch();
}
document.addEventListener('timeupdate',e=>{if(e.target?.id==='speaker-preview')updatePreviewEdits()},true);
document.addEventListener('loadedmetadata',e=>{
 if(e.target?.id!=='speaker-preview'||!state.project)return;
 const video=e.target,scene=state.project.scenes[state.scene];
 const seconds=Number(video.duration),id=state.project.id+':'+scene.video;
 if(Number.isFinite(seconds)&&seconds>0){
  const previous=Number(state.videoDurations[id]);
  const changed=!Number.isFinite(previous)||previous<=0;
  state.videoDurations[id]=seconds;
  if(!(Number(scene.end)>Number(scene.start))){scene.start=0;scene.end=Math.min(180,seconds);queueSave()}
  // No reconstruir el reproductor en cada evento metadata; causa un bucle de recargas.
  if(changed&&$('.wave-loading'))render();
 }
},true);
document.addEventListener('error',e=>{
 if(e.target?.id!=='speaker-preview')return;
 const error=e.target.error;
 previewMessage('Error de decodificación'+(error?' (código '+error.code+')':'')+': '+(error?.message||'revisa la grabación'),true);
},true);
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b)return;
 const action=b.dataset.action;try{
  if(['home','weeks','settings','legacy','global-library','project-library'].includes(action))return await navigate(action);
  if(action==='open-current-project'){if(!state.project)throw Error('Abre un proyecto');return openProject(state.project.id,state.scene)}
  if(action==='global-tab'){state.globalTab=b.dataset.tab;return render()}
  if(action==='project-filter'){state.projectFilter=b.dataset.type;return render()}
  if(action==='global-import'){const result=await api('global:import');state.globalAssets=await api('global:list');render();if(result.errors?.length)notice(result.errors[0].message,true);else if(result.files?.length)notice(result.files.length+' recurso(s) añadidos');return}
  if(action==='global-paste'){await api('global:paste');state.globalAssets=await api('global:list');render();return}
  if(action==='global-copy-project'){if(!state.project)throw Error('Abre un proyecto primero');const result=await api('global:to-project',{projectId:state.project.id,id:b.dataset.id});await refreshProjectAssets();notice(result.reused?'El recurso ya estaba en la biblioteca del proyecto':'Recurso copiado a la biblioteca del proyecto');return}
  if(action==='global-rename'||action==='global-delete'){const item=state.globalAssets.find(x=>x.id===b.dataset.id);if(!item)return;return action==='global-rename'?renameResourceModal('global',item.id,item.name):deleteResourceModal('global',item.id,item.name)}
  if(action==='project-assets-upload')return await uploadProjectOnly('media');
  if(action==='project-assets-paste')return await uploadProjectOnly('media',true);
  if(action==='project-asset-attach')return attachExisting(b.dataset.id);
  if(action==='project-asset-background')return setSceneBackground(b.dataset.id);
  if(action==='project-asset-voice')return assignNarration(b.dataset.id);
  if(action==='project-asset-publish'){await api('global:from-project',{projectId:state.project.id,assetId:b.dataset.id});state.globalAssets=await api('global:list');notice('Copia compartida en Biblioteca general');return}
  if(action==='project-asset-rename'||action==='project-asset-delete'){
   const item=state.project?.assets.find(x=>x.id===b.dataset.id);if(!item)return;
   return action==='project-asset-rename'?renameResourceModal('project',item.id,item.name):deleteResourceModal('project',item.id,item.name);
  }
  if(action==='library-rename-confirm'||action==='library-delete-confirm'){
   const isGlobal=b.dataset.scope==='global',id=b.dataset.id;
   if(action==='library-rename-confirm'){
    const name=$('#library-rename-name')?.value;
    await api(isGlobal?'global:rename':'assets:rename',isGlobal?{id,name}:{projectId:state.project.id,assetId:id,name});
   }else await api(isGlobal?'global:delete':'assets:delete',isGlobal?{id}:{projectId:state.project.id,assetId:id});
   const modal=$('#modal-root');modal.hidden=true;modal.innerHTML='';
   if(isGlobal)state.globalAssets=await api('global:list');
   else state.project=await api('projects:get',{id:state.project.id});
   render();notice(action==='library-rename-confirm'?'Nombre actualizado':'Recurso eliminado');return;
  }
  if(action==='choose-project-media')return projectMediaPicker();
  if(action==='picker-attach'){await attachExisting(b.dataset.id);const modal=$('#modal-root');modal.hidden=true;modal.innerHTML='';return}

  if(action==='back')return await navigate('home');
  if(action==='new'){
   const modal=$('#modal-root');modal.hidden=false;
   modal.innerHTML='<div class="modalback"><div class="modal"><h2>Crear nuevo récord</h2><div class="field"><label>Título del récord</label><input id="new-project-title" maxlength="120" placeholder="Escribe el récord que vas a producir"></div><div class="row">'+btn('confirm-new','Crear proyecto')+btn('modal-close','Cancelar','secondary')+'</div></div></div>';
   $('#new-project-title').focus();return;
  }
  if(action==='confirm-new'){
   const title=$('#new-project-title')?.value.trim();
   if(!title)throw Error('Escribe un título antes de crear el proyecto');
   $('#modal-root').hidden=true;
   const p=await api('projects:create',{title});await loadLibrary();return await openProject(p.id);
  }
  if(action==='open-project'){state.editingWeekId=null;return await openProject(b.dataset.id)}
  if(action==='open-week')return await openWeek(b.dataset.id);
  if(action==='new-week'){
   const w=await api('weekly:create',{title:'Récords de la semana'});await loadLibrary();return await openWeek(w.id)
  }
  if(action==='scene'){await saveNow();state.scene=b.dataset.id;resetCutEditor();render();refreshWaveform();return prepareScenePreview()}
  if(action==='open-review')return await openReview('short');
  if(action==='open-week-review')return await openReview('week');
  if(action==='review-back')return state.reviewKind==='short'?openProject(state.project.id,state.scene):openWeek(state.week.id);
  if(action==='review-edit'){
   if(state.reviewKind==='week')state.editingWeekId=state.week.id;
   return openProject(b.dataset.id,b.dataset.scene);
  }
  if(action==='review-build')return await buildReview();
  if(action==='review-export')return await exportReview();
  if(action==='review-open-output'){
   if(!state.reviewOutput?.file)throw Error('No existe un MP4 exportado');
   return await api('system:open-path',{path:state.reviewOutput.file});
  }
  if(action==='review-seek'){
   const video=$('#final-review-video');if(video){video.currentTime=Number(b.dataset.start)||0;video.play().catch(e=>notice(e.message,true))}
   return;
  }
  if(action==='review-back-five'||action==='review-forward-five'){
   const video=$('#final-review-video');
   if(video)video.currentTime=Math.max(0,Math.min(video.duration||0,video.currentTime+(action==='review-back-five'?-5:5)));
   return;
  }
  if(action==='review-fullscreen')return $('#final-review-video')?.requestFullscreen?.();
  if(action==='choose-template')return backgroundChooser();
  if(action==='template-picker-close'){const modal=$('#modal-root');modal.hidden=true;modal.innerHTML='';return}
  if(action==='template-upload')return await importTemplate(b.dataset.format,false,false);
  if(action==='template-paste')return await importTemplate(b.dataset.format,true,false);
  if(action==='project-template-upload'){
   const files=await uploadProjectOnly('image');
   if(files.length)await setSceneBackground(files.find(a=>a.type==='image')?.id);
   const root=$('#modal-root');root.hidden=true;root.innerHTML='';return;
  }
  if(action==='project-template-paste'){
   const files=await uploadProjectOnly('image',true);
   if(files.length)await setSceneBackground(files[0].id);
   const root=$('#modal-root');root.hidden=true;root.innerHTML='';return;
  }
  if(action==='project-template-inherit'){
   const scene=state.project.scenes[state.scene];if(scene.backgrounds)delete scene.backgrounds[state.orientation];
   scene.approved=false;await saveNow();
   const root=$('#modal-root');root.hidden=true;root.innerHTML='';
   render();notice('La escena utiliza el fondo general');return;
  }
  if(action==='project-template-local'){
   await setSceneBackground(b.dataset.id);
   const root=$('#modal-root');root.hidden=true;root.innerHTML='';
   return;
  }
  if(action==='project-template-select'){
   const id=b.dataset.id||null;
   if(id&&!state.templates.some(t=>t.id===id&&t.format===state.orientation))throw Error('Selecciona un fondo compatible');
   const scene=state.project.scenes[state.scene];scene.backgrounds={...(scene.backgrounds||{}),[state.orientation]:id};
   scene.approved=false;
   await saveNow();
   const modal=$('#modal-root');modal.hidden=true;modal.innerHTML='';render();notice('Fondo actualizado solo en '+names[state.scene]);return;
  }
  if(action==='template-clear-default'){state.settings=await api('templates:set-default',{format:b.dataset.format,id:null});render();notice('Fondo predeterminado desactivado');return}
  if(action==='template-default'){
   state.settings=await api('templates:set-default',{format:b.dataset.format,id:b.dataset.id});
   render();notice('Fondo predeterminado actualizado para nuevos proyectos');return;
  }
  if(action==='template-rename'){
   const item=state.templates.find(t=>t.id===b.dataset.id);if(!item)return;
   const modal=$('#modal-root');modal.hidden=false;
   modal.innerHTML='<div class="modalback"><div class="modal"><h2>Renombrar fondo</h2>'+
    '<div class="field"><label>Nombre</label><input id="template-rename-input" maxlength="100" value="'+esc(item.name)+'"></div>'+
    '<div class="row wrap">'+btn('template-rename-confirm','Guardar nombre','','data-id="'+item.id+'"')+
    btn('template-picker-close','Cancelar','secondary')+'</div></div></div>';return;
  }
  if(action==='template-rename-confirm'){
   await api('templates:rename',{id:b.dataset.id,name:$('#template-rename-input')?.value});
   state.templates=await api('templates:list');
   const modal=$('#modal-root');modal.hidden=true;modal.innerHTML='';render();return;
  }
  if(action==='template-delete'){
   const item=state.templates.find(t=>t.id===b.dataset.id);if(!item)return;
   const modal=$('#modal-root');modal.hidden=false;
   modal.innerHTML='<div class="modalback"><div class="modal"><h2>Eliminar fondo</h2>'+
    '<p>¿Eliminar <strong>'+esc(item.name)+'</strong>? Los fondos que están en uso o son predeterminados están protegidos.</p>'+
    '<div class="row wrap">'+btn('template-delete-confirm','Eliminar','danger','data-id="'+item.id+'"')+
    btn('template-picker-close','Cancelar','secondary')+'</div></div></div>';return;
  }
  if(action==='template-delete-confirm'){
   await api('templates:delete',{id:b.dataset.id});
   state.templates=await api('templates:list');
   const modal=$('#modal-root');modal.hidden=true;modal.innerHTML='';render();notice('Fondo eliminado');return;
  }

  if(action==='import-voice')return await importFor('voice');
  if(action==='import-media')return await importFor('media');
  if(action==='paste-image')return await pasteImage();
  if(action==='detect-silences')return await detect();
  if(action==='retry-waveform'){const id=state.project.id+':'+state.project.scenes[state.scene].video;delete state.videoDurations[id];delete state.waveforms[id];delete state.waveErrors[id];return await refreshWaveform()}
  if(action==='cut-mode'){state.cutMode=b.dataset.mode;return render()}
  if(action==='cut-add')return applyCut();
  if(action==='cut-undo')return undoRedoCut();
  if(action==='cut-redo')return undoRedoCut(true);
  if(action==='cut-remove'){
   const scene=state.project.scenes[state.scene],idx=Number(b.dataset.index);
   if(!Number.isInteger(idx)||idx<0||idx>=(scene.cuts||[]).length)return;
   saveCutUndo();scene.cuts.splice(idx,1);scene.approved=false;queueSave();return render();
  }
  if(action==='play-cut')return await playback(true);
  if(action==='toggle-silence'){const s=state.project.scenes[state.scene];s.silences[Number(b.dataset.index)].remove=!s.silences[Number(b.dataset.index)].remove;s.approved=false;queueSave();return render()}
  if(action==='mark-all'||action==='unmark-all'){const s=state.project.scenes[state.scene];s.silences.forEach(q=>q.remove=action==='mark-all');s.approved=false;queueSave();return render()}
  if(action==='remove-media'||action==='move-media'){
   const s=state.project.scenes[state.scene],i=Number(b.dataset.index),j=i+Number(b.dataset.delta);
   if(action==='remove-media')s.media.splice(i,1);else if(j>=0&&j<s.media.length)[s.media[i],s.media[j]]=[s.media[j],s.media[i]];
   s.approved=false;await saveNow();render();return prepareScenePreview();
  }
  if(action==='approve-scene'){const s=state.project.scenes[state.scene];if(!s.video)throw Error('Primero sube o graba el video principal');if(state.scene!=='closing'&&!(s.media||[]).length)throw Error('Añade al menos una fotografía o video de apoyo');if(Number(s.end)<=Number(s.start))throw Error('El fragmento debe tener una duración positiva');
   s.approved=!s.approved;await saveNow();return render()}
  if(action==='orientation-short'||action==='orientation-wide'){state.orientation=action==='orientation-wide'?'wide':'short';return render()}
  if(action==='play-preview')return await playback(false);
  if(action==='retry-preview')return await prepareScenePreview(true);
  if(action==='pause-preview'){const v=$('#speaker-preview'),clip=$('#support-video');state.playSelectionOnly=false;if(v)v.pause();if(clip)clip.pause();return}
  if(action==='stop-preview'){const v=$('#speaker-preview'),clip=$('#support-video');state.playSelectionOnly=false;if(v){v.pause();v.currentTime=Number(state.project.scenes[state.scene].start)||0;updatePreviewEdits()}if(clip)clip.pause();return}
  if(action==='export-short')return await openReview('short')
  if(action==='cancel-render'){await api('render:cancel');return notice('Cancelando proceso…')}
  if(action==='start-recorder')return await manageRecording();
  if(action==='record-format')return selectRecordFormat(b.dataset.format);
  if(action==='record-start')return await startRecording();
  if(action==='record-stop')return await stopRecording();
  if(action==='record-retry')return await retryRecording();
  if(action==='record-save')return await saveRecordedVideo();
  if(action==='modal-close'){closeRecorder();return}
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
  if(action==='export-week')return await openReview('week');
 }catch(err){notice(err.message,true);console.error(err)}
});
document.addEventListener('change',async e=>{
 if(e.target.id==='camera-choice'||e.target.id==='mic-choice'){if(!state.recorder)try{await openCamera()}catch(err){notice(err.message,true)}return}
 const p=state.project;if(!p||state.page!=='project')return;
 const s=p.scenes[state.scene],el=e.target;
 if(el.dataset.cutMarker){updateCutMarker(el.dataset.cutMarker,el.value);return}
 if(el.dataset.cutZoom){state.cutZoom=Math.max(1,Math.min(8,Number(el.value)||1));render();return}
 if(el.dataset.field){s[el.dataset.field]=['start','end','scale'].includes(el.dataset.field)?Number(el.value):el.value;s.approved=false;queueSave();if(el.dataset.field==='start'||el.dataset.field==='end')render()}
 else if(el.dataset.formatField){
   if(!s.formats)s.formats={};
   if(!s.formats[state.orientation])s.formats[state.orientation]={};
   s.formats[state.orientation][el.dataset.formatField]=el.dataset.formatField==='scale'?Number(el.value):el.value;
   s.approved=false;queueSave();render();
 }
 else if(el.dataset.projectField){p[el.dataset.projectField]=el.value;order.forEach(k=>p.scenes[k].approved=false);queueSave();render()}
 else if(el.dataset.mediaSpeed!==undefined){s.media[Number(el.dataset.mediaSpeed)].speed=Number(el.value)||1;s.approved=false;await saveNow();prepareScenePreview()}
 else if(el.dataset.mediaStart!==undefined){s.media[Number(el.dataset.mediaStart)].start=Math.max(0,Number(el.value)||0);s.approved=false;await saveNow();prepareScenePreview()}
 else if(el.dataset.mediaEnd!==undefined){s.media[Number(el.dataset.mediaEnd)].end=Math.max(0,Number(el.value)||0);s.approved=false;await saveNow();prepareScenePreview()}
 else if(el.dataset.mediaMicro!==undefined){s.media[Number(el.dataset.mediaMicro)].microcuts=el.checked;s.approved=false;await saveNow();prepareScenePreview()}
});
document.addEventListener('paste',async e=>{
 if(e.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
 const items=Array.from(e.clipboardData?.items||[]);
 if(!items.some(item=>item.type.startsWith('image/')))return;
 if(state.page==='global-library'&&state.globalTab==='media'){
  e.preventDefault();try{await api('global:paste');state.globalAssets=await api('global:list');render()}catch(err){notice(err.message,true)}return;
 }
 if(state.page==='project-library'&&state.project){
  e.preventDefault();try{await uploadProjectOnly('image',true)}catch(err){notice(err.message,true)}return;
 }
 if(state.page!=='project'||state.scene==='closing'||!state.project)return;
 e.preventDefault();
 try{await pasteImage(true)}catch(err){notice(err.message,true)}
});
document.addEventListener('toggle',e=>{if(e.target.matches?.('details[data-tool]')&&e.target.open)state.editorPanel=e.target.dataset.tool},true);

document.addEventListener('pointerdown',e=>{
 const handle=e.target.closest?.('[data-trim-drag]');
 if(!handle||!state.project||state.page!=='project')return;
 const which=handle.dataset.trimDrag,duration=editorDuration(),content=$('#edit-wave-content');
 if(!content||!duration)return;
 e.preventDefault();
 const rect=content.getBoundingClientRect();
 const move=ev=>updateCutMarker(which,(ev.clientX-rect.left)/rect.width*duration,true);
 const stop=()=>{
  document.removeEventListener('pointermove',move);
  document.removeEventListener('pointerup',stop);
  document.removeEventListener('pointercancel',stop);
  render();
 };
 document.addEventListener('pointermove',move);
 document.addEventListener('pointerup',stop,{once:true});
 document.addEventListener('pointercancel',stop,{once:true});
 move(e);
});
document.addEventListener('click',e=>{
 const area=e.target.closest?.('[data-wave-seek]');
 if(!area||e.target.closest?.('[data-trim-drag]')||state.page!=='project')return;
 const video=$('#speaker-preview'),duration=editorDuration();
 if(!video||!duration)return;
 const rect=area.getBoundingClientRect();
 video.currentTime=Math.max(0,Math.min(duration,(e.clientX-rect.left)/rect.width*duration));
 updatePreviewEdits();
});
document.addEventListener('timeupdate',e=>{
 if(e.target?.id!=='final-review-video')return;
 const v=e.target,clock=$('#review-clock');
 if(clock)clock.textContent=fmt(v.currentTime)+' / '+fmt(v.duration||state.reviewInfo?.duration||0);
 const chapters=(state.reviewInfo?.chapters||[]).filter(c=>!c.transition);
 const active=chapters.findIndex(c=>v.currentTime>=c.start&&v.currentTime<c.start+c.duration);
 document.querySelectorAll('[data-review-chapter]').forEach((el,i)=>el.classList.toggle('review-active',i===active));
},true);
document.addEventListener('error',e=>{
 if(e.target?.id==='final-review-video')notice('Error al reproducir la revisión: '+(e.target.error?.message||'Código '+e.target.error?.code),true);
},true);
document.addEventListener('input',e=>{
 const el=e.target;if(el.dataset.field==='title'&&state.page==='project'){state.project.scenes[state.scene].title=el.value;state.project.scenes[state.scene].approved=false;queueSave()}
});
window.studio.onProgress(detail=>{
 state.status=detail.message||('Procesando segmentos: '+(detail.done||0));
 if(state.page==='review'){const el=$('#review-progress-msg');if(el)el.textContent=state.status;return}
 if(state.page==='project'||state.page==='week'){
  const banner=$('#view .panel:last-child');if(banner&&state.status)banner.dataset.progress=state.status;
 }
});
(async()=>{try{state.settings=await api('settings:get');await loadLibrary();render()}catch(e){$('#view').innerHTML='<div class="warning">No se pudo iniciar la aplicación: '+esc(e.message)+'</div>'}})();
