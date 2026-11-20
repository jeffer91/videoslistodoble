'use strict';
// Descarga única de herramientas y modelos, verificada por SHA-256 y de tamaño limitado.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const running = new Map();

async function download(url, file, expected, limit, label, signal) {
  const controller = AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(20 * 60000)]);
  const response = await fetch(url, { signal: controller });
  if (!response.ok || !response.body) throw Error('No se pudo descargar ' + label + ' · HTTP ' + response.status);
  let size = 0;
  const hash = createHash('sha256');
  const verify = new Transform({
    transform(bytes, _encoding, callback) {
      size += bytes.length;
      if (size > limit) return callback(Error('La descarga de ' + label + ' supera el tamaño previsto'));
      hash.update(bytes);
      callback(null, bytes);
    }
  });
  await pipeline(Readable.fromWeb(response.body), verify, fs.createWriteStream(file, { flags: 'wx' }), { signal: controller });
  if (hash.digest('hex') !== expected) throw Error('La descarga de ' + label + ' no coincide con la versión verificada');
}

/** Devuelve el archivo ya instalado o lo descarga una sola vez (las llamadas simultáneas comparten la descarga). */
async function ensure(file, { url, sha256, limit, label, executable = false }, signal) {
  if (fs.existsSync(file)) return file;
  if (running.has(file)) return running.get(file);
  const task = (async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const partial = file + '.' + process.pid + '.descarga';
    fs.rmSync(partial, { force: true });
    try {
      await download(url, partial, sha256, limit, label, signal);
      if (executable && process.platform !== 'win32') fs.chmodSync(partial, 0o755);
      fs.renameSync(partial, file);
      return file;
    } finally {
      fs.rmSync(partial, { force: true });
    }
  })().finally(() => running.delete(file));
  running.set(file, task);
  return task;
}

module.exports = { ensure };
