'use strict';
// Se ejecuta antes de `npm start`: si faltan dependencias (primera vez o carpeta node_modules borrada),
// las instala para que la app abra con un solo comando.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const pack=require('../package.json');
const needed=['electron',...Object.keys(pack.dependencies)];
const missing=needed.filter(name=>!fs.existsSync(path.join(root,'node_modules',name,'package.json')));
const [major]=process.versions.node.split('.').map(Number);
if(major<22){
 console.error('11 Récords Studio necesita Node.js 22 o superior. Versión instalada: '+process.versions.node);
 process.exit(1);
}
if(!missing.length)process.exit(0);
console.log('Instalando dependencias que faltan ('+missing.join(', ')+'). Solo ocurre la primera vez…');
const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['ci','--no-audit','--no-fund'],
 {cwd:root,stdio:'inherit',shell:process.platform==='win32'});
if(result.status!==0){
 console.error('No se pudieron instalar las dependencias. Revisa la conexión a internet y ejecuta "npm ci".');
 process.exit(result.status||1);
}
