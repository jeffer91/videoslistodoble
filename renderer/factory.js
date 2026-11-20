'use strict';
// Fábrica de contenido: biblioteca con búsqueda y filtros, ficha del récord (guion, etiquetas, etapa),
// prompter para grabar y compilaciones por categoría.
// Se carga antes de app.js; usa sus utilidades (state, api, esc, btn, titlebar, render…) solo al ejecutarse.
(function(){
 const C=window.Catalog;
 const filters={text:'',stage:'',field:'',value:'',from:'',to:''};
 const prompter={timer:null,position:0,speed:38,size:26,running:false,last:0};
 const SCENE_LABELS={hook:'Gancho',body:'Desarrollo',closing:'Cierre'};
 const q=selector=>document.querySelector(selector);
 const visibleProjects=()=>state.projects.filter(p=>p.status!=='auxiliary');

 // ---------- Biblioteca de récords ----------
 function stagePill(project){
  const stage=C.deriveStage(project);
  return '<span class="pill stagepill-'+stage+'">'+esc(C.STAGE_LABELS[stage])+'</span>';
 }
 function tagChips(project,limit=4){
  const tags=C.tagsOf(project),all=C.TAG_FIELDS.flatMap(field=>tags[field].map(value=>({field,value})));
  if(!all.length)return '<small class="muted">Sin etiquetas</small>';
  return all.slice(0,limit).map(t=>'<span class="tagchip" title="'+esc(C.TAG_LABELS[t.field])+'">'+esc(t.value)+'</span>').join('')+
   (all.length>limit?'<span class="tagchip more">+'+(all.length-limit)+'</span>':'');
 }
 function recordTile(p){
  return '<article class="card record-card" data-action="open-record-card" data-id="'+esc(p.id)+'">'+
   '<div class="row between">'+stagePill(p)+'<span class="muted mini">'+new Date(p.updatedAt).toLocaleDateString('es-EC')+'</span></div>'+
   '<h3>'+esc(p.title)+'</h3><div class="tagrow">'+tagChips(p)+'</div>'+
   '<div class="row between"><small>'+(p.exports||[]).length+' exportaciones · '+(p.usedBy||[]).length+' compilaciones</small><strong>Abrir →</strong></div></article>';
 }
 function gridHTML(){
  const all=visibleProjects(),list=all.filter(p=>C.matches(p,filters));
  if(!all.length)return '<div class="empty"><h2>Empieza creando tu primer récord</h2><p>Escribe el guion, graba en cuadrado con el prompter, edita y exporta tu Short.</p>'+btn('new','Crear primer récord')+'</div>';
  if(!list.length)return '<div class="empty"><h2>Ningún récord coincide</h2><p>Cambia la búsqueda o quita los filtros.</p>'+btn('library-clear','Quitar filtros','secondary')+'</div>';
  return '<p class="muted mini library-count">'+list.length+' de '+all.length+' récords</p><div class="grid">'+list.map(recordTile).join('')+'</div>';
 }
 function home(){
  const index=C.tagIndex(visibleProjects());
  const valueOptions=filters.field?index[filters.field]:[];
  return titlebar('Mis récords','Busca por título o etiqueta y filtra por etapa. Todo se guarda en tu disco.',btn('new','＋ Nuevo récord')+btn('new-week','Crear video semanal','secondary')+btn('new-category','Video por categoría','secondary'))+
   StudioWorkflow.readyPanel()+
   '<div class="panel library-filters"><div class="filter-row">'+
   '<input id="library-search" type="search" placeholder="Buscar: Messi, Bernabéu, goleador…" value="'+esc(filters.text)+'" aria-label="Buscar récords">'+
   '<select id="library-stage" aria-label="Filtrar por etapa"><option value="">Todas las etapas</option>'+C.STAGES.map(s=>'<option value="'+s+'" '+(filters.stage===s?'selected':'')+'>'+esc(C.STAGE_LABELS[s])+'</option>').join('')+'</select>'+
   '<select id="library-field" aria-label="Tipo de etiqueta"><option value="">Cualquier etiqueta</option>'+C.TAG_FIELDS.map(f=>'<option value="'+f+'" '+(filters.field===f?'selected':'')+'>'+esc(C.TAG_LABELS[f])+'</option>').join('')+'</select>'+
   '<select id="library-value" aria-label="Etiqueta" '+(filters.field?'':'disabled')+'><option value="">'+(filters.field?'Todas':'—')+'</option>'+valueOptions.map(v=>'<option value="'+esc(v.value)+'" '+(C.fold(filters.value)===C.fold(v.value)?'selected':'')+'>'+esc(v.value)+' ('+v.total+')</option>').join('')+'</select>'+
   btn('library-clear','Quitar filtros','secondary')+'</div>'+
   '<div class="workflow-filters"><label class="field">Desde <input id="library-from" type="date" value="'+esc(filters.from)+'"></label>'+
   '<label class="field">Hasta <input id="library-to" type="date" value="'+esc(filters.to)+'"></label></div></div>'+
   '<div id="library-grid">'+gridHTML()+'</div>';
 }
 function refreshGrid(){const grid=q('#library-grid');if(grid)grid.innerHTML=gridHTML()}

 // ---------- Ficha del récord ----------
 function compilationsOf(projectId){return (state.weeks||[]).filter(w=>(w.projectIds||[]).includes(projectId))}
 function recordCardPage(){
  const p=state.project;
  if(!p)return home();
  const tags=C.tagsOf(p),script=C.normalizeScript(p.script),stage=C.deriveStage(p),inWeeks=compilationsOf(p.id);
  const words=C.SCRIPT_PARTS.map(part=>script[part]).join(' ').trim().split(/\s+/).filter(Boolean).length;
  return titlebar('Ficha del récord','Guion, etiquetas y etapa. El guion aparece en el prompter al grabar.',btn('home','← Mis récords','secondary')+btn('card-save','Guardar ficha')+((p.exports||[]).length?btn('delivery-open','Revisar Short exportado','','data-kind="short" data-id="'+esc(p.id)+'" data-file="'+esc(String(p.exports.at(-1).file).split(/[\\/]/).pop())+'"'):'')+btn('card-go-editor','Grabar y editar →')+btn('studio-editing','Transcripción y plan','secondary')+btn('record-recovery','Recuperar toma','secondary'))+
   '<div class="card-layout"><section>'+
   '<div class="panel"><div class="field"><label for="card-title">Título del récord</label><input id="card-title" maxlength="120" value="'+esc(p.title)+'"></div>'+
   '<div class="two"><div class="field"><label for="card-stage">Etapa</label><select id="card-stage">'+C.STAGES.map(s=>'<option value="'+s+'" '+(stage===s?'selected':'')+'>'+esc(C.STAGE_LABELS[s])+'</option>').join('')+'</select></div>'+
   '<div class="field"><label for="card-planned">Fecha de producción</label><input id="card-planned" type="date" value="'+esc(p.plannedDate||'')+'"></div></div>'+
   '<p class="muted mini">Creado el '+esc(new Date(p.createdAt).toLocaleDateString('es-EC'))+' · '+(p.withClaude?'Con aportes de Claude':'Modo manual')+'</p>'+
   '<p class="muted mini">La etapa avanza sola cuando hay guion, grabación o Short exportado. Marca «Aprobado» y «Publicado» a mano.</p></div>'+
   '<div class="panel"><div class="row between"><h2>Guion</h2><span class="muted mini" id="card-words">'+words+' palabras · unos '+Math.max(1,Math.round(words/2.6))+' s hablando</span></div>'+
   C.SCRIPT_PARTS.map(part=>'<div class="field"><label for="card-script-'+part+'">'+SCENE_LABELS[part]+'</label><textarea id="card-script-'+part+'" class="script-area" data-script="'+part+'" rows="'+(part==='body'?9:4)+'" placeholder="'+(part==='hook'?'La frase que detiene el dedo en los primeros 2 segundos':part==='body'?'El récord, la cifra exacta y el contexto':'Pregunta final y «síguenos»')+'">'+esc(script[part])+'</textarea></div>').join('')+
   '<div class="row wrap">'+btn('card-paste-script','Pegar guion completo','secondary')+btn('studio-script-import','Importar guion y etiquetas','secondary')+'<span class="muted mini">Reconoce los encabezados GANCHO, DESARROLLO y CIERRE.</span></div></div>'+
   '</section><section>'+
   StudioWorkflow.projectDeliveries(p)+
   '<div class="panel"><h2>Etiquetas</h2><p class="muted mini">Separa con comas. Sirven para buscar y para armar videos por categoría.</p>'+
   C.TAG_FIELDS.map(field=>'<div class="field"><label for="card-tag-'+field+'">'+esc(C.TAG_LABELS[field])+'</label><input id="card-tag-'+field+'" data-tagfield="'+field+'" list="taglist-'+field+'" value="'+esc(tags[field].join(', '))+'" placeholder="'+esc({jugadores:'Lamine Yamal, Lionel Messi',clubes:'Barcelona',selecciones:'España',estadios:'Santiago Bernabéu',competiciones:'Champions League',tipos:'Más joven, goleador, racha'}[field])+'"></div>').join('')+
   C.TAG_FIELDS.map(field=>'<datalist id="taglist-'+field+'">'+C.tagIndex(visibleProjects())[field].map(v=>'<option value="'+esc(v.value)+'">').join('')+'</datalist>').join('')+'</div>'+
   '<div class="panel"><h2>Notas y fuentes</h2><div class="field"><textarea id="card-notes" rows="4" placeholder="Enlaces, cifras por verificar, ideas para el gráfico…">'+esc(p.notes||'')+'</textarea></div></div>'+
   '<div class="panel"><h2>Aparece en</h2>'+(inWeeks.length?'<div class="list">'+inWeeks.map(w=>'<div class="asset"><span><strong>'+esc(w.title)+'</strong> <small>· '+(w.kind==='category'?'Por categoría':'Semanal')+(w.exportedAt?' · exportada':'')+'</small></span>'+btn('open-week','Abrir','secondary','data-id="'+esc(w.id)+'"')+'</div>').join('')+'</div>':'<p class="muted">Todavía no está en ningún video largo.</p>')+
   '<p class="muted mini">Un récord puede salir en la compilación semanal y también en videos por categoría.</p></div>'+
   '</section></div>';
 }
 function readCard(){
  const p=state.project;if(!p)throw Error('Abre un récord');
  const title=q('#card-title')?.value.trim();
  if(!title)throw Error('El récord necesita un título');
  const tags={};
  for(const field of C.TAG_FIELDS)tags[field]=q('#card-tag-'+field)?.value||'';
  const script={};
  for(const part of C.SCRIPT_PARTS)script[part]=q('#card-script-'+part)?.value||'';
  p.title=title;p.tags=C.normalizeTags(tags);p.script=C.normalizeScript(script);
  p.notes=C.normalizeNotes(q('#card-notes')?.value||'');
  p.stage=C.normalizeStage(q('#card-stage')?.value||'idea');
  p.plannedDate=C.normalizeDate(q('#card-planned')?.value);
 }
 async function saveCard(silent){
  readCard();
  // Solo se envían los campos de la ficha: así no se pisa nada del editor.
  const p=state.project,saved=await api('projects:save',{id:p.id,title:p.title,tags:p.tags,script:p.script,notes:p.notes,stage:p.stage,plannedDate:p.plannedDate});
  Object.assign(p,{title:saved.title,tags:saved.tags,script:saved.script,notes:saved.notes,stage:saved.stage,plannedDate:saved.plannedDate,updatedAt:saved.updatedAt});
  await loadLibrary();
  if(!silent){render();notice('Ficha guardada')}
 }
 async function openRecordCard(id){
  state.project=await api('projects:get',{id});state.scene='hook';state.orientation='short';
  state.page='record-card';state.status='';state.editingWeekId=null;
  await StudioWorkflow.refreshProjectLinks(id);render();
 }
 function updateWordCount(){
  const el=q('#card-words');if(!el)return;
  const words=C.SCRIPT_PARTS.map(part=>q('#card-script-'+part)?.value||'').join(' ').trim().split(/\s+/).filter(Boolean).length;
  el.textContent=words+' palabras · unos '+Math.max(1,Math.round(words/2.6))+' s hablando';
 }
 function pasteScriptModal(){
  const modal=q('#modal-root');modal.hidden=false;
  modal.innerHTML='<div class="modalback"><div class="modal"><h2>Pegar guion completo</h2><p class="muted mini">Pega el texto con los encabezados GANCHO, DESARROLLO y CIERRE. Si no los tiene, todo irá al desarrollo.</p>'+
   '<div class="field"><textarea id="paste-script-text" rows="12" placeholder="GANCHO: …&#10;&#10;DESARROLLO: …&#10;&#10;CIERRE: …"></textarea></div>'+
   '<div class="row">'+btn('card-paste-confirm','Repartir en las tres partes')+btn('modal-close','Cancelar','secondary')+'</div></div></div>';
  q('#paste-script-text').focus();
 }

 // ---------- Prompter ----------
 function stopPrompter(){
  if(prompter.timer){cancelAnimationFrame(prompter.timer);prompter.timer=null}
  prompter.running=false;
  const toggle=q('[data-action="prompter-toggle"]');if(toggle)toggle.textContent='▶ Mover texto';
 }
 function stepPrompter(now){
  const box=q('#prompter-text');
  if(!box||!prompter.running){stopPrompter();return}
  const elapsed=prompter.last?Math.min(.1,(now-prompter.last)/1000):0;prompter.last=now;
  prompter.position+=prompter.speed*elapsed;
  const max=Math.max(0,box.scrollHeight-box.clientHeight);
  if(prompter.position>=max){prompter.position=max;box.scrollTop=max;stopPrompter();return}
  box.scrollTop=prompter.position;
  prompter.timer=requestAnimationFrame(stepPrompter);
 }
 function startPrompter(){
  const box=q('#prompter-text');if(!box||prompter.running)return;
  prompter.running=true;prompter.last=0;prompter.position=box.scrollTop;
  const toggle=q('[data-action="prompter-toggle"]');if(toggle)toggle.textContent='❚❚ Pausar texto';
  prompter.timer=requestAnimationFrame(stepPrompter);
 }
 function resetPrompter(){stopPrompter();prompter.position=0;const box=q('#prompter-text');if(box)box.scrollTop=0}
 // Se llama desde app.js justo después de abrir la ventana de grabación.
 function mountPrompter(){
  stopPrompter();prompter.position=0;
  const modal=q('.recorder-modal'),stage=q('#record-stage');
  if(!modal||!stage||q('#prompter'))return;
  const scene=state.scene,text=String(state.project?.script?.[scene]||'').trim();
  const holder=document.createElement('div');holder.id='prompter';holder.className='prompter';
  holder.innerHTML='<div class="row between prompter-head"><strong>Prompter · '+esc(SCENE_LABELS[scene]||'Escena')+'</strong>'+
   (text?'<div class="row wrap prompter-controls">'+btn('prompter-toggle','▶ Mover texto','secondary')+btn('prompter-reset','↺ Inicio','secondary')+
    '<label class="mini">Velocidad <input type="range" id="prompter-speed" min="10" max="120" step="2" value="'+prompter.speed+'"></label>'+
    '<label class="mini">Tamaño <input type="range" id="prompter-size" min="16" max="44" step="1" value="'+prompter.size+'"></label></div>':'')+'</div>'+
   (text?'<div id="prompter-text" class="prompter-text" style="font-size:'+prompter.size+'px" tabindex="0">'+esc(text)+'<div class="prompter-tail"></div></div>'+
    '<p class="muted mini">El texto empieza a moverse al iniciar la grabación. Colócalo cerca de la cámara para mirar al lente.</p>'
    :'<p class="muted">Esta escena no tiene guion. Escríbelo en la ficha del récord para verlo aquí mientras grabas.</p>');
  stage.parentNode.insertBefore(holder,stage);
 }

 // ---------- Videos largos ----------
 function weeksPage(){
  const cards=state.weeks.map(w=>'<article class="card" data-action="open-week" data-id="'+esc(w.id)+'"><div class="row between"><span class="pill">'+(w.exportedAt?'Exportada':'En edición')+'</span><small>'+new Date(w.createdAt).toLocaleDateString('es-EC')+'</small></div>'+
   '<h3>'+esc(w.title)+'</h3><div class="tagrow"><span class="tagchip">'+(w.kind==='category'?esc(C.TAG_LABELS[w.filter?.field]||'Categoría')+': '+esc(w.filter?.value||''):'Semanal')+'</span></div>'+
   '<div class="row between"><small>'+w.projectIds.length+' récords</small><strong>Revisar →</strong></div></article>').join('');
  return titlebar('Videos largos','Compilación de la semana o de una categoría: un jugador, un club, un estadio…',btn('new-week','＋ Video de la semana')+btn('new-category','＋ Video por categoría','secondary'))+
   (state.weeks.length?'<div class="grid">'+cards+'</div>':'<div class="empty"><h2>Todavía no hay videos largos</h2><p>Exporta Shorts y reúnelos por semana o por categoría.</p></div>');
 }
 function categoryModal(preset){
  const index=C.tagIndex(visibleProjects());
  const fields=C.TAG_FIELDS.filter(f=>index[f].some(v=>v.exported>0));
  const modal=q('#modal-root');modal.hidden=false;
  if(!fields.length){
   modal.innerHTML='<div class="modalback"><div class="modal"><h2>Video por categoría</h2><p>Todavía no hay Shorts exportados con etiquetas. Añade etiquetas en la ficha de cada récord y exporta su Short.</p><div class="row">'+btn('modal-close','Entendido','secondary')+'</div></div></div>';
   return;
  }
  const field=preset?.field&&fields.includes(preset.field)?preset.field:fields[0];
  const values=index[field].filter(v=>v.exported>0);
  modal.innerHTML='<div class="modalback"><div class="modal"><h2>Video por categoría</h2><p class="muted mini">Reúne todos los Shorts exportados con una etiqueta. Pueden haber salido ya en otro video.</p>'+
   '<div class="two"><div class="field"><label for="category-field">Tipo</label><select id="category-field">'+fields.map(f=>'<option value="'+f+'" '+(f===field?'selected':'')+'>'+esc(C.TAG_LABELS[f])+'</option>').join('')+'</select></div>'+
   '<div class="field"><label for="category-value">Etiqueta</label><select id="category-value">'+values.map(v=>'<option value="'+esc(v.value)+'" '+(preset&&C.fold(preset.value)===C.fold(v.value)?'selected':'')+'>'+esc(v.value)+' · '+v.exported+' Shorts</option>').join('')+'</select></div></div>'+
   '<div class="field"><label for="category-title">Título del video (opcional)</label><input id="category-title" maxlength="120" placeholder="Todos los récords de…"></div>'+
   '<div class="row">'+btn('category-confirm','Crear video')+btn('modal-close','Cancelar','secondary')+'</div></div></div>';
 }
 async function createCategory(field,value,title){
  const w=await api('weekly:create',{kind:'category',filter:{field,value},title:title||undefined});
  const modal=q('#modal-root');modal.hidden=true;modal.innerHTML='';
  await loadLibrary();await openWeek(w.id);
 }

 // ---------- Eventos ----------
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  const action=b.dataset.action;
  try{
   if(action==='open-record-card')return await openRecordCard(b.dataset.id);
   if(action==='record-card'){if(!state.project)throw Error('Abre un récord');if(state.page==='project')await saveNow();return await openRecordCard(state.project.id)}
   if(action==='card-save')return await saveCard(false);
   if(action==='card-go-editor'){await saveCard(true);return await openProject(state.project.id,'hook')}
   if(action==='card-paste-script')return pasteScriptModal();
   if(action==='card-paste-confirm'){
    const parts=C.parseScript(q('#paste-script-text')?.value||'');
    const modal=q('#modal-root');modal.hidden=true;modal.innerHTML='';
    for(const part of C.SCRIPT_PARTS){const area=q('#card-script-'+part);if(area)area.value=parts[part]}
    updateWordCount();await saveCard(true);notice('Guion repartido y guardado');return;
   }
   if(action==='library-clear'){Object.assign(filters,{text:'',stage:'',field:'',value:'',from:'',to:''});return render()}
   if(action==='new-category')return categoryModal();
   if(action==='quick-category')return await createCategory(b.dataset.field,b.dataset.value);
   if(action==='category-confirm')return await createCategory(q('#category-field')?.value,q('#category-value')?.value,q('#category-title')?.value.trim());
   if(action==='prompter-toggle')return prompter.running?stopPrompter():startPrompter();
   if(action==='prompter-reset')return resetPrompter();
   if(action==='record-stop'||action==='modal-close'||action==='record-save')return stopPrompter();
  }catch(err){notice(err.message,true);console.error(err)}
 });
 document.addEventListener('input',e=>{
  const el=e.target;
  if(el.id==='library-search'){filters.text=el.value;refreshGrid();return}
  if(el.dataset?.script!==undefined){updateWordCount();return}
  if(el.id==='prompter-speed'){prompter.speed=Number(el.value)||38;return}
  if(el.id==='prompter-size'){prompter.size=Number(el.value)||26;const box=q('#prompter-text');if(box)box.style.fontSize=prompter.size+'px';return}
 });
 document.addEventListener('change',e=>{
  const el=e.target;
  if(el.id==='library-stage'){filters.stage=el.value;refreshGrid();return}
  if(el.id==='library-field'){filters.field=el.value;filters.value='';render();return}
  if(el.id==='library-from'||el.id==='library-to'){filters[el.id.slice(8)]=el.value;refreshGrid();return}
  if(el.id==='library-value'){filters.value=el.value;refreshGrid();return}
  if(el.id==='category-field'){categoryModal({field:el.value});return}
  // La ficha se guarda sola al salir de cada campo.
  if(state.page==='record-card'&&el.closest('.card-layout')){saveCard(true).catch(err=>notice(err.message,true));return}
 });
 // Al mover el texto a mano, el desplazamiento automático continúa desde ahí.
 document.addEventListener('scroll',e=>{if(e.target?.id==='prompter-text'&&!prompter.running)prompter.position=e.target.scrollTop},true);

 window.Factory={home,weeksPage,recordCardPage,mountPrompter,startPrompter,stopPrompter,resetPrompter,openRecordCard,saveCard,filters};
})();
