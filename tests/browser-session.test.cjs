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
process.stdin.once('data', data => {
  if (String(data).trim() !== 'scan') process.exit(0);
  emit({ stage: 'listing', found: 2 });
  emit({ stage: 'details', index: 1, total: 2 });
  emit({ video: { externalId: 'a1', metrics: { views: 5 } } });
  emit({ stage: 'details', index: 2, total: 2 });
  emit({ done: true, discovered: 2, missing: 1 });
});
`, { mode: 0o755 });
  return file;
}

function fakeApp(dir) {
  const listeners = new Map();
  return { isPackaged: false, getAppPath: () => path.join(__dirname, '..'), getPath: () => dir,
    once: (name, fn) => listeners.set(name, fn), removeListener: name => listeners.delete(name) };
}

test('el lector informa cada etapa y espera la confirmación en Studio, sin ventanas ocultas', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-'));
  const previous = process.env.RECORDS_PYTHON;
  try {
    process.env.RECORDS_PYTHON = fakePython(dir);
    const stages = [], videos = [];
    let asked = false;
    const result = await readBrowser(fakeApp(dir), 'youtube', async () => {
      asked = true;
      assert.equal(stages.at(-1), 'ready');
      return true;
    }, video => videos.push(video), { onStatus: stage => stages.push(stage) });
    assert.ok(asked);
    assert.deepEqual([...new Set(stages)], ['playwright', 'opening', 'ready', 'listing', 'details']);
    assert.deepEqual(result, { count: 1, missing: 1, canceled: false });
    assert.equal(videos[0].externalId, 'a1');
  } finally {
    if (previous === undefined) delete process.env.RECORDS_PYTHON; else process.env.RECORDS_PYTHON = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cancelar antes de leer cierra el lector sin error', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-'));
  const previous = process.env.RECORDS_PYTHON;
  try {
    process.env.RECORDS_PYTHON = fakePython(dir);
    const result = await readBrowser(fakeApp(dir), 'tiktok', async () => false, () => {}, {});
    assert.equal(result.canceled, true);
  } finally {
    if (previous === undefined) delete process.env.RECORDS_PYTHON; else process.env.RECORDS_PYTHON = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
