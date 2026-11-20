'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const readline = require('node:readline');
const {command} = require('./media.cjs');

/**
 * Lectura automática desde el navegador.
 * El usuario solo inicia sesión la primera vez; Studio abre cada listado, lo recorre
 * y lee las cifras de cada video.
 * options.onStatus(stage, data) informa cada etapa para que la interfaz la muestre:
 *   python → playwright → opening → login → navigate → listing → details → (fin)
 * options.signal permite cancelar en cualquier momento.
 */
const STAGES = new Set(['login', 'navigate', 'listing', 'details']);
const NETWORKS = ['youtube','tiktok','instagram','facebook'];

// Un solo navegador a la vez: el lector y el publicador comparten el perfil de cada red.
let busy = null;
function acquireBrowser(owner) {
  if (busy) return false;
  busy = owner;
  return true;
}
function releaseBrowser(owner) { if (busy === owner) busy = null; }
const browserBusy = () => busy;

/** Prepara (la primera vez) Python y Playwright; devuelve las rutas para lanzar los scripts. */
async function preparePython(app, {onStatus = () => {}, signal} = {}) {
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
  return {base, cache, python, packages};
}

async function readBrowser(app, network, save, {onStatus = () => {}, onAccount = () => {}, signal} = {}) {
  if (!NETWORKS.includes(network)) throw Error('Red desconocida');
  if (!acquireBrowser('lector')) throw Error('El navegador está publicando un video. Inténtalo en unos minutos.');
  try { return await runReader(app, network, save, {onStatus, onAccount, signal}); }
  finally { releaseBrowser('lector'); }
}

async function runReader(app, network, save, {onStatus, onAccount, signal}) {
  const {base, cache, python, packages} = await preparePython(app, {onStatus, signal});
  onStatus('opening', {message:'Abriendo el navegador…'});
  const child = spawn(python,['-u',path.join(base,'browser-stats','reader.py'),network,path.join(cache,'perfil-'+network)],
    {windowsHide:true,env:{...process.env,PYTHONPATH:packages,PYTHONIOENCODING:'utf-8'}});
  let browserPid = null;
  const stop = () => {
    child.kill();
    // El navegador se abre como proceso normal: se cierra también al cancelar.
    if (browserPid) { try { process.kill(browserPid); } catch { /* Ya estaba cerrado. */ } browserPid = null; }
  };
  app.once('before-quit',stop);
  signal?.addEventListener('abort',stop,{once:true});
  child.stdin.on('error',()=>{});
  let count=0, summary, failure;
  const closed = new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
  closed.catch(()=>{});
  let diagnostics='';
  child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-800)});
  try {
    for await (const line of readline.createInterface({input:child.stdout})) {
      let event;
      try { event=JSON.parse(line); } catch { continue; }
      if (Number.isSafeInteger(event.browserPid)) browserPid = event.browserPid;
      if (event.ready) onStatus('opening', {message:'Navegador abierto. Comprobando la sesión…'});
      if (STAGES.has(event.stage)) {
        const {stage, message, found, index, total} = event;
        onStatus(stage, Object.fromEntries(Object.entries({message, found, index, total}).filter(([, v]) => v !== undefined)));
      }
      if (event.video) {save(event.video); count++; onStatus('details', {count});}
      if (event.account && Number.isSafeInteger(event.account.followers)) onAccount(event.account);
      if (event.done) summary=event;
      if (event.error) failure=event.error;
    }
    if (signal?.aborted) throw Error('Lectura cancelada');
    if (await closed || !summary) throw Error(failure || diagnostics || 'El navegador se cerró antes de terminar');
    return {count,missing:summary.missing||0,canceled:false};
  } finally {
    stop();
    app.removeListener('before-quit',stop);
    signal?.removeEventListener('abort',stop);
  }
}
module.exports={readBrowser, preparePython, acquireBrowser, releaseBrowser, browserBusy, NETWORKS};
