'use strict';
const {contextBridge,ipcRenderer} = require('electron');
const allowed = new Set([
  'projects:list','projects:create','projects:get','projects:save','projects:delete',
  'assets:import','assets:paste-image','assets:rename','assets:delete','assets:record','assets:import-logo','settings:get','settings:set',
  'global:list','global:import','global:paste','global:rename','global:delete','global:from-project','global:to-project',
  'templates:list','templates:import','templates:paste','templates:set-default','templates:rename','templates:delete',
  'media:analyze','media:metadata','media:waveform','media:preview','media:timeline','review:status','review:export','render:short','render:weekly','render:cancel',
  'weekly:list','weekly:create','weekly:get','weekly:save','system:open-path'
]);
contextBridge.exposeInMainWorld('studio', {
  call: (name,args) => {
    if(!allowed.has(name)) return Promise.reject(new Error('Acción no permitida'));
    return ipcRenderer.invoke(name,args);
  },
  onProgress: callback => {
    if(typeof callback!=='function') return () => {};
    const cb = (_event,detail) => callback(detail);
    ipcRenderer.on('render:progress',cb);
    return () => ipcRenderer.removeListener('render:progress',cb);
  }
});
