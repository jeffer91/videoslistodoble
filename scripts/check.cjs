'use strict';
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const folders = ['backend', 'renderer', 'grabador', 'scripts', 'tests'];
const files = ['main.cjs', 'preload.cjs'];
for (const folder of folders) {
  files.push(...fs.readdirSync(folder).filter(name => /\.(?:cjs|js)$/.test(name)).map(name => path.join(folder, name)));
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(1);
}
