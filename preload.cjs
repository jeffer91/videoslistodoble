'use strict';
const {contextBridge,ipcRenderer} = require('electron');
const allowed = new Set([
  'projects:list','projects:create','projects:get','projects:save','projects:delete',
  'assets:import','assets:paste-image','assets:record','assets:import-logo','settings:get','settings:set',
  'media:analyze','media:metadata','media:waveform','render:short','render:weekly','render:cancel',
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
