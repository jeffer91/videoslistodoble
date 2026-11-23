'use strict';
/* Interfaz de «Shorts web»: guion → grabación → procesamiento → Short listo. */
(() => {
  const C = ShortsCore;
  const S = ShortsStore;
  const root = document.getElementById('app');
  const BASE = new URL('./', location.href).href;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PREFS_KEY = 'shorts-11-prefs';

  const state = { screen: 'home', project: null, scene: 'hook', camera: null, busy: false };
  let prefs = { speed: 45, size: 34, facing: 'user', mic: '' };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch {}
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

  const urls = new Set();
  function objectUrl(blob) { const url = URL.createObjectURL(blob); urls.add(url); return url; }
  function releaseUrls() { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }

  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch {}
  }

  function toast(message, error = false) {
    const box = document.createElement('div');
    box.className = 'toast' + (error ? ' error' : '');
    box.setAttribute('role', error ? 'alert' : 'status');
    box.textContent = message;
    document.body.append(box);
    setTimeout(() => box.remove(), error ? 6000 : 3200);
  }

  const recorded = project => C.SCENES.filter(key => project.takes?.[key]?.blob);
  const complete = project => recorded(project).length === C.SCENES.length;

  async function go(screen, project = state.project) {
    if (state.screen === 'record' && screen !== 'record') stopCamera();
    releaseUrls();
    state.screen = screen;
    state.project = project;
    window.scrollTo(0, 0);
    if (screen === 'home') return renderHome();
    if (screen === 'script') return renderScript();
    if (screen === 'record') return renderRecord();
    if (screen === 'process') return renderProcess();
    if (screen === 'done') return renderDone();
  }

  /* ---------- Inicio ---------- */

  async function renderHome() {
    const projects = await S.list();
    const card = p => {
      const count = recorded(p).length;
      const status = p.output ? '<span class="chip ok">Listo</span>' : count ? '<span class="chip">Grabado ' + count + '/3</span>' : '<span class="chip muted">Guion</span>';
      return '<li class="card"><button class="card-main" data-open="' + esc(p.id) + '"><strong>' + esc(p.title || 'Sin título') + '</strong>' +
        '<small>' + new Date(p.updatedAt).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) + '</small>' + status + '</button>' +
        '<button class="icon danger" data-delete="' + esc(p.id) + '" aria-label="Borrar ' + esc(p.title || 'Short') + '">🗑</button></li>';
    };
    root.innerHTML = '<main class="page">' + header() +
      '<section class="hero"><h1>Graba tu Short y descárgalo listo</h1><p>Graba el gancho, el desarrollo y el cierre. La app corta los silencios, limpia la voz y monta el video vertical con el estilo de 11 Récords.</p>' +
      '<button class="primary big" data-new>＋ Nuevo Short</button></section>' +
      (projects.length ? '<h2>Tus Shorts</h2><ul class="cards">' + projects.map(card).join('') + '</ul>' : '') +
      '<p class="note">Todo se guarda en este navegador. Los videos no se suben a ningún servidor.</p></main>';
    root.querySelector('[data-new]').onclick = () => go('script', S.create());
    root.querySelectorAll('[data-open]').forEach(b => b.onclick = async () => {
      const p = await S.get(b.dataset.open);
      go(p.output ? 'done' : complete(p) ? 'process' : recorded(p).length ? 'record' : 'script', p);
    });
    root.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => {
      if (!confirm('¿Borrar este Short y sus tomas?')) return;
      await S.remove(b.dataset.delete);
      renderHome();
    });
  }

  function header(back) {
    return '<header class="top">' + (back ? '<button class="icon" data-back aria-label="Volver">←</button>' : '') +
      '<span class="brand" aria-hidden="true">11</span><div><strong>11 Récords</strong><small>Shorts</small></div></header>';
  }
  function bindBack(target) { const b = root.querySelector('[data-back]'); if (b) b.onclick = target; }

  /* ---------- Guion ---------- */

  function renderScript() {
    const p = state.project;
    root.innerHTML = '<main class="page">' + header(true) +
      '<h1>Guion</h1><form id="script" class="stack">' +
      '<label>Título del récord<input name="title" required maxlength="90" autocomplete="off" value="' + esc(p.title) + '" placeholder="El gol más rápido de la Champions"></label>' +
      '<details' + (p.script.hook || p.script.body ? '' : ' open') + '><summary>Pegar el guion completo</summary>' +
      '<textarea name="paste" rows="6" placeholder="GANCHO: …&#10;DESARROLLO: …&#10;CIERRE: …"></textarea>' +
      '<button type="button" class="secondary" data-split>Repartir en escenas</button></details>' +
      C.SCENES.map(key => '<label>' + C.SCENE_LABELS[key] + ' <small>(teleprompter)</small><textarea name="' + key + '" rows="' + (key === 'body' ? 6 : 3) + '">' + esc(p.script[key]) + '</textarea></label>').join('') +
      '<fieldset><legend>Al procesar</legend>' +
      check('cutSilences', 'Cortar silencios y pausas largas', p.options.cutSilences) +
      check('stamp', 'Sello «Récord confirmado» al final', p.options.stamp) +
      check('logo', 'Logo de 11 Récords', p.options.logo) + '</fieldset>' +
      '<button class="primary big" type="submit">Grabar →</button></form></main>';
    bindBack(() => go('home'));
    const form = root.querySelector('#script');
    root.querySelector('[data-split]').onclick = () => {
      const parsed = C.parseScript(form.paste.value);
      for (const key of C.SCENES) if (parsed[key]) form[key].value = parsed[key];
      toast('Guion repartido en gancho, desarrollo y cierre');
    };
    form.onsubmit = async e => {
      e.preventDefault();
      p.title = form.title.value.trim();
      for (const key of C.SCENES) p.script[key] = form[key].value.trim();
      for (const key of ['cutSilences', 'stamp', 'logo']) p.options[key] = form[key].checked;
      await S.save(p);
      S.persist();
      state.scene = C.SCENES.find(key => !p.takes[key]?.blob) || 'hook';
      go('record', p);
    };
  }
  const check = (name, label, on) => '<label class="check"><input type="checkbox" name="' + name + '"' + (on !== false ? ' checked' : '') + '> ' + label + '</label>';

  /* ---------- Grabación ---------- */

  let recorder = null, chunks = [], startedAt = 0, timer = null, scrollFrame = null, prompterY = 0, prompterPaused = false;
  let meterContext = null, meterFrame = null;

  function stopCamera() {
    cancelAnimationFrame(scrollFrame); cancelAnimationFrame(meterFrame); clearInterval(timer);
    if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop(); }
    recorder = null;
    state.camera?.getTracks().forEach(t => t.stop());
    state.camera = null;
    meterContext?.close().catch(() => {}); meterContext = null;
    keepAwake(false);
  }

  function renderRecord() {
    const p = state.project;
    root.innerHTML = '<main class="recorder">' +
      '<div class="rec-top"><button class="icon" data-back aria-label="Volver al guion">←</button><nav class="tabs" aria-label="Escenas">' +
      C.SCENES.map(key => '<button data-scene="' + key + '">' + C.SCENE_LABELS[key] + '</button>').join('') + '</nav></div>' +
      '<div class="stage"><video id="cam" playsinline muted autoplay></video>' +
      '<div class="guide" aria-hidden="true"><span class="eyes"></span></div>' +
      '<div class="prompter" data-prompter><div class="prompter-text"></div></div>' +
      '<div class="countdown" hidden></div><div class="rec-badge" hidden>● <span>0:00</span></div>' +
      '<div class="review" hidden><video playsinline controls></video><div class="row"><button class="secondary" data-retake>Repetir</button><button class="primary" data-keep>Usar toma ✓</button></div></div>' +
      '<div class="cam-error" hidden></div></div>' +
      '<div class="rec-controls"><button class="icon" data-settings aria-label="Ajustes">⚙</button>' +
      '<button class="shutter" data-shutter aria-label="Grabar"><span></span></button>' +
      '<button class="icon" data-flip aria-label="Cambiar cámara">⟲</button></div>' +
      '<meter class="level" min="0" max="1" value="0" aria-label="Nivel del micrófono"></meter>' +
      '<div class="sheet" hidden><label>Micrófono<select data-mic><option value="">Predeterminado</option></select></label>' +
      '<label>Velocidad del teleprompter<input type="range" min="15" max="120" step="5" data-speed value="' + prefs.speed + '"></label>' +
      '<label>Tamaño del texto<input type="range" min="22" max="54" step="2" data-size value="' + prefs.size + '"></label>' +
      '<button class="secondary" data-close-sheet>Cerrar</button></div>' +
      '<div class="rec-footer"><button class="primary" data-process hidden>Procesar Short →</button></div></main>';
    bindBack(() => go('script'));
    const q = s => root.querySelector(s);
    q('[data-shutter]').onclick = () => recorder?.state === 'recording' ? stopRecording() : startCountdown();
    q('[data-flip]').onclick = () => { prefs.facing = prefs.facing === 'user' ? 'environment' : 'user'; savePrefs(); startCamera(); };
    q('[data-settings]').onclick = () => { q('.sheet').hidden = false; };
    q('[data-close-sheet]').onclick = () => { q('.sheet').hidden = true; };
    q('[data-mic]').onchange = e => { prefs.mic = e.target.value; savePrefs(); startCamera(); };
    q('[data-speed]').oninput = e => { prefs.speed = Number(e.target.value); savePrefs(); };
    q('[data-size]').oninput = e => { prefs.size = Number(e.target.value); savePrefs(); applyPrompterSize(); };
    q('[data-prompter]').onclick = () => { prompterPaused = !prompterPaused; };
    q('[data-retake]').onclick = () => { q('.review').hidden = true; q('.review video').removeAttribute('src'); };
    q('[data-keep]').onclick = keepTake;
    q('[data-process]').onclick = () => go('process');
    root.querySelectorAll('[data-scene]').forEach(b => b.onclick = () => { if (recorder?.state !== 'recording') selectScene(b.dataset.scene); });
    selectScene(state.scene);
    startCamera();
    keepAwake(true);
  }

  function applyPrompterSize() {
    const text = root.querySelector('.prompter-text');
    if (text) text.style.fontSize = prefs.size + 'px';
  }

  function selectScene(key) {
    state.scene = key;
    const p = state.project;
    root.querySelectorAll('[data-scene]').forEach(b => {
      b.classList.toggle('active', b.dataset.scene === key);
      b.classList.toggle('done', Boolean(p.takes[b.dataset.scene]?.blob));
      b.textContent = C.SCENE_LABELS[b.dataset.scene] + (p.takes[b.dataset.scene]?.blob ? ' ✓' : '');
    });
    const text = root.querySelector('.prompter-text');
    text.textContent = p.script[key] || 'Sin texto para ' + C.SCENE_LABELS[key].toLowerCase() + '. Puedes grabar igualmente.';
    applyPrompterSize();
    resetPrompter();
    root.querySelector('[data-process]').hidden = !complete(p);
  }

  function resetPrompter() {
    prompterY = 0; prompterPaused = false;
    const text = root.querySelector('.prompter-text');
    if (text) text.style.transform = 'translateY(0px)';
  }

  function scrollPrompter() {
    let last = performance.now();
    const text = root.querySelector('.prompter-text');
    const box = root.querySelector('.prompter');
    const step = now => {
      const dt = (now - last) / 1000; last = now;
      if (!prompterPaused && text && box) {
        const max = Math.max(0, text.scrollHeight - box.clientHeight * 0.4);
        prompterY = Math.min(max, prompterY + prefs.speed * dt);
        text.style.transform = 'translateY(' + (-prompterY).toFixed(1) + 'px)';
      }
      scrollFrame = requestAnimationFrame(step);
    };
    scrollFrame = requestAnimationFrame(step);
  }

  async function startCamera() {
    const error = root.querySelector('.cam-error');
    state.camera?.getTracks().forEach(t => t.stop());
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      error.hidden = false;
      error.textContent = 'Este navegador no permite grabar. Abre la página en Chrome (Android) o Safari (iPhone).';
      return;
    }
    try {
      state.camera = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: prefs.facing, width: { ideal: 1080 }, height: { ideal: 1920 }, frameRate: { ideal: 30 } },
        audio: { ...(prefs.mic ? { deviceId: { exact: prefs.mic } } : {}), echoCancellation: false, noiseSuppression: true, autoGainControl: false }
      });
    } catch (e) {
      error.hidden = false;
      error.textContent = e.name === 'NotAllowedError'
        ? 'Permite el acceso a la cámara y al micrófono en los ajustes del navegador y vuelve a abrir esta pantalla.'
        : 'No se pudo abrir la cámara: ' + (e.message || e.name);
      return;
    }
    error.hidden = true;
    const cam = root.querySelector('#cam');
    cam.srcObject = state.camera;
    cam.classList.toggle('mirror', prefs.facing === 'user');
    cam.play().catch(() => {});
    listMics();
    startMeter();
  }

  async function listMics() {
    try {
      const select = root.querySelector('[data-mic]');
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
      select.innerHTML = '<option value="">Predeterminado</option>' + devices.map((d, i) =>
        '<option value="' + esc(d.deviceId) + '"' + (d.deviceId === prefs.mic ? ' selected' : '') + '>' + esc(d.label || 'Micrófono ' + (i + 1)) + '</option>').join('');
    } catch {}
  }

  function startMeter() {
    cancelAnimationFrame(meterFrame);
    meterContext?.close().catch(() => {});
    try {
      meterContext = new AudioContext();
      const analyser = meterContext.createAnalyser();
      analyser.fftSize = 1024;
      meterContext.createMediaStreamSource(state.camera).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const meter = root.querySelector('.level');
      const step = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0; for (const v of data) sum += v * v;
        const db = C.gainToDb(Math.sqrt(sum / data.length));
        if (meter) meter.value = C.clamp((db + 60) / 60, 0, 1);
        meterFrame = requestAnimationFrame(step);
      };
      step();
    } catch {}
  }

  function startCountdown() {
    if (!state.camera) return toast('La cámara no está lista', true);
    const box = root.querySelector('.countdown');
    const shutter = root.querySelector('[data-shutter]');
    shutter.disabled = true;
    meterContext?.resume?.();
    let n = 3;
    box.hidden = false; box.textContent = n;
    const id = setInterval(() => {
      n--;
      if (n > 0) { box.textContent = n; return; }
      clearInterval(id); box.hidden = true; shutter.disabled = false;
      startRecording();
    }, 800);
  }

  function captureType() {
    const types = ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }

  function startRecording() {
    chunks = [];
    const mimeType = captureType();
    try {
      recorder = new MediaRecorder(state.camera, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 6500000, audioBitsPerSecond: 128000 });
    } catch (e) { return toast('No se pudo empezar a grabar: ' + e.message, true); }
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => showReview();
    recorder.start(1000);
    startedAt = Date.now();
    root.querySelector('.recorder').classList.add('recording');
    const badge = root.querySelector('.rec-badge');
    badge.hidden = false;
    timer = setInterval(() => { badge.querySelector('span').textContent = C.formatTime((Date.now() - startedAt) / 1000); }, 250);
    resetPrompter();
    scrollPrompter();
  }

  function stopRecording() {
    clearInterval(timer);
    cancelAnimationFrame(scrollFrame);
    root.querySelector('.recorder').classList.remove('recording');
    root.querySelector('.rec-badge').hidden = true;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  let pendingTake = null;
  function showReview() {
    const type = (recorder?.mimeType || captureType() || 'video/webm').split(';')[0];
    const seconds = (Date.now() - startedAt) / 1000;
    const blob = new Blob(chunks, { type });
    if (blob.size < 1000 || seconds < 0.8) { toast('La toma es demasiado corta', true); return; }
    pendingTake = { blob, type, seconds };
    const review = root.querySelector('.review');
    const video = review.querySelector('video');
    video.src = objectUrl(blob);
    review.hidden = false;
    video.play().catch(() => {});
  }

  async function keepTake() {
    if (!pendingTake) return;
    const p = state.project;
    const key = state.scene;
    const old = p.takes[key]?.blob;
    const blobKey = p.id + ':' + key + ':' + Date.now();
    try {
      await S.putBlob(blobKey, pendingTake.blob);
    } catch {
      return toast('No hay espacio para guardar la toma en el navegador.', true);
    }
    p.takes[key] = { blob: blobKey, type: pendingTake.type, seconds: pendingTake.seconds, size: pendingTake.blob.size, at: new Date().toISOString() };
    if (p.output) { await S.deleteBlob(p.output.blob).catch(() => {}); p.output = null; }
    await S.save(p);
    if (old) S.deleteBlob(old).catch(() => {});
    pendingTake = null;
    root.querySelector('.review').hidden = true;
    const next = C.SCENES.find(k => !p.takes[k]?.blob);
    if (next) { selectScene(next); toast(C.SCENE_LABELS[key] + ' guardado. Sigue con ' + C.SCENE_LABELS[next].toLowerCase()); }
    else go('process');
  }

  /* ---------- Procesamiento ---------- */

  const STEPS = [['analyze', 'Detectar voz y silencios'], ['audio', 'Limpiar la voz y ajustar el volumen'], ['video', 'Montar y exportar el video']];
  let controller = null;

  async function renderProcess() {
    const p = state.project;
    root.innerHTML = '<main class="page">' + header(true) + '<h1>Procesando tu Short</h1><p class="lead">' + esc(p.title || 'Sin título') + '</p>' +
      '<ol class="steps">' + STEPS.map(([id, label]) => '<li data-step="' + id + '"><span class="dot"></span>' + label + '</li>').join('') + '</ol>' +
      '<progress max="1" value="0"></progress><p class="status" role="status">Preparando…</p>' +
      '<canvas class="live" width="270" height="480" aria-label="Vista previa del montaje"></canvas>' +
      '<p class="note">Mantén esta pantalla abierta hasta que termine.</p><button class="secondary" data-cancel>Cancelar</button></main>';
    bindBack(() => { controller?.abort(); go('record'); });
    root.querySelector('[data-cancel]').onclick = () => { controller?.abort(); go('record'); };
    const live = root.querySelector('.live').getContext('2d');
    const bar = root.querySelector('progress');
    const status = root.querySelector('.status');
    const order = STEPS.map(s => s[0]);
    controller = new AbortController();
    const signal = controller.signal;
    keepAwake(true);
    try {
      const blobs = {};
      for (const key of C.SCENES) {
        blobs[key] = await S.getBlob(p.takes[key]?.blob);
        if (!blobs[key]) throw Error('Falta la toma de ' + C.SCENE_LABELS[key] + '. Vuelve a grabarla.');
      }
      const result = await ShortsExport.render({
        project: p, blobs, base: BASE, signal,
        preview: surface => live.drawImage(surface, 0, 0, 270, 480),
        onProgress: ({ step, progress, message }) => {
          if (signal.aborted) return;
          const index = order.indexOf(step);
          root.querySelectorAll('[data-step]').forEach((li, i) => {
            li.classList.toggle('done', step === 'done' || i < index);
            li.classList.toggle('active', i === index);
          });
          bar.value = step === 'done' ? 1 : (Math.max(0, index) + C.clamp(progress, 0, 1)) / order.length;
          status.textContent = message;
        }
      });
      const key = p.id + ':output:' + Date.now();
      await S.putBlob(key, result.blob);
      if (p.output?.blob) S.deleteBlob(p.output.blob).catch(() => {});
      p.output = {
        blob: key, type: result.mimeType, extension: result.extension, method: result.method, size: result.blob.size,
        duration: result.stats.finalSeconds, removed: result.stats.removedSeconds, lufs: result.stats.lufs, at: new Date().toISOString()
      };
      await S.save(p);
      keepAwake(false);
      if (!signal.aborted) go('done', p);
    } catch (e) {
      keepAwake(false);
      if (e.name === 'AbortError' || signal.aborted) return;
      console.error(e);
      status.textContent = 'No se pudo terminar: ' + (e.message || e);
      status.classList.add('error');
      const retry = document.createElement('button');
      retry.className = 'primary'; retry.textContent = 'Reintentar';
      retry.onclick = () => go('process');
      root.querySelector('[data-cancel]').replaceWith(retry);
    }
  }

  /* ---------- Resultado ---------- */

  async function renderDone() {
    const p = state.project;
    const blob = await S.getBlob(p.output?.blob);
    if (!blob) return go(complete(p) ? 'process' : 'record', p);
    const name = C.fileName(p.title, p.output.extension || 'mp4');
    const file = new File([blob], name, { type: p.output.type || blob.type });
    const canShare = Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
    const url = objectUrl(blob);
    root.innerHTML = '<main class="page">' + header(true) + '<h1>¡Short listo!</h1><p class="lead">' + esc(p.title) + '</p>' +
      '<video class="result" controls playsinline src="' + url + '"></video>' +
      '<dl class="facts"><div><dt>Duración</dt><dd>' + C.formatTime(p.output.duration) + '</dd></div>' +
      '<div><dt>Silencios quitados</dt><dd>' + (p.output.removed || 0).toFixed(1) + ' s</dd></div>' +
      '<div><dt>Volumen</dt><dd>' + (Number.isFinite(p.output.lufs) ? p.output.lufs.toFixed(1) + ' LUFS' : '—') + '</dd></div>' +
      '<div><dt>Archivo</dt><dd>' + esc((p.output.extension || 'mp4').toUpperCase()) + ' · ' + (p.output.size / 1048576).toFixed(1) + ' MB</dd></div></dl>' +
      (p.output.extension !== 'mp4' ? '<p class="note warn">Este navegador solo pudo crear un WebM. YouTube lo acepta; para TikTok o Instagram usa Chrome o Safari actualizados.</p>' : '') +
      '<div class="stack">' + (canShare ? '<button class="primary big" data-share>Compartir en TikTok, Instagram o YouTube</button>' : '') +
      '<a class="button ' + (canShare ? 'secondary' : 'primary big') + '" download="' + esc(name) + '" href="' + url + '">Descargar video</a>' +
      '<button class="secondary" data-redo>Volver a grabar una escena</button>' +
      '<button class="secondary" data-reprocess>Procesar de nuevo</button>' +
      '<button class="secondary" data-new>＋ Nuevo Short</button></div></main>';
    bindBack(() => go('home'));
    const share = root.querySelector('[data-share]');
    if (share) share.onclick = async () => {
      try { await navigator.share({ files: [file], title: p.title }); }
      catch (e) { if (e.name !== 'AbortError') toast('No se pudo compartir: ' + e.message, true); }
    };
    root.querySelector('[data-redo]').onclick = () => go('record');
    root.querySelector('[data-reprocess]').onclick = () => go('process');
    root.querySelector('[data-new]').onclick = () => go('script', S.create());
  }

  /* ---------- Arranque ---------- */

  window.addEventListener('pagehide', () => stopCamera());
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  window.ShortsApp = { go, state };
  go('home');
})();
