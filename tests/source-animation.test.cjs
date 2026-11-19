'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {sourceAnimation} = require('../backend/source-animation.cjs');
const media = require('../backend/media.cjs');

test('la copia de Windows prepara y reutiliza el motor después de git pull',
  {skip:process.platform !== 'win32', timeout:300000}, async () => {
    const root = path.resolve(__dirname, '..');
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'records source '));
    const signal = AbortSignal.timeout(285000);
    try {
      const runtime = await sourceAnimation(root, cache, signal);
      const output = path.join(cache, 'clip.mp4');
      await media.command(runtime.exe, [...runtime.args, path.join(root, 'assets','logo-11-records.png'),
        output, 'pintura','3', media.toolPath('ffmpeg')], signal);
      assert.ok((await media.probe(output)).duration >= 2.9);
      assert.deepEqual(await sourceAnimation(root, cache, signal), runtime);
    } finally {
      fs.rmSync(cache, {recursive:true, force:true, maxRetries:4});
    }
  });
