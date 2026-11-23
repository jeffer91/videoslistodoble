'use strict';
/*
 * Arma el sitio de GitHub Pages en ./site (o en la carpeta indicada):
 *   /            portada
 *   /grabador/   grabadora móvil enlazada con Studio
 *   /shorts/     app web para grabar y producir Shorts
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'site'));

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
copyDir(path.join(root, 'grabador'), path.join(out, 'grabador'));
copyDir(path.join(root, 'shorts'), path.join(out, 'shorts'));
const media = path.join(out, 'shorts', 'media');
fs.mkdirSync(media, { recursive: true });
for (const [from, to] of [
  ['logo-11-records.png', 'logo-11-records.png'],
  ['sello-vertical.png', 'sello-vertical.png'],
  ['sello.wav', 'sello.wav'],
  ['shorts-icon-192.png', 'icon-192.png'],
  ['shorts-icon-512.png', 'icon-512.png']
]) fs.copyFileSync(path.join(root, 'assets', from), path.join(media, to));
fs.copyFileSync(path.join(root, '.github', 'mobile-pages-index.html'), path.join(out, 'index.html'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('Sitio preparado en ' + out);
