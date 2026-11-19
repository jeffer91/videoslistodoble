'use strict';
const ClosingStamp = (() => {
  function timing(scene) {
    const stamp=scene?.closingStamp;
    return stamp?.assetId===scene?.video && Number.isFinite(stamp?.at) ? stamp.at : null;
  }
  function stage(scene) {
    const at=timing(scene);
    if(at===null || at<(scene.start||0) || (scene.end>0 && at>=scene.end) ||
      [...(scene.silences||[]).filter(x=>x.remove),...(scene.cuts||[]).filter(x=>x.mode==='both')].some(x=>at>=x.start&&at<x.end))return '';
    return '<img class="closing-stamp" data-stamp-at="'+at+'" src="../assets/sello.png" alt="Récord confirmado" hidden><audio class="stamp-hit" preload="auto" src="../assets/sello.wav"></audio>';
  }
  function track(scene,duration) {
    const at=timing(scene);
    return '<div class="stamp-track" aria-label="Pista de efectos">'+(at===null?'<small>Suelta aquí el sello</small>':'')+'<span class="stamp-cursor" hidden></span>'+
      (at===null?'': '<button class="stamp-block" draggable="true" data-stamp-drag style="left:'+100*at/duration+'%" title="Mover sello">◆ '+at.toFixed(2)+' s</button>')+'</div>';
  }
  function controls(scene) {
    return '<div class="row wrap"><strong>Efectos</strong><button type="button" draggable="true" data-stamp-drag data-action="stamp-place">◆ Récord confirmado</button>'+
      (timing(scene)===null?'':btn('stamp-test','▶ Probar cierre','secondary')+btn('stamp-remove','Quitar sello','secondary'))+
      '</div><small>Arrastra el sello a la pista bajo la onda o pulsa el botón para colocarlo en el cursor.</small>';
  }
  function place(at) {
    if(state.page!=='project'||state.scene!=='closing')return;
    const scene=state.project.scenes.closing;
    if(at!==null){
      const end=Math.min(editorDuration(),scene.end||Infinity);
      if(at<(scene.start||0)||at>=end||[...(scene.cuts||[]).filter(c=>c.mode==='both'),...(scene.silences||[]).filter(c=>c.remove)].some(c=>at>=c.start&&at<c.end))
        return notice('Coloca el sello en un tramo que se conserve antes del final.',true);
      scene.closingStamp={at,assetId:scene.video};
    }else delete scene.closingStamp;
    scene.approved=false;queueSave();render();
  }
  let offset=0,dragging=false;
  document.addEventListener('dragstart',e=>{
    const block=e.target.closest('[data-stamp-drag]');if(!block)return;
    dragging=true;
    offset=block.classList.contains('stamp-block')?e.clientX-block.getBoundingClientRect().left:0;
    e.dataTransfer.setData('text/plain','11-records-stamp');
    e.dataTransfer.effectAllowed='move';
  });
  function drag(e,drop){
    const track=e.target.closest('.stamp-track');if(!dragging||!track)return;
    e.preventDefault();e.dataTransfer.dropEffect='move';
    const box=track.getBoundingClientRect(),duration=editorDuration();
    const at=Math.round(100*WaveZoom.timeAtPointer(e.clientX-offset,box.left,box.width,duration))/100;
    const cursor=track.querySelector('.stamp-cursor');
    cursor.hidden=false;cursor.style.left=100*at/duration+'%';cursor.textContent=at.toFixed(2)+' s';
    if(drop){dragging=false;cursor.hidden=true;place(at);}
  }
  document.addEventListener('dragover',e=>drag(e,false));
  document.addEventListener('drop',e=>drag(e,true));
  document.addEventListener('dragend',()=>{dragging=false;const cursor=document.querySelector('.stamp-cursor');if(cursor)cursor.hidden=true;});
  function sync(video) {
    const box=video.closest('.stage'),img=box?.querySelector('.closing-stamp');
    if(!img)return;
    const elapsed=video.currentTime-Number(img.dataset.stampAt);
    img.hidden=elapsed<0 || elapsed>=1;
    if(!img.hidden && !video.paused && !video.seeking && img.dataset.hit!=='yes'){
      img.dataset.hit='yes';
      const audio=box.querySelector('.stamp-hit');
      const offset=elapsed/(video.playbackRate||1);
      if(offset<.23){audio.currentTime=offset;audio.play().catch(()=>{});}
    }
    if(img.hidden)delete img.dataset.hit;
  }
  document.addEventListener('play',e=>{
    const v=e.target;
    if(!['speaker-preview','final-review-video'].includes(v.id)||!v.closest('.stage')?.querySelector('.closing-stamp'))return;
    const tick=()=>{if(!v.isConnected||v.paused)return;sync(v);requestAnimationFrame(tick);};tick();
  },true);
  document.addEventListener('seeked',e=>{if(['speaker-preview','final-review-video'].includes(e.target.id))sync(e.target);},true);
  return {timing,stage,track,controls,place};
})();
