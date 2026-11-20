'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { readBrowser } = require('../backend/browser-statistics.cjs');

// Intérprete simulado: responde como Python y como el lector, sin abrir ningún navegador.
function fakePython(dir) {
  const file = path.join(dir, 'python');
  fs.writeFileSync(file, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '-c') { console.log('cpython-312'); process.exit(0); }
if (args[0] === '-m') { process.exit(0); }
const emit = event => console.log(JSON.stringify(event));
emit({ ready: true });
if (process.env.FAKE_WAIT_LOGIN) { emit({ stage: 'login', message: 'Inicia sesión' }); setInterval(() => {}, 1000); return; }
emit({ stage: 'navigate', message: 'Abriendo Contenido → Videos…' });
emit({ stage: 'listing', found: 2 });
emit({ stage: 'details', index: 1, total: 2 });
emit({ video: { externalId: 'a1', format: 'short', metrics: { views: 5 } } });
emit({ stage: 'details', index: 2, total: 2 });
emit({ done: true, discovered: 2, missing: 1 });
`, { mode: 0o755 });
  return file;
}

function fakeApp(dir) {
  const listeners = new Map();
  return { isPackaged: false, getAppPath: () => path.join(__dirname, '..'), getPath: () => dir,
    once: (name, fn) => listeners.set(name, fn), removeListener: name => listeners.delete(name) };
}

test('el lector recorre el contenido solo e informa cada etapa', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-'));
  const previous = process.env.RECORDS_PYTHON;
  try {
    process.env.RECORDS_PYTHON = fakePython(dir);
    const stages = [], videos = [];
    const result = await readBrowser(fakeApp(dir), 'youtube', video => videos.push(video), { onStatus: stage => stages.push(stage) });
    assert.deepEqual([...new Set(stages)], ['playwright', 'opening', 'navigate', 'listing', 'details']);
    assert.deepEqual(result, { count: 1, missing: 1, canceled: false });
    assert.equal(videos[0].externalId, 'a1');
  } finally {
    if (previous === undefined) delete process.env.RECORDS_PYTHON; else process.env.RECORDS_PYTHON = previous;
    delete process.env.FAKE_WAIT_LOGIN;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cancelar mientras espera el inicio de sesión cierra el lector', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-'));
  const previous = process.env.RECORDS_PYTHON;
  try {
    process.env.RECORDS_PYTHON = fakePython(dir);
    process.env.FAKE_WAIT_LOGIN = '1';
    const controller = new AbortController();
    const reading = readBrowser(fakeApp(dir), 'tiktok', () => {}, { signal: controller.signal,
      onStatus: stage => { if (stage === 'login') controller.abort(); } });
    await assert.rejects(reading, /cancelada/);
  } finally {
    if (previous === undefined) delete process.env.RECORDS_PYTHON; else process.env.RECORDS_PYTHON = previous;
    delete process.env.FAKE_WAIT_LOGIN;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
