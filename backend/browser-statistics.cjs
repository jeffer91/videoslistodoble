'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const readline = require('node:readline');
const {command} = require('./media.cjs');

async function readBrowser(app, network, confirm, save) {
  if (!['youtube','tiktok','instagram','facebook'].includes(network)) throw Error('Red desconocida');
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const cache = path.join(app.getPath('userData'),'estadisticas-navegador');
  fs.mkdirSync(cache,{recursive:true});
  const windows = process.platform === 'win32';
  const python = process.env.RECORDS_PYTHON || (windows ? path.join(cache,'python-3.12.10','tools','python.exe') : 'python3');
  if (windows && !process.env.RECORDS_PYTHON && !fs.existsSync(python))
    await command('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(base,'scripts','source-python.ps1'),cache]);
  const tag = (await command(python,['-c','import sys;print(sys.implementation.cache_tag)'])).stdout.trim();
  const packages = path.join(cache,'playwright-1.56.0-'+tag);
  if (!fs.existsSync(packages)) {
    const stage = fs.mkdtempSync(path.join(cache,'install-'));
    try {
      await command(python,['-m','pip','install','--disable-pip-version-check','--target',stage,'playwright==1.56.0']);
      fs.renameSync(stage,packages);
    } finally {fs.rmSync(stage,{recursive:true,force:true});}
  }
  const child = spawn(python,['-u',path.join(base,'browser-stats','reader.py'),network,path.join(cache,'perfil-'+network)],
    {windowsHide:true,env:{...process.env,PYTHONPATH:packages,PYTHONIOENCODING:'utf-8'}});
  const stop = () => child.kill();
  app.once('before-quit',stop);
  child.stdin.on('error',()=>{});
  let count=0, summary, failure, canceled=false;
  const closed = new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
  closed.catch(()=>{});
  let diagnostics='';
  child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-800)});
  try {
    for await (const line of readline.createInterface({input:child.stdout})) {
      const event=JSON.parse(line);
      if (event.ready) {
        canceled=!(await confirm());
        child.stdin.end(canceled?'cancel\n':'scan\n');
      }
      if (event.video) {save(event.video); count++;}
      if (event.done) summary=event;
      if (event.error) failure=event.error;
    }
    if (await closed || (!summary && !canceled)) throw Error(failure || diagnostics || 'El navegador se cerró antes de terminar');
    return {count,missing:summary?.missing||0,canceled};
  } finally {stop();app.removeListener('before-quit',stop);}
}
module.exports={readBrowser};
