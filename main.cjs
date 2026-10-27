'use strict';
const {app,BrowserWindow,ipcMain,dialog,shell,protocol,clipboard} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const store = require('./backend/store.cjs');
const media = require('./backend/media.cjs');
const images = require('./backend/image-import.cjs');
let win = null;
let activeJob = null;
const ROOT = process.platform === 'win32' ? 'D:\\11-Records-Studio' : (process.env.RECORDS_TEST_ROOT || path.join(os.homedir(),'11-Records-Studio'));
protocol.registerSchemesAsPrivileged([{scheme:'records',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
function safeError(e){return String(e && e.message || e).slice(0,500)}
function assetUrl(projectId,assetId){return 'records://asset/'+encodeURIComponent(projectId)+'/'+encodeURIComponent(assetId)}
function broadcast(event){if(win&&!win.isDestroyed())win.webContents.send('render:progress',event)}
function register(channel, fn){ipcMain.handle(channel,async (_e,data)=>{try{return {ok:true,data:await fn(data||{})}}catch(err){return {ok:false,error:safeError(err)}}})}
function openWindow(){
  win = new BrowserWindow({width:1370,height:900,minWidth:1000,minHeight:700,title:'11 Récords Studio',
    backgroundColor:'#0a110e',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  win.removeMenu();
  win.loadFile(path.join(__dirname,'renderer','index.html'));
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('file://'))e.preventDefault()});
}
app.whenReady().then(()=>{
  try{store.ensureRoot(ROOT)}catch(e){dialog.showErrorBox('Disco de proyectos no disponible','No se pudo preparar la biblioteca en '+ROOT+': '+safeError(e)+'\nEn Windows es obligatorio disponer del disco D.');app.quit();return}
  protocol.handle('records',request=>{
    try{
      const u=new URL(request.url);
      if(u.hostname==='settings'&&u.pathname==='/logo') { const settings=store.getSettings(ROOT);if(!settings.logo)throw Error('No hay logo');const {net}=require('electron');return net.fetch(require('node:url').pathToFileURL(settings.logo).toString()) }
      if(u.hostname!=='asset') throw Error('Host no permitido');
      const pieces=u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if(pieces.length!==2)throw Error('Ruta inválida');
      const file=store.resolveAsset(ROOT,pieces[0],pieces[1]);
      const {net}=require('electron');
      return net.fetch(require('node:url').pathToFileURL(file).toString());
    }catch(e){return new Response('Not found',{status:404})}
  });
  register('projects:list',()=>store.listProjects(ROOT));
  register('projects:create',x=>store.createProject(ROOT,x));
  register('projects:get',x=>{const p=store.getProject(ROOT,x.id);return {...p,urls:Object.fromEntries((p.assets||[]).map(a=>[a.id,assetUrl(p.id,a.id)]))}});
  register('projects:save',x=>store.saveProject(ROOT,x));
  register('projects:delete',x=>store.deleteProject(ROOT,x.id));
  register('assets:import',async x=>{
    const imageTypes=images.IMAGE_EXTENSIONS.map(e=>e.slice(1));
    const videos=['mp4','mov','mkv','webm','avi'];
    const voice=x.kind==='voice';
    const filters=voice
      ?[{name:'Videos de narración',extensions:videos}]
      :[{name:'Imágenes y videos',extensions:[...new Set([...imageTypes,...videos])]},
        {name:'Solo imágenes',extensions:imageTypes},
        {name:'Todos los archivos',extensions:['*']}];
    const selection=await dialog.showOpenDialog(win,{
      title:voice?'Importar narración':'Importar imágenes o videos',
      properties:['openFile','multiSelections'],filters
    });
    const files=[],errors=[];
    if(selection.canceled)return {files,errors};
    for(const source of selection.filePaths){
      try{
        const ext=path.extname(source).toLowerCase();
        if(voice&&!videos.includes(ext.slice(1)))throw Error('Para la narración selecciona un video');
        if(!voice&&!images.IMAGE_SET.has(ext)&&!videos.includes(ext.slice(1)))
          throw Error('Selecciona un archivo de imagen o video');
        const item=images.IMAGE_SET.has(ext)
          ?await images.importImage(ROOT,x.projectId,source,store)
          :store.importAsset(ROOT,x.projectId,source);
        files.push(item);
      }catch(err){errors.push({name:path.basename(source),message:safeError(err)})}
    }
    return {files,errors};
  });
  register('assets:paste-image',x=>{
    const picture=clipboard.readImage();
    if(picture.isEmpty())return null;
    return store.saveImageBuffer(ROOT,x.projectId,picture.toPNG());
  });
  register('assets:record',x=>store.saveRecording(ROOT,x.projectId,x.name,x.data));
  register('assets:import-logo',async()=>{
    const sel=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Logo',extensions:['png','webp','jpg','jpeg']}]});
    if(sel.canceled||!sel.filePaths.length)return null;
    return store.importLogo(ROOT,sel.filePaths[0]);
  });
  register('settings:get',()=>store.getSettings(ROOT));
  register('settings:set',x=>store.saveSettings(ROOT,x));
  register('media:waveform',x=>media.waveform(store.resolveAsset(ROOT,x.projectId,x.assetId)));
  register('media:metadata',x=>media.probe(store.resolveAsset(ROOT,x.projectId,x.assetId)));
  register('media:analyze',x=>media.detectSilences(store.resolveAsset(ROOT,x.projectId,x.assetId),x.threshold));
  register('weekly:list',()=>store.listWeeks(ROOT));
  register('weekly:create',x=>store.createWeek(ROOT,x));
  register('weekly:get',x=>store.getWeek(ROOT,x.id));
  register('weekly:save',x=>store.saveWeek(ROOT,x));
  register('render:short',async x=>{
    if(activeJob)throw Error('Ya hay una exportación en curso');
    const ctrl=new AbortController();activeJob=ctrl;
    try{return await media.exportShort(ROOT,x.projectId,ctrl.signal,broadcast)}
    finally{activeJob=null}
  });
  register('render:weekly',async x=>{
    if(activeJob)throw Error('Ya hay una exportación en curso');
    const ctrl=new AbortController();activeJob=ctrl;
    try{return await media.exportWeekly(ROOT,x.id,ctrl.signal,broadcast)}
    finally{activeJob=null}
  });
  register('render:cancel',()=>{if(activeJob)activeJob.abort();return true});
  register('system:open-path',async x=>{
    const file=store.resolveManagedPath(ROOT,x.path);
    await shell.openPath(file);return true;
  });
  // Conceder acceso a cámara/micrófono solo desde una interacción en el editor local.
  const ses=require('electron').session.defaultSession;
  ses.setPermissionRequestHandler((webContents,permission,callback,details)=>{const local=webContents===win?.webContents||webContents.getURL().startsWith('file://');callback(local&&['media','audioCapture','videoCapture'].includes(permission))});
  openWindow();
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)openWindow()});
