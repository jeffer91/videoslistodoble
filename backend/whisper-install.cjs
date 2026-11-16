'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const editing = require('./editing.cjs');
const media = require('./media.cjs');

const VERSION = 'v1.8.3';
const BINARY = 'https://github.com/ggml-org/whisper.cpp/releases/download/' + VERSION + '/whisper-bin-x64.zip';
const BINARY_HASH = 'd824b1e37599f882b396e73f1ee0bfd5d0529f700314c48311dcbd00b803321d';
const MODEL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';
const MODEL_HASH = '465707469ff3a37a2b9b8d8f89f2f99de7299dac';

async function download(url, file, algorithm, expected, limit, signal) {
  const controller = AbortSignal.any([signal, AbortSignal.timeout(15 * 60000)]);
  const response = await fetch(url, { signal: controller });
  if (!response.ok || !response.body) throw Error('No se pudo descargar Whisper · HTTP ' + response.status);
  let size = 0;
  const hash = createHash(algorithm);
  const verify = new Transform({
    transform(bytes, _encoding, callback) {
      size += bytes.length;
      if (size > limit) return callback(Error('Descarga de Whisper superior al tamaño previsto'));
      hash.update(bytes);
      callback(null, bytes);
    }
  });
  await pipeline(Readable.fromWeb(response.body), verify, fs.createWriteStream(file, { flags: 'wx' }), { signal: controller });
  if (hash.digest('hex') !== expected) throw Error('La descarga de Whisper no coincide con la versión verificada');
}

function findExecutable(directory) {
  for (const name of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, name.name);
    if (name.isFile() && name.name.toLowerCase() === 'whisper-cli.exe') return candidate;
    if (name.isDirectory()) {
      const found = findExecutable(candidate);
      if (found) return found;
    }
  }
  return '';
}

async function install(root, signal, send = () => {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw Error('La descarga automática es para Windows x64. Puedes elegir un ejecutable de tu plataforma.');
  }
  const dest = path.join(root, 'Recursos', 'Whisper', VERSION);
  const existingModel = path.join(dest, 'ggml-base.bin');
  const existingBinary = fs.existsSync(dest) && findExecutable(dest);
  if (existingBinary && fs.existsSync(existingModel)) return editing.editSettings(root, { whisper: existingBinary, model: existingModel });

  const temp = media.temporary(root);
  try {
    const zip = path.join(temp, 'whisper.zip');
    const installation = path.join(temp, 'whisper');
    fs.mkdirSync(installation);
    send({ type: 'status', message: 'Descargando motor local de Whisper', percent: 5 });
    await download(BINARY, zip, 'sha256', BINARY_HASH, 8 * 1024 * 1024, signal);
    await media.command(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'),
      ['-xf', zip, '-C', installation], signal);
    const binary = findExecutable(installation);
    if (!binary) throw Error('El paquete no contiene whisper-cli.exe');
    send({ type: 'status', message: 'Descargando modelo en español y otros idiomas · 142 MiB', percent: 40 });
    const model = path.join(installation, 'ggml-base.bin');
    await download(MODEL, model, 'sha1', MODEL_HASH, 160 * 1024 * 1024, signal);
    await media.command(binary, ['--help'], signal);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) throw Error('La carpeta de Whisper ya existe. Selecciona sus archivos desde Ajustes.');
    fs.renameSync(installation, dest);
    send({ type: 'complete', message: 'Whisper listo para usar sin conexión', percent: 100 });
    return editing.editSettings(root, {
      whisper: path.join(dest, path.relative(installation, binary)), model: path.join(dest, 'ggml-base.bin')
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { install };
