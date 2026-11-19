'use strict';
const fs = require('node:fs');
const path = require('node:path');
const production = require('./production.cjs');
const editing = require('./editing.cjs');
const delivery = require('./delivery.cjs');
const { createPublishing, safeLink } = require('./publishing.cjs');
const clients = require('./network-clients.cjs');
const store = require('./store.cjs');

function installWorkflow({ app, shell, dialog, safeStorage, root, window, register, runMedia, send }) {
  const publishing = createPublishing(root, safeStorage);
  let backupTask = null;
  let oauthTask = null;
  const update = { status: 'disponible en una instalación publicada', message: '', installed: app.getVersion(), available: '' };
  let updater;

  function getUpdater() {
    if (updater) return updater;
    if (!app.isPackaged || process.platform !== 'win32') throw Error('Las actualizaciones requieren el instalador de Windows');
    updater = require('electron-updater').autoUpdater;
    updater.logger = null;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.on('checking-for-update', () => { update.status = 'buscando'; update.message = ''; });
    updater.on('update-available', info => { update.status = 'actualización disponible'; update.available = info.version; });
    updater.on('update-not-available', () => { update.status = 'versión al día'; update.available = ''; });
    updater.on('update-downloaded', info => { update.status = 'lista para instalar'; update.available = info.version; });
    updater.on('error', () => {
      update.status = 'sin conexión de actualización';
      update.message = 'GitHub no devolvió una versión instalable. Puedes seguir editando.';
    });
    return updater;
  }

  async function chooseFile(title, extensions) {
    const result = await dialog.showOpenDialog(window(), {
      title, properties: ['openFile'], filters: [{ name: title, extensions }]
    });
    return result.canceled ? null : result.filePaths[0];
  }

  function readInput(file, jsonOnly = true) {
    if (fs.statSync(file).size > 2 * 1024 * 1024) throw Error('Selecciona un archivo de texto de hasta 2 MB');
    const input = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return jsonOnly || path.extname(file).toLowerCase() === '.json' ? JSON.parse(input) : input;
  }

  async function backup() {
    if (!backupTask) {
      backupTask = production.runBackup(root).finally(() => { backupTask = null; });
      return backupTask;
    }
    return backupTask;
  }

  const handlers = {
    'home': () => production.compilationReadiness(root),
    'idea.list': () => production.listIdeas(root),
    'idea.add': ({ value }) => production.addIdeas(root, value),
    'idea.import': async () => {
      const picked = await chooseFile('Importar ideas', ['json']);
      return picked ? production.addIdeas(root, readInput(picked)) : [];
    },
    'idea.decide': data => production.decideIdea(root, data),
    'take.begin': data => production.beginTake(root, data),
    'take.append': data => production.appendTake(root, data),
    'take.list': ({ id }) => production.listTakes(root, id),
    'take.recover': ({ id }) => production.keepTake(root, id),
    'take.discard': ({ id }) => production.discardTake(root, id),
    'square': data => runMedia(signal => production.squareClip(root, data, signal)),
    'backup.status': () => production.backupStatus(root),
    'backup.choose': async ({ hours }) => {
      const { canceled, filePaths } = await dialog.showOpenDialog(window(), {
        title: 'Guardar respaldos en otra ubicación', properties: ['openDirectory', 'createDirectory']
      });
      return canceled ? production.backupStatus(root) : production.setBackup(root, { directory: filePaths[0], hours });
    },
    'backup.schedule': ({ hours, enabled }) => production.setBackup(root, { directory: enabled === false ? '' : undefined, hours }),
    'backup.run': backup,
    'edit.settings': () => editing.editingSettings(root),
    'edit.choose': async ({ type }) => {
      if (!['whisper', 'model'].includes(type)) throw Error('Opción de transcripción inválida');
      const file = await chooseFile(type === 'whisper' ? 'Seleccionar whisper-cli' : 'Seleccionar modelo de Whisper',
        type === 'whisper' ? ['exe', 'bin', ''] : ['bin']);
      return file ? editing.editSettings(root, { [type]: file }) : editing.editingSettings(root);
    },
    'edit.install': () => runMedia(signal => require('./whisper-install.cjs').install(root, signal, send)),
    'edit.transcribe': ({ id }) => runMedia(signal => editing.transcribe(root, id, signal, send)),
    'edit.transcript': data => editing.setTranscript(root, data),
    'edit.handoff': ({ id }) => editing.exportHandoff(root, id),
    'edit.script': async ({ id, value }) => {
      if (value !== undefined) return editing.importScript(root, id, value);
      const file = await chooseFile('Importar guion y etiquetas', ['json', 'txt']);
      return file ? editing.importScript(root, id, readInput(file, false)) : null;
    },
    'edit.plan': async ({ id, value }) => {
      if (value !== undefined) return editing.applyPlan(root, id, value);
      const file = await chooseFile('Importar plan de edición', ['json']);
      return file ? editing.applyPlan(root, id, readInput(file)) : null;
    },
    'edit.week': async ({ id }) => {
      const file = await chooseFile('Importar orden y guion de la compilación', ['json']);
      if (!file) return null;
      const data = readInput(file);
      const current = store.getWeek(root, id);
      if (data.version !== 1) throw Error('El plan de compilación requiere version: 1');
      const projectIds = data.projectIds || current.projectIds;
      if (!Array.isArray(projectIds) || projectIds.length !== current.projectIds.length ||
          new Set(projectIds).size !== current.projectIds.length || projectIds.some(projectId => !current.projectIds.includes(projectId))) {
        throw Error('Ordena los mismos récords que figuran en la compilación');
      }
      const title = String(data.title || current.title).trim().slice(0, 120);
      const project = store.getProject(root, current.supportProjectId);
      editing.importScript(root, project.id, { script: { ...project.script,
        hook: data.intro ?? project.script?.hook, closing: data.closing ?? project.script?.closing
      }, source: data.source });
      return store.saveWeek(root, { id, title, projectIds, transition: data.transition });
    },
    'export.entry': ({ target }) => delivery.entryFor(root, target),
    'export.approve': ({ target, confirmed }) => runMedia(signal => delivery.approveOutput(root, target, confirmed, signal)),
    'export.quality': ({ target }) => runMedia(signal => delivery.checkOutput(root, target, signal)),
    'export.thumbnails': ({ target, values }) => runMedia(signal => delivery.thumbnails(root, target, values, signal)),
    'export.metadata': ({ target, network, value }) => delivery.saveNetwork(root, target, network, value),
    'export.chapters': ({ target }) => {
      const doc = delivery.resolveOutput(root, target).replace(/\.mp4$/, '.capitulos.txt');
      if (!fs.existsSync(doc)) throw Error('Exporta la compilación para generar los capítulos');
      return fs.readFileSync(doc, 'utf8');
    },
    'accounts.list': () => publishing.accounts(),
    'accounts.connect': ({ network, data }) => publishing.connect(network, data),
    'accounts.google': data => {
      if (oauthTask) throw Error('Ya hay una autorización en curso');
      oauthTask = clients.googleOAuth(data, destination => shell.openExternal(destination))
        .then(secrets => publishing.connect('youtube', secrets)).finally(() => { oauthTask = null; });
      return oauthTask;
    },
    'accounts.disconnect': ({ network }) => publishing.disconnect(network),
    'accounts.tiktok': async () => clients.tiktokCreator(await publishing.accountFor('tiktok')),
    'publish.list': ({ target }) => publishing.jobsFor(target),
    'publish.add': async data => {
      const job = await publishing.enqueue(data);
      publishing.tick().catch(() => {});
      return job;
    },
    'publish.change': data => publishing.changeJob(data),
    'publish.link': data => publishing.addLink(data),
    'publish.open': ({ network, url }) => shell.openExternal(safeLink(network, url)),
    'statistics.status': () => publishing.syncStatus(),
    'statistics.list': () => publishing.stats(),
    'statistics.refresh': () => publishing.refreshStats(),
    'statistics.manual': data => publishing.manualStats(data),
    'statistics.export': () => publishing.exportStats(),
    'updates.status': () => ({ ...update, automatic: production.readState(root, 'actualizaciones', { automatic: true }).automatic }),
    'updates.enable': ({ automatic }) => production.writeState(root, 'actualizaciones', { automatic: automatic === true }),
    'updates.check': async () => {
      await getUpdater().checkForUpdates();
      return update;
    },
    'updates.install': () => {
      if (update.status !== 'lista para instalar') throw Error('Descarga primero la actualización');
      getUpdater().quitAndInstall();
      return true;
    },
    'updates.download': async () => {
      if (update.status !== 'actualización disponible') throw Error('Busca primero una nueva versión');
      await getUpdater().downloadUpdate();
      return update;
    }
  };
  register('studio:flow', ({ action, data }) => {
    if (!Object.hasOwn(handlers, action)) throw Error('Acción de producción no permitida');
    return handlers[action](data || {});
  });

  publishing.recover();
  let timer, lastBackupAttempt = 0, lastStatsAttempt = 0, lastUpdateAttempt = 0;
  const maintenance = () => {
    const now = Date.now();
    publishing.tick().catch(() => {});
    if (now - lastBackupAttempt >= 20 * 60000 && production.shouldBackup(root, now)) {
      lastBackupAttempt = now;
      backup().catch(() => {});
    }
    const synced = production.readState(root, 'sincronizacion', { at: null });
    if (now - lastStatsAttempt >= 60 * 60000 &&
      (!synced.at || now - Date.parse(synced.at) >= 7 * 86400000) && Object.values(publishing.accounts()).some(Boolean)) {
      lastStatsAttempt = now;
      publishing.refreshStats().catch(() => {});
    }
    if (app.isPackaged && process.platform === 'win32' && now - lastUpdateAttempt >= 86400000 &&
        production.readState(root, 'actualizaciones', { automatic: true }).automatic) {
      lastUpdateAttempt = now;
      try {
        getUpdater().checkForUpdates().then(async () => {
          if (update.status === 'actualización disponible') await updater.downloadUpdate();
        }).catch(() => {});
      } catch {
        update.status = 'sin conexión de actualización';
      }
    }
  };
  timer = setInterval(maintenance, 15000);
  timer.unref();
  app.on('before-quit', () => clearInterval(timer));
}

module.exports = { installWorkflow };
