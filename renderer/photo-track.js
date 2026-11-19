'use strict';
const PhotoTrack=(()=>{
 let draft=null;
 const round=n=>Math.round(n*100)/100;
 const clamp=(n,a,b)=>Math.max(a,Math.min(n,b));
 const current=()=>state.project.scenes[state.scene];
 function blocks(scene,duration){
  const start=Number(scene.start)||0,end=Math.min(scene.end||duration,duration);
  const media=scene.media??[];
  const auto=media.filter(m=>!Number.isFinite(m.at));
  const cuts=[...(scene.cuts||[]).filter(c=>c.mode==='both'),...(scene.silences||[]).filter(c=>c.remove)].sort((a,b)=>a.start-b.start);
  let from=start;const ranges=[];
  for(const c of cuts){if(c.start>from)ranges.push([from,Math.min(end,c.start)]);from=Math.max(from,c.end);if(from>=end)break;}
  if(from<end)ranges.push([from,end]);
  const total=ranges.reduce((n,[a,b])=>n+b-a,0);
  function source(t){for(const [a,b] of ranges){if(t<=b-a+.00001)return a+t;t-=b-a;}return end;}
  return media.map(m=>{
   if(Number.isFinite(m.at))return {...m};
   const i=auto.indexOf(m),at=source(total*i/auto.length);
   return {...m,at,seconds:source(total*(i+1)/auto.length)-at};
  });
 }
 function label(asset,item,index){
  const style=item.photo?.style||asset?.name?.match(/[-_](pintura|lapiz)\.mp4$/i)?.[1]?.toLowerCase();
  const kind=({pintura:'Pintura',lapiz:'Lápiz',in:'Acercamiento',out:'Alejamiento',pan:'Panorámica',still:'Foto'})[style] || (asset?.type==='video'?'Clip':'Imagen');
  return kind+' '+(index+1);
 }
 function selectBlock(index){
  const item=current().media[index],asset=state.project.assets.find(a=>a.id===item.assetId);
  draft={scene:state.scene,project:state.project.id,index};
  const edit=(item.photo||asset?.type==='image')?btn('photo-edit','Editar imagen'):'';
  const border=asset?.type==='video'&&!item.borderRemoved&&(item.photo?.style==='lapiz'||item.photo?.style==='pintura'||/[-_](pintura|lapiz)\.mp4$/i.test(asset.name));
  modal(label(asset,item,index),edit+(border?btn('photo-border','Quitar marco de papel','secondary'):'')+btn('photo-remove','Quitar de la escena','danger'));
 }
 function track(scene,duration){
  return '<div class="photo-track">'+blocks(scene,duration).map((m,i)=>{
   const a=state.project.assets.find(x=>x.id===m.assetId),thumb=m.photo?.assetId||(a?.type==='image'?a.id:null);
   return '<button type="button" data-photo-block="'+i+'" class="photo-block" style="left:'+100*m.at/duration+'%;width:'+100*m.seconds/duration+'%" title="'+esc(a?.name||'Imagen')+' · '+round(m.at)+' s">'+
    (thumb?'<img draggable="false" src="'+url(state.project,thumb)+'" alt="">':'')+'<span>'+esc(label(a,m,i))+'</span><b data-photo-edge aria-label="Cambiar duración">↔</b></button>';
  }).join('')+'</div>';
 }
 function modal(title,body){
  const m=$('#modal-root');m.hidden=false;m.innerHTML='<div class="modalback"><div class="modal photo-dialog"><div class="row between"><h2>'+esc(title)+'</h2>'+btn('modal-close','Cerrar','secondary')+'</div>'+body+'</div></div>';
 }
 function close(){const m=$('#modal-root');m.hidden=true;m.innerHTML='';}
 function active(){return draft && state.page==='project'&&draft.project===state.project?.id&&draft.scene===state.scene;}
 async function open(scene,index=-1){
  if(state.page!=='project'||state.scene!==scene)await openProject(state.project.id,scene,state.orientation,'resources');
  if(!current().video)throw Error('Primero graba o importa la toma.');
  const s=current(),end=editorDuration()||s.end;
  const items=blocks(s,end),m=items[index],p=m?.photo;
  let at=m?.at??items.reduce((n,v)=>Math.max(n,v.at+v.seconds),s.start||0);
  if(at>=end-.01)at=Math.max(s.start||0,Math.min($('#speaker-preview')?.currentTime||0,end-1));
  draft={project:state.project.id,scene,index,assetId:p?.assetId||null,at:round(at),seconds:m?.seconds||Math.min(5,Math.max(1,end-at)),crop:p?.crop||[0,0,1,1],focus:p?.focus||[.5,.5],style:p?.style||'in',glow:p?.glow||false};
  if(!draft.assetId && m && state.project.assets.find(a=>a.id===m.assetId)?.type==='image')draft.assetId=m.assetId;
  if(draft.assetId)return form();
  const photos=state.project.assets.filter(a=>a.type==='image');
  modal('Elegir imagen',btn('photo-import','Importar foto')+'<div class="photo-picker">'+photos.map(a=>'<button data-action="photo-select" data-id="'+esc(a.id)+'"><img src="'+url(state.project,a.id)+'" alt="">'+esc(a.name)+'</button>').join('')+'</div>');
 }
 function form(){
  const d=draft;
  modal('Preparar imagen','<p>Arrastra sobre la foto para recortar. Haz clic dentro del encuadre para elegir el centro del zoom.</p>'+
   '<div class="crop-area"><img id="photo-original" draggable="false" src="'+url(state.project,d.assetId)+'"><div id="photo-crop"></div><i id="photo-focus">+</i></div>'+
   btn('photo-reset','Usar foto completa','secondary')+
   '<label>Efecto<select id="photo-style">'+[['still','Foto fija'],['lapiz','Dibujo a lápiz'],['pintura','Pintura'],['in','Acercamiento'],['out','Alejamiento'],['pan','Desplazamiento lateral']].map(([v,l])=>'<option value="'+v+'" '+(v===d.style?'selected':'')+'>'+l+'</option>').join('')+'</select></label>'+
   '<label><input type="checkbox" id="photo-glow" '+(d.glow?'checked':'')+'> Brillo suave en la fotografía</label>'+
   '<div class="two"><label>Inicio en la toma (s)<input type="number" step=".01" id="photo-at" value="'+round(d.at)+'"></label><label>Duración (s)<input type="number" min="1" max="180" step=".1" id="photo-seconds" value="'+round(d.seconds)+'"></label></div>'+
   btn('photo-preview','Generar vista previa'));
  paint();
 }
 function paint(){
  const [l,t,r,b]=draft.crop,box=$('#photo-crop'),mark=$('#photo-focus');
  Object.assign(box.style,{left:l*100+'%',top:t*100+'%',width:(r-l)*100+'%',height:(b-t)*100+'%'});
  Object.assign(mark.style,{left:(l+draft.focus[0]*(r-l))*100+'%',top:(t+draft.focus[1]*(b-t))*100+'%'});
 }
 function changed(s,items){
  s.media=items;s.approved=false;
  return saveNow().then(async()=>{close();render();await prepareScenePreview();});
 }
 async function place(item,index,choice){
  const s=current(),end=Math.min(editorDuration(),s.end||Infinity),items=blocks(s,editorDuration());
  if(index>=0)items.splice(index,1);
  if(item.at<(s.start||0)||item.seconds<.1||item.at+item.seconds>end+.005)throw Error('El bloque debe quedar dentro de la escena.');
  const collides=m=>m.at<item.at+item.seconds-.005 && m.at+m.seconds>item.at+.005;
  if(items.some(collides)){
   if(!choice){
    draft.pending={item,index};
    modal('Ya hay una imagen aquí','<p>Insertar coloca el bloque antes de la imagen que ocupa ese segundo y desplaza las siguientes. Reemplazar quita de la pista los bloques que se cruzan.</p>'+btn('photo-insert','Insertar antes')+btn('photo-replace','Reemplazar los bloques cruzados','secondary')+btn('modal-close','Cancelar','secondary'));
    return;
   }
   if(choice==='insert'){
    item={...item,at:Math.min(item.at,...items.filter(collides).map(m=>m.at))};
    for(const m of items)if(m.at>=item.at)m.at=round(m.at+item.seconds);
    if(items.some(m=>m.at+m.seconds>end+.005))throw Error('No queda tiempo al final para desplazar esos bloques. Acorta un bloque o elige Reemplazar.');
   }else for(let i=items.length-1;i>=0;i--)if(collides(items[i]))items.splice(i,1);
  }
  await changed(s,[...items,item].sort((a,b)=>a.at-b.at));
 }
 async function handle(action,b){
  if(action==='photo-add')return open(state.scene);
  if(!active())throw Error('Vuelve a elegir la imagen en la escena.');
  if(action==='photo-edit')return open(state.scene,draft.index);
  if(action==='photo-remove')return changed(current(),current().media.filter((_,i)=>i!==draft.index));
  if(action==='photo-border'){
   const d=draft,s=current(),item=s.media[d.index];
   b.disabled=true;b.textContent='Quitando marco…';
   try{
    const asset=await api('scene:remove-border',{projectId:d.project,assetId:item.assetId});
    if(draft!==d||!active())return;
    state.project.assets.push(asset);
    return await changed(s,s.media.map((m,i)=>i===d.index?{...m,assetId:asset.id,borderRemoved:true}:m));
   }finally{b.disabled=false;b.textContent='Quitar marco de papel';}
  }
  if(action==='photo-import'){
   const result=await api('assets:import',{projectId:draft.project,kind:'image',single:true});
   if(!result.files?.length){if(result.errors?.length)throw Error(result.errors[0].message);return;}
   state.project.assets.push(result.files[0]);draft.assetId=result.files[0].id;return form();
  }
  if(action==='photo-select'){draft.assetId=b.dataset.id;return form();}
  if(action==='photo-reset'){draft.crop=[0,0,1,1];draft.focus=[.5,.5];return paint();}
  if(action==='photo-back')return form();
  if(action==='photo-preview'){
   const d=draft;
   Object.assign(d,{style:$('#photo-style').value,seconds:Number($('#photo-seconds').value),at:Number($('#photo-at').value),glow:$('#photo-glow').checked});
   if(d.seconds<1||d.seconds>180||!Number.isFinite(d.at)||d.at<(current().start||0)||d.at+d.seconds>Math.min(editorDuration(),current().end||Infinity)+.005)throw Error('Elige un inicio y una duración que quepan en la escena (mínimo 1 segundo).');
   const {project,assetId,style,seconds,glow,focus,crop}=d;
   modal('Preparando vista previa','<p>Generando el clip…</p>'+btn('cancel-render','Cancelar','secondary'));
   try{
    await saveNow();
    const result=await api('scene:photo-clip',{projectId:project,assetId,style,seconds,glow,focus,crop});
    if(!active()||draft!==d)return;
    state.project.assets.push(result.asset);
    d.pending={index:d.index,item:{assetId:result.asset.id,at:d.at,seconds,start:0,end:result.duration,fitDuration:true,borderRemoved:['pintura','lapiz'].includes(style),microcuts:false,photo:{assetId,style,glow,focus,crop}}};
    modal('Vista previa del bloque','<video class="photo-demo" controls autoplay muted src="'+url(state.project,result.asset.id)+'"></video>'+btn('photo-apply','Colocar en la pista')+btn('photo-back','Ajustar','secondary'));
    $('.photo-demo').playbackRate=clamp(result.duration/d.seconds,.0625,16);
   }catch(e){if(active())form();throw e;}
  }
  if(['photo-apply','photo-insert','photo-replace'].includes(action)){
   const {item,index}=draft.pending;return place(item,index,action==='photo-insert'?'insert':action==='photo-replace'?'replace':null);
  }
 }
 document.addEventListener('keydown',e=>{
  const block=e.target.closest('[data-photo-block]');
  if(block && ['Enter',' '].includes(e.key)){e.preventDefault();selectBlock(Number(block.dataset.photoBlock));}
 });
 document.addEventListener('pointerdown',e=>{
  const img=e.target.closest('#photo-original');
  if(img){
   const box=img.getBoundingClientRect();
   const point=ev=>[clamp((ev.clientX-box.left)/box.width,0,1),clamp((ev.clientY-box.top)/box.height,0,1)];
   const [x,y]=point(e),previous=draft.crop;
   img.setPointerCapture(e.pointerId);
   img.onpointermove=ev=>{const [u,v]=point(ev);if(Math.abs(u-x)>.02&&Math.abs(v-y)>.02){draft.crop=[Math.min(x,u),Math.min(y,v),Math.max(x,u),Math.max(y,v)];draft.focus=[.5,.5];paint();}};
   img.onpointerup=ev=>{img.onpointermove=null;img.onpointerup=null;const [u,v]=point(ev);
    if(Math.abs(u-x)<.02&&Math.abs(v-y)<.02){const [l,t,r,b]=previous;draft.focus=[clamp((u-l)/(r-l),0,1),clamp((v-t)/(b-t),0,1)];paint();}
   };return;
  }
  const block=e.target.closest('[data-photo-block]');if(!block)return;
  e.preventDefault();const index=Number(block.dataset.photoBlock),duration=editorDuration(),scene=current(),item=blocks(scene,duration)[index];
  const width=block.parentElement.getBoundingClientRect().width,start=e.clientX,resize=!!e.target.closest('[data-photo-edge]'),end=scene.end||duration;
  const original={...item};block.setPointerCapture(e.pointerId);
  function move(ev){
   const delta=(ev.clientX-start)*duration/width;
   if(resize){item.seconds=round(clamp(original.seconds+delta,.1,end-item.at));if(!item.fitDuration&&item.end>0&&state.project.assets.find(a=>a.id===item.assetId)?.type==='video')item.fitDuration=true;}
   else item.at=round(clamp(original.at+delta,scene.start||0,end-item.seconds));
   block.style.left=100*item.at/duration+'%';block.style.width=100*item.seconds/duration+'%';block.title=round(item.at)+' s · '+round(item.seconds)+' s';
  }
  block.onpointermove=move;
  block.onpointercancel=()=>render();
  block.onpointerup=async ev=>{
   block.onpointermove=null;block.onpointerup=null;
   try{
    if(Math.abs(ev.clientX-start)<3){if(!resize)selectBlock(index);return;}
    move(ev);render();draft={project:state.project.id,scene:state.scene};await place(item,index);
   }catch(err){render();notice(err.message,true);}
  };
 });
 function dismiss(){draft=null;}
 return {track,open,handle,dismiss,label};
})();
