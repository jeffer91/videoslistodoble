'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { command } = require('./media.cjs');

async function sourceAnimation(appRoot, cache, signal) {
  const worker = path.join(appRoot, 'animation', 'worker.py');
  const requirements = path.join(appRoot, 'animation', 'requirements.txt');
  const fingerprint = crypto.createHash('sha256').update(fs.readFileSync(requirements)).digest('hex');
  const windows = process.platform === 'win32';
  fs.mkdirSync(cache, { recursive: true });
  const override = process.env.RECORDS_PYTHON;
  let exe = override || (windows ? path.join(cache, 'python-3.12.10', 'tools', 'python.exe') : 'python3');
  try {
    if (windows && !override && !fs.existsSync(exe)) {
      await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(appRoot, 'scripts', 'source-python.ps1'), cache], signal);
    }
    // Keep project packages separate even when an existing interpreter is selected.
    const tag = await command(exe, ['-c', 'import sys; print(sys.implementation.cache_tag)'], signal);
    const packages = path.join(cache, 'packages-' + tag.stdout.trim() + '-' + fingerprint.slice(0, 12));
    if (!fs.existsSync(path.join(packages, '.ready'))) {
      const staging = fs.mkdtempSync(path.join(cache, 'install-'));
      try {
        await command(exe, ['-m', 'pip', 'install', '--disable-pip-version-check', '--only-binary=:all:',
          '--target', staging, '-r', requirements], signal);
        fs.writeFileSync(path.join(staging, '.ready'), fingerprint);
        if (!fs.existsSync(packages)) fs.renameSync(staging, packages);
      } finally {
        fs.rmSync(staging, { recursive: true, force: true });
      }
    }
    const args = ['-c', 'import runpy,sys; packages,worker=sys.argv[1:3]; sys.argv=sys.argv[2:]; ' +
      'sys.path[:0]=[packages,__import__("os").path.dirname(worker)]; runpy.run_path(worker,run_name="__main__")',
      packages, worker];
    return {exe,args};
  } catch (error) {
    throw Error('Preparación de la animación: ' + error.message);
  }
}
module.exports = {sourceAnimation};
