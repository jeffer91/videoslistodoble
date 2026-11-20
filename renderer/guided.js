'use strict';

const Guided = (() => {
  const NETWORK_NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
  const JOB_LABELS = { publicado: 'publicado', programado: 'programado', pendiente: 'en cola', enviando: 'enviando',
    procesando: 'procesando', revisar: 'revisar', fallo: 'falló' };

  function inProgress() {
    const list = state.projects.filter(p => p.status !== 'auxiliary' && !p.exports.length).slice(0, 6);
    if (!list.length) return '';
    return '<section class="panel"><h2>En producción</h2><div class="home-list">' + list.map(p => {
      const step = p.nextScene ? 'Grabar ' + names[p.nextScene].toLowerCase() : 'Revisar y exportar';
      const done = ['hook', 'body', 'closing'].indexOf(p.nextScene);
      return '<article class="home-item"><div><strong>' + esc(p.title) + '</strong><small>' +
        (p.nextScene ? 'Escenas grabadas: ' + Math.max(0, done) + ' de 3' : 'Las tres escenas están grabadas') + '</small></div>' +
        '<div class="row wrap">' + btn('guide-resume', 'Continuar · ' + step, '', 'data-id="' + esc(p.id) + '"') +
        btn('open-record-card', 'Ficha', 'secondary', 'data-id="' + esc(p.id) + '"') + '</div></article>';
    }).join('') + '</div></section>';
  }

  function finished() {
    const list = state.readiness?.outputs || [];
    if (!list.length) return '';
    return '<section class="panel"><h2>Videos terminados</h2><p class="muted mini">Revisa el MP4, apruébalo para publicarlo o vuelve al montaje para corregirlo y exportar de nuevo.</p>' +
      '<div class="home-list">' + list.map(item => {
        const data = 'data-kind="' + item.kind + '" data-id="' + esc(item.id) + '" data-file="' + esc(item.file) + '"';
        const status = !item.checked ? '<span class="pill">Sin revisar</span>' : !item.qualityOk ? '<span class="pill warn-pill">Revisa la calidad</span>' :
          item.approved ? (item.sheet ? '<span class="pill ok-pill">Aprobado</span>' : '<span class="pill warn-pill">Falta la ficha</span>') : '<span class="pill">Por aprobar</span>';
        const networks = Object.entries(item.networks).map(([n, job]) => '<span class="pill' + (job.status === 'publicado' ? ' ok-pill' : '') + '">' +
          esc(NETWORK_NAMES[n] || n) + ' · ' + esc(JOB_LABELS[job.status] || job.status) + '</span>').join('');
        return '<article class="home-item"><div><strong>' + esc(item.title) + '</strong><small>' + (item.kind === 'short' ? 'Short' : 'Video largo') +
          (item.duration ? ' · ' + fmt(item.duration) : '') + ' · exportado el ' + esc(new Date(item.exportedAt).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' })) +
          (item.versions > 1 ? ' · ' + item.versions + ' versiones' : '') + '</small><div class="pills">' + status + networks + '</div></div>' +
          '<div class="row wrap">' + btn('delivery-open', item.approved ? 'Ver y publicar' : 'Revisar y aprobar', '', data) +
          (item.kind === 'short' ? btn('guide-resume', 'Corregir montaje', 'secondary', 'data-id="' + esc(item.id) + '"') +
            btn('open-record-card', 'Ficha', 'secondary', 'data-id="' + esc(item.id) + '"') :
            btn('open-week', 'Corregir video', 'secondary', 'data-id="' + esc(item.id) + '"')) + '</div></article>';
      }).join('') + '</div></section>';
  }

  function dashboard() {
    return titlebar('Estudio de videos', '') + '<section class="panel"><div class="row wrap">' +
      btn('new','Crear un Short') + btn('weeks','Crear o continuar un video largo','secondary') + '</div></section>' + inProgress() + finished();
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

  return {dashboard,open,next,nextLabel,scenePage,afterSave};
})();
