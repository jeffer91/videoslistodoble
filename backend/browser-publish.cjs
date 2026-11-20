'use strict';
/**
 * Publicación por navegador: lanza browser-stats/publisher.py con el perfil de
 * navegador de cada red (el mismo del lector de estadísticas, con la sesión ya
 * iniciada) y devuelve el resultado a la cola de publicación.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { randomUUID } = require('node:crypto');
const { preparePython, acquireBrowser, releaseBrowser, NETWORKS } = require('./browser-statistics.cjs');

const REEL_LIMIT = 90;

class BrowserPublishError extends Error {
  constructor(message, { submitted = false, screenshot = null } = {}) {
    super(message);
    this.submitted = submitted;
    this.screenshot = screenshot;
  }
}

function caption(metadata) {
  const tags = (metadata.tags || []).map(value => '#' + String(value).replace(/[^\p{L}\p{N}_]/gu, '')).filter(value => value !== '#');
  return [metadata.title, metadata.description, tags.join(' ')].filter(Boolean).join('\n\n');
}

/**
 * Publica un archivo. Devuelve { busy: true } si el navegador está ocupado
 * (el lector u otra publicación); la cola lo reintenta más tarde.
 */
async function publishWithBrowser(app, network, { file, metadata, quality, dryRun = false, groupUrl = '', onStatus = () => {} }, root) {
  if (!NETWORKS.includes(network)) throw new BrowserPublishError('Red desconocida');
  const owner = 'publicador:' + randomUUID();
  if (!acquireBrowser(owner)) return { busy: true };
  const work = path.join(root, 'Temporales', 'Publicacion-navegador');
  fs.mkdirSync(work, { recursive: true });
  const jobFile = path.join(work, 'trabajo-' + Date.now() + '.json');
  const screenshot = path.join(work, 'fallo-' + network + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png');
  try {
    const { base, cache, python, packages } = await preparePython(app, { onStatus });
    const text = caption(metadata);
    fs.writeFileSync(jobFile, JSON.stringify({
      file, title: metadata.title, description: [metadata.description, (metadata.tags || []).map(t => '#' + t).join(' ')].filter(Boolean).join('\n\n'),
      caption: text, privacy: metadata.privacy || 'public', dryRun, screenshot,
      reel: quality ? quality.duration <= REEL_LIMIT && quality.height > quality.width : true,
      groupUrl: network === 'facebook' ? groupUrl : ''
    }));
    const child = spawn(python, ['-u', path.join(base, 'browser-stats', 'publisher.py'), network, path.join(cache, 'perfil-' + network), jobFile],
      { windowsHide: true, env: { ...process.env, PYTHONPATH: packages, PYTHONIOENCODING: 'utf-8' } });
    let browserPid = null, submitted = false, result = null, failure = null, shot = null, diagnostics = '';
    const stop = () => {
      child.kill();
      if (browserPid) { try { process.kill(browserPid); } catch { /* ya cerrado */ } }
    };
    app.once('before-quit', stop);
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-800); });
    const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    closed.catch(() => {});
    try {
      for await (const line of readline.createInterface({ input: child.stdout })) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (Number.isSafeInteger(event.browserPid)) browserPid = event.browserPid;
        if (event.stage) onStatus(event.stage, { message: event.message });
        if (event.submitted) submitted = true;
        if (event.result) result = event.result;
        if (event.error) { failure = event.error; shot = event.screenshot || null; }
      }
      await closed;
    } finally {
      stop();
      app.removeListener('before-quit', stop);
    }
    if (!result) {
      throw new BrowserPublishError(failure || diagnostics.trim().split('\n').at(-1) || 'El navegador se cerró antes de terminar',
        { submitted, screenshot: shot && fs.existsSync(shot) ? shot : null });
    }
    return { id: null, url: result.url || null, note: result.note || '', dry: Boolean(result.dry) };
  } finally {
    fs.rmSync(jobFile, { force: true });
    releaseBrowser(owner);
  }
}

module.exports = { publishWithBrowser, BrowserPublishError, caption };
