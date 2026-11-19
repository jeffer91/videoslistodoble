'use strict';
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store.cjs');
const media = require('./media.cjs');

async function animate(root, input, runtime, signal) {
  const {projectId, scene, style, seconds, at, source} = input;
  if (!['hook','body'].includes(scene) || !['lapiz','pintura'].includes(style)
      || !Number.isFinite(at) || at < 0 || !Number.isInteger(seconds) || seconds < 3 || seconds > 30) throw Error('Ajustes de animación inválidos');
  const original = store.getProject(root, projectId).scenes[scene];
  if (!original.video || at < Number(original.start || 0) || at >= Number(original.end)) {
    throw Error('Elige un segundo dentro de la toma');
  }
  const tmp = media.temporary(root);
  try {
    const output = path.join(tmp, path.basename(source, path.extname(source)) + '-' + style + '.mp4');
    await media.command(runtime.exe, [...runtime.args, source, output, style, String(seconds), media.toolPath('ffmpeg')], signal);
    if (signal.aborted) throw Error('Animación cancelada');
    const item = store.importAsset(root, projectId, output);
    const project = store.getProject(root, projectId);
    const target = project.scenes[scene];
    target.media.push({assetId:item.id, at, seconds, start:0, end:seconds, speed:1, microcuts:false});
    target.approved = false;
    store.saveProject(root, {id:projectId, scenes:project.scenes});
    return item;
  } finally {
    fs.rmSync(tmp, {recursive:true, force:true, maxRetries:3});
  }
}
module.exports = {animate};
