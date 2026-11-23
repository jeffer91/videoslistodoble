'use strict';
/*
 * Prueba de extremo a extremo de «Shorts web» en Chrome/Chromium con cámara y micrófono simulados:
 * guion → tres tomas → procesamiento → MP4 1080×1920 verificado con ffprobe.
 * Uso: npm run test:shorts   (CHROME_PATH permite elegir el navegador)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('ffprobe-static').path;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-e2e-'));
const site = path.join(work, 'site');
const shots = process.env.SHORTS_SCREENSHOTS || work;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw Error(cmd + ' falló: ' + r.stderr);
  return r.stdout;
}

function makeMedia() {
  const video = path.join(work, 'camara.y4m');
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30', '-t', '6', '-pix_fmt', 'yuv420p', video]);
  // Voz simulada: tonos (frases) separados por silencios largos y cortos.
  if (process.env.SHORTS_VOICE_WAV) return { video, audio: path.resolve(process.env.SHORTS_VOICE_WAV) };
  const audio = path.join(work, 'voz.wav');
  const expr = "if(between(t,0.9,2.4)+between(t,3.6,4.6)+between(t,4.8,5.6),0.25*sin(2*PI*220*t)*(1+0.3*sin(2*PI*3*t)),0.0008*(random(0)-0.5))";
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc=exprs='" + expr + "':s=48000:d=7", '-ac', '1', audio]);
  return { video, audio };
}

// Modelo Whisper local opcional (carpeta con <organización>/<modelo>/...), servido en /models/.
const modelDir = process.env.SHORTS_WHISPER_MODEL_DIR ? path.resolve(process.env.SHORTS_WHISPER_MODEL_DIR) : null;
const modelId = process.env.SHORTS_WHISPER_MODEL || 'Xenova/whisper-tiny';
const takeMs = Number(process.env.SHORTS_TAKE_MS || 6500);

function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
    '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.wasm': 'application/wasm' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const fromModels = modelDir && url.pathname.startsWith('/models/');
    const base = fromModels ? modelDir : dir;
    let file = path.join(base, decodeURIComponent(fromModels ? url.pathname.slice('/models'.length) : url.pathname));
    if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function probe(file) {
  return JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
}

async function savedOutput(page, which = 'output') {
  const base64 = await page.evaluate(async which => {
    const p = window.ShortsApp.state.project;
    const blob = await ShortsStore.getBlob(which === 'output' ? p.output.blob : which);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(s);
  }, which);
  return Buffer.from(base64, 'base64');
}

(async () => {
  run(process.execPath, [path.join(root, 'scripts', 'build-pages.cjs'), site]);
  const media = makeMedia();
  const server = await serve(site);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const executablePath = process.env.CHROME_PATH || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
  const browser = await chromium.launch({
    executablePath, headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
      '--use-file-for-fake-video-capture=' + media.video, '--use-file-for-fake-audio-capture=' + media.audio]
  });
  const context = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') console.log('[aviso]', m.text()); });
  try {
    if (modelDir) {
      await page.goto(origin + '/shorts/');
      await page.evaluate(cfg => localStorage.setItem('shorts-11-whisper', JSON.stringify(cfg)),
        { model: modelId, remoteHost: origin + '/models/', remotePathTemplate: '{model}/', device: 'wasm', wasmDtype: 'q8' });
    }
    await page.goto(origin + '/');
    await page.getByRole('link', { name: /Crear un Short/ }).click();
    await page.getByRole('button', { name: /Nuevo Short/ }).click();
    await page.getByLabel('Título del récord').fill('Kane y sus 44 goles en una temporada');
    await page.locator('textarea[name="paste"]').fill('GANCHO: Harry Kane marcó cuarenta y cuatro goles en una sola temporada.\nDESARROLLO: Fue su primera temporada en el Bayern.\nY rompió el récord de Lewandowski.\nCIERRE: Síguenos para más récords.');
    await page.getByRole('button', { name: 'Repartir en escenas' }).click();
    assert.equal(await page.locator('textarea[name="closing"]').inputValue(), 'Síguenos para más récords.');
    if (!modelDir) await page.getByLabel('Subtítulos automáticos (Whisper)').uncheck();
    await page.screenshot({ path: path.join(shots, '1-guion.png') });
    await page.getByRole('button', { name: /Grabar/ }).click();

    await page.waitForFunction(() => document.querySelector('#cam')?.videoWidth > 0, null, { timeout: 15000 });
    for (const scene of ['Gancho', 'Desarrollo', 'Cierre']) {
      await page.locator('[data-shutter]').click();
      await page.waitForSelector('.rec-badge:not([hidden])', { timeout: 6000 });
      await page.waitForTimeout(takeMs);
      if (scene === 'Gancho') await page.screenshot({ path: path.join(shots, '2-grabando.png') });
      await page.locator('[data-shutter]').click();
      await page.waitForSelector('.review:not([hidden])', { timeout: 8000 });
      await page.getByRole('button', { name: /Usar toma/ }).click();
      if (scene !== 'Cierre') await page.waitForSelector('.review', { state: 'hidden' });
    }

    await page.waitForSelector('text=Procesando tu Short', { timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shots, '3-procesando.png') });
    await page.waitForSelector('text=¡Short listo!', { timeout: 240000 });
    await page.screenshot({ path: path.join(shots, '4-listo.png'), fullPage: true });

    const info = await page.evaluate(() => window.ShortsApp.state.project.output);
    const fast = await page.evaluate(() => ShortsExport.fastPathAvailable());
    const file = path.join(work, 'short.' + info.extension);
    fs.writeFileSync(file, await savedOutput(page));
    const meta = probe(file);
    const v = meta.streams.find(s => s.codec_type === 'video');
    const a = meta.streams.find(s => s.codec_type === 'audio');
    const duration = Number(meta.format.duration);
    console.log(JSON.stringify({ method: info.method, fast, size: info.size, duration, removed: info.removed, lufs: info.lufs, video: v && [v.codec_name, v.width, v.height, v.r_frame_rate], audio: a && [a.codec_name, a.sample_rate, a.channels] }));
    assert.ok(v && a, 'el video tiene imagen y sonido');
    assert.equal(v.width, 1080); assert.equal(v.height, 1920);
    if (fast) {
      assert.equal(info.method, 'webcodecs');
      assert.equal(v.codec_name, 'h264'); assert.equal(a.codec_name, 'aac');
      assert.ok(Math.abs(duration - info.duration) < 0.2, 'duración ' + duration + ' vs ' + info.duration);
    }
    // Cada toma dura ~6,5 s; con los silencios cortados cada escena queda en ~4,9 s.
    assert.ok(info.removed > 3, 'se quitaron silencios: ' + info.removed);
    assert.ok(Math.abs(info.lufs - (-14)) < 1.5, 'volumen ' + info.lufs);
    const captions = await page.evaluate(() => window.ShortsApp.state.project.captions);
    if (modelDir) {
      console.log('Subtítulos (' + captions.mode + ', ' + captions.device + '):', captions.words.map(w => w.text).join(' '));
      assert.ok(info.captions > 5, 'hay subtítulos: ' + info.captions);
      assert.ok(captions.words.every((w, i, all) => w.start <= w.end && (i === 0 || all[i - 1].start <= w.start + 1e-6)), 'tiempos ordenados');
      assert.ok(captions.words.every(w => w.end <= info.duration + 0.01), 'dentro del video');
    } else {
      assert.equal(info.captions, 0);
    }
    const loud = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const measured = Number((/I:\s+(-?[\d.]+) LUFS/.exec(loud.split('Summary:').pop()) || [])[1]);
    console.log('LUFS medido con ffmpeg:', measured);
    assert.ok(Math.abs(measured - (-14)) < 2, 'LUFS del archivo ' + measured);
    const firstWord = captions?.words?.[2];
    for (const [name, at] of [['fotograma-gancho', firstWord ? firstWord.start + 0.05 : 1], ['fotograma-cierre', info.duration - 2.2], ['fotograma-sello', info.duration - 0.3]]) {
      run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, at)), '-i', file, '-frames:v', '1', '-vf', 'scale=360:-1', path.join(shots, name + '.png')]);
    }
    fs.copyFileSync(file, path.join(shots, 'short-final.' + info.extension));

    if (modelDir) {
      await page.getByRole('button', { name: 'Corregir subtítulos' }).click();
      const first = page.locator('#captions input').first();
      await first.fill('¡GOLAZO DE KANE!');
      await page.screenshot({ path: path.join(shots, '5-corregir.png') });
      const started = Date.now();
      await page.getByRole('button', { name: 'Guardar y volver a exportar' }).click();
      await page.waitForSelector('text=¡Short listo!', { timeout: 240000 });
      const edited = await page.evaluate(() => window.ShortsApp.state.project.captions);
      assert.equal(edited.edited, true);
      assert.deepEqual(edited.words.slice(0, 3).map(w => w.text), ['¡GOLAZO', 'DE', 'KANE!']);
      console.log('Reexportado con subtítulos corregidos en ' + Math.round((Date.now() - started) / 1000) + ' s (sin volver a transcribir)');
      const editedFile = path.join(work, 'corregido.mp4');
      fs.writeFileSync(editedFile, await savedOutput(page));
      run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(edited.words[1].start + 0.05), '-i', editedFile, '-frames:v', '1', '-vf', 'scale=360:-1', path.join(shots, 'fotograma-corregido.png')]);
    }

    // Respaldo en tiempo real (navegadores sin WebCodecs).
    const realtime = await page.evaluate(async () => {
      const p = window.ShortsApp.state.project;
      const blobs = {};
      for (const key of ShortsCore.SCENES) blobs[key] = await ShortsStore.getBlob(p.takes[key].blob);
      const r = await ShortsExport.render({ project: p, blobs, base: new URL('./', location.href).href, forceRealtime: true });
      const key = 'prueba-tiempo-real';
      await ShortsStore.putBlob(key, r.blob);
      return { method: r.method, extension: r.extension, size: r.blob.size, key };
    });
    const rtFile = path.join(work, 'tiempo-real.' + realtime.extension);
    fs.writeFileSync(rtFile, await savedOutput(page, realtime.key));
    const rt = probe(rtFile);
    const rv = rt.streams.find(s => s.codec_type === 'video');
    console.log(JSON.stringify({ realtime: realtime.method, extension: realtime.extension, video: rv && [rv.codec_name, rv.width, rv.height], audio: Boolean(rt.streams.find(s => s.codec_type === 'audio')) }));
    assert.equal(realtime.method, 'realtime');
    assert.equal(rv.width, 1080); assert.equal(rv.height, 1920);

    const relevant = errors.filter(e => !/favicon|serviceWorker|onnxruntime|VerifyEachNodeIsAssignedToAnEp|session_state/i.test(e));
    assert.deepEqual(relevant, [], 'sin errores en la consola');
    console.log('Shorts web: prueba completa superada. Archivos en ' + shots);
  } catch (error) {
    await page.screenshot({ path: path.join(shots, 'fallo.png'), fullPage: true }).catch(() => {});
    console.error('Errores de consola:', errors);
    throw error;
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
