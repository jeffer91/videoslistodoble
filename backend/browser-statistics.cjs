'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const readline = require('node:readline');
const {command} = require('./media.cjs');

/**
 * Lectura supervisada desde el navegador.
 * options.onStatus(stage, data) informa cada etapa para que la interfaz la muestre:
 *   python → playwright → opening → ready → listing → details → (fin)
 * options.signal permite cancelar en cualquier momento.
 */
async function readBrowser(app, network, confirm, save, {onStatus = () => {}, signal} = {}) {
  if (!['youtube','tiktok','instagram','facebook'].includes(network)) throw Error('Red desconocida');
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const cache = path.join(app.getPath('userData'),'estadisticas-navegador');
  fs.mkdirSync(cache,{recursive:true});
  const aborted = () => { if (signal?.aborted) throw Error('Lectura cancelada'); };
  const windows = process.platform === 'win32';
  const python = process.env.RECORDS_PYTHON || (windows ? path.join(cache,'python-3.12.10','tools','python.exe') : 'python3');
  if (windows && !process.env.RECORDS_PYTHON && !fs.existsSync(python)) {
    onStatus('python', {message:'Descargando Python (solo la primera vez, unos 15 MB)…'});
    await command('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(base,'scripts','source-python.ps1'),cache],signal);
  }
  aborted();
  const tag = (await command(python,['-c','import sys;print(sys.implementation.cache_tag)'],signal)).stdout.trim();
  const packages = path.join(cache,'playwright-1.56.0-'+tag);
  if (!fs.existsSync(packages)) {
    onStatus('playwright', {message:'Instalando Playwright (solo la primera vez, unos 40 MB)…'});
    const stage = fs.mkdtempSync(path.join(cache,'install-'));
    try {
      await command(python,['-m','pip','install','--disable-pip-version-check','--target',stage,'playwright==1.56.0'],signal);
      fs.renameSync(stage,packages);
    } finally {fs.rmSync(stage,{recursive:true,force:true});}
  }
  aborted();
  onStatus('opening', {message:'Abriendo el navegador…'});
  const child = spawn(python,['-u',path.join(base,'browser-stats','reader.py'),network,path.join(cache,'perfil-'+network)],
    {windowsHide:true,env:{...process.env,PYTHONPATH:packages,PYTHONIOENCODING:'utf-8'}});
  const stop = () => child.kill();
  app.once('before-quit',stop);
  signal?.addEventListener('abort',stop,{once:true});
  child.stdin.on('error',()=>{});
  let count=0, summary, failure, canceled=false;
  const closed = new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
  closed.catch(()=>{});
  let diagnostics='';
  child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-800)});
  try {
    for await (const line of readline.createInterface({input:child.stdout})) {
      let event;
      try { event=JSON.parse(line); } catch { continue; }
      if (event.ready) {
        onStatus('ready', {message:'Navegador abierto. Inicia sesión y abre tu listado de videos.'});
        canceled=!(await confirm());
        child.stdin.end(canceled?'cancel\n':'scan\n');
        if (!canceled) onStatus('listing', {message:'Recorriendo el listado…', found:0});
      }
      if (event.stage==='listing') onStatus('listing', {message:'Recorriendo el listado…', found:event.found});
      if (event.stage==='details') onStatus('details', {message:'Leyendo las cifras de cada video…', index:event.index, total:event.total});
      if (event.video) {save(event.video); count++; onStatus('details', {count});}
      if (event.done) summary=event;
      if (event.error) failure=event.error;
    }
    if (signal?.aborted) throw Error('Lectura cancelada');
    if (await closed || (!summary && !canceled)) throw Error(failure || diagnostics || 'El navegador se cerró antes de terminar');
    return {count,missing:summary?.missing||0,canceled};
  } finally {
    stop();
    app.removeListener('before-quit',stop);
    signal?.removeEventListener('abort',stop);
  }
}
module.exports={readBrowser};
