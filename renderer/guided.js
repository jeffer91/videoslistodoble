'use strict';

const Guided = (() => {
  function dashboard() {
    const recent = state.projects.find(p => p.status !== 'auxiliary' && !p.exports.length);
    const resume = recent ? '<section class="panel"><h2>' + esc(recent.title) + '</h2>' +
      btn('guide-resume', recent.nextScene ? 'Continuar · Grabar ' + names[recent.nextScene].toLowerCase() : 'Continuar · Revisar Short',
        'secondary', 'data-id="' + esc(recent.id) + '"') + '</section>' : '';
    return titlebar('Estudio de videos', '') + '<section class="panel"><div class="row wrap">' +
      btn('new','Crear un Short') + btn('weeks','Crear o continuar un video largo','secondary') + '</div></section>' + resume;
  }

  async function open(id, scene, week = null) {
    const project = await api('projects:get', {id});
    state.project = project;
    state.editingWeekId = week;
    state.orientation = week ? 'wide' : 'short';
    state.scene = scene || order.find(key => !project.scenes[key].video) || 'closing';
    if (!week && !scene && order.every(key => project.scenes[key].video)) return openReview('short');
    state.page = 'guided';
    render();
  }

  function nextLabel() {
    if (state.editingWeekId) return state.scene === 'hook' ? 'Continuar al cierre' : 'Revisar video largo';
    return {hook:'Continuar al desarrollo', body:'Continuar al cierre', closing:'Revisar Short'}[state.scene];
  }

  async function next() {
    if (!state.project.scenes[state.scene].video) throw Error('Graba o importa la toma para continuar');
    if (state.editingWeekId) {
      if (state.scene === 'closing') return openReview('week');
      const entry = state.week.closing;
      return open(entry.projectId, entry.scene, state.week.id);
    }
    const following = order[order.indexOf(state.scene) + 1];
    return following ? open(state.project.id, following) : openReview('short');
  }

  function scenePage() {
    const project = state.project, scene = project.scenes[state.scene], wide = Boolean(state.editingWeekId);
    const label = wide && state.scene === 'hook' ? 'Introducción' : names[state.scene];
    const step = wide ? (state.scene === 'hook' ? '1 de 2' : '2 de 2') : (order.indexOf(state.scene) + 1) + ' de 3';
    return titlebar(label, (wide ? state.week.title : project.title) + ' · Grabación ' + step) +
      '<section class="panel guide-take">' + (scene.video ? '<video controls preload="metadata" src="' +
        esc(url(project,scene.video)) + '"></video>' : '') + '<div class="row wrap">' +
      (scene.video ? btn('guide-next', nextLabel()) : '') +
      (scene.video && state.scene==='closing'?btn('stamp-editor','Colocar sello en el cierre','secondary'):'') +
      btn('start-recorder', scene.video ? 'Repetir toma' : 'Grabar ' + label.toLowerCase(), scene.video ? 'secondary' : '') +
      btn('mobile-recorder','Usar celular','secondary') + '</div><details><summary>Más opciones de grabación</summary>' +
      btn('import-voice','Importar toma','secondary') + btn('record-recovery','Recuperar toma','secondary') +
      '</details></section>';
  }

  async function afterSave(saved) {
    if (state.page !== 'guided' || state.project?.id !== saved.projectId || state.scene !== saved.scene) return false;
    state.project = await api('projects:get', {id:saved.projectId});
    await next();
    return true;
  }

  function animationDialog(scene) {
    const modal = $('#modal-root');
    modal.hidden = false;
    modal.innerHTML = '<div class="modalback"><div class="modal"><h2>Animar imagen · ' + names[scene] +
      '</h2><label>Estilo<select id="animation-style"><option value="lapiz">Lápiz</option><option value="pintura">Pintura</option></select></label>' +
      '<label>Empezar en el segundo de la toma<input id="animation-at" type="number" step="0.1" min="0" value="' + Number(state.project.scenes[scene].start || 0) + '"></label>' +
      '<label>Duración en segundos<input id="animation-seconds" type="number" value="5" min="3" max="30"></label>' +
      '<div class="row wrap">' + btn('guide-generate','Elegir foto y animar','','data-scene="' + scene + '"') +
      btn('modal-close','Cerrar','secondary') + '</div></div></div>';
  }

  async function generate(scene) {
    const style = $('#animation-style').value, seconds = Number($('#animation-seconds').value);
    if (!Number.isInteger(seconds) || seconds < 3 || seconds > 30) throw Error('Elige entre 3 y 30 segundos');
    const at = Number($('#animation-at').value), target = state.project.scenes[scene];
    if (!Number.isFinite(at) || at < Number(target.start||0) || at >= Number(target.end)) throw Error('Elige un segundo dentro de la toma');
    const modal = $('#modal-root'), projectId = state.project.id;
    modal.innerHTML = '<div class="modalback"><div class="modal" role="status"><h2>Preparando animación…</h2>' +
      btn('cancel-render','Cancelar','secondary') + '</div></div>';
    try {
      await saveNow();
      const item = await api('scene:animate',{projectId, scene, style, seconds, at});
      if (!item) return;
      state.project = await api('projects:get',{id:projectId});
      if (state.page === 'review') await openReview('short');
      else {render(); prepareScenePreview()}
      notice('Animación añadida a ' + names[scene]);
    } finally { modal.hidden = true; modal.innerHTML = '' }
  }

  return {dashboard,open,next,nextLabel,scenePage,afterSave,animationDialog,generate};
})();
