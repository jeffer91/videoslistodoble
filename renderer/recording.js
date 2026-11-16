'use strict';
(function () {
  let cameraStream, capture, audio, meterFrame, drawing, recorder, take, writes, sequence;
  let writeError, startedAt, accumulated, session = 0, starting = false;

  function flow(action, data) {
    return api('studio:flow', { action, data });
  }

  function release() {
    clearInterval(drawing);
    cancelAnimationFrame(meterFrame);
    if (audio && audio.state !== 'closed') audio.close().catch(() => {});
    audio = null;
    capture?.getVideoTracks().forEach(track => track.stop());
    cameraStream?.getTracks().forEach(track => track.stop());
    capture = cameraStream = null;
    const preview = $('#camera-preview');
    if (preview) preview.srcObject = null;
  }

  function showAudioLevel(stream) {
    if (!window.AudioContext) return;
    audio = new AudioContext();
    const analyser = audio.createAnalyser();
    const source = audio.createMediaStreamSource(stream);
    analyser.fftSize = 1024;
    source.connect(analyser);
    audio.resume().catch(() => {});
    const data = new Float32Array(analyser.fftSize);
    const level = $('#microphone-meter');
    const reading = $('#microphone-reading');
    const read = () => {
      if (!level?.isConnected) return;
      analyser.getFloatTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length);
      const decibels = Math.max(-60, Math.round(20 * Math.log10(Math.max(.001, rms))));
      level.value = decibels + 60;
      reading.textContent = decibels <= -60 ? 'Sin señal' : decibels + ' dBFS';
      meterFrame = requestAnimationFrame(read);
    };
    read();
  }

  async function openCamera() {
    const current = ++session;
    const video = $('#camera-preview');
    if (!video) return;
    const camera = $('#camera-choice')?.value || state.settings.defaultCamera;
    const mic = $('#mic-choice')?.value || state.settings.defaultMic;
    release();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 },
        ...(camera ? { deviceId: { ideal: camera } } : {}) },
      audio: mic ? { deviceId: { ideal: mic } } : true
    });
    if (session !== current || !video.isConnected) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    cameraStream = stream;
    video.srcObject = stream;
    await video.play();
    if (session !== current || !video.isConnected) return;
    showAudioLevel(stream);
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    for (const [id, type, track] of [['camera-choice', 'videoinput', stream.getVideoTracks()[0]],
      ['mic-choice', 'audioinput', stream.getAudioTracks()[0]]]) {
      const select = $('#' + id);
      if (!select) continue;
      select.innerHTML = devices.filter(device => device.kind === type).map((device, index) =>
        '<option value="' + esc(device.deviceId) + '"' + (track?.getSettings().deviceId === device.deviceId ? ' selected' : '') +
        '>' + esc(device.label || (type === 'videoinput' ? 'Cámara ' : 'Micrófono ') + (index + 1)) + '</option>').join('');
    }
    const input = stream.getVideoTracks()[0].getSettings();
    const resolution = $('#record-resolution');
    if (resolution) resolution.textContent = '1080 × 1080 · 30 FPS' +
      (Math.min(input.width || 1080, input.height || 1080) < 1080 ? ' · cámara ' + input.width + ' × ' + input.height : '');
  }

  async function open() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw Error('Cámara o grabador no disponible');
    await close();
    const modal = $('#modal-root');
    modal.hidden = false;
    modal.innerHTML = '<div class="modalback"><div class="modal recorder-modal">' +
      '<div class="row between"><h2>Grabar ' + esc(names[state.scene]) + '</h2>' + btn('modal-close', 'Cerrar', 'secondary') + '</div>' +
      '<div class="two"><label class="field">Cámara<select id="camera-choice"></select></label>' +
      '<label class="field">Micrófono<select id="mic-choice"></select></label></div>' +
      '<div class="row between"><label for="microphone-meter">Nivel del micrófono</label>' +
      '<meter id="microphone-meter" min="0" max="60" low="25" high="55" optimum="48"></meter><small id="microphone-reading">Sin señal</small></div>' +
      '<div class="record-stage format-square" id="record-stage"><video id="camera-preview" autoplay muted playsinline></video>' +
      '<video id="record-review" controls playsinline hidden></video></div>' +
      '<div class="row between recorder-meta"><span id="record-resolution">1080 × 1080 · 30 FPS</span><strong id="record-clock">0:00</strong></div>' +
      '<div class="row wrap recorder-actions" id="record-live-actions">' + btn('record-start', 'Iniciar grabación') +
      btn('record-pause', 'Pausar', 'secondary', 'disabled') + btn('record-stop', 'Detener', 'danger', 'disabled') + '</div>' +
      '<div class="row wrap recorder-actions" id="record-review-actions" hidden>' + btn('record-retry', 'Repetir', 'secondary') +
      btn('record-save', 'Guardar toma') + '</div></div></div>';
    Factory.mountPrompter();
    try {
      await openCamera();
    } catch (error) {
      notice('Cámara o micrófono: ' + error.message, true);
    }
  }

  function encode(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function start() {
    if (recorder || take || starting) return;
    starting = true;
    try {
      await begin();
    } finally {
      starting = false;
    }
  }

  async function begin() {
    if (!cameraStream) await openCamera();
    const camera = $('#camera-preview');
    if (!camera?.videoWidth || !camera.videoHeight || !cameraStream?.getAudioTracks().length) {
      throw Error('La cámara y el micrófono deben estar listos');
    }
    const modalSession = session;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1080;
    const painter = canvas.getContext('2d', { alpha: false });
    if (!painter) throw Error('No se pudo preparar la captura');
    const draft = await flow('take.begin', { projectId: state.project.id, scene: state.scene });
    if (modalSession !== session) {
      await flow('take.discard', { id: draft.id });
      return;
    }
    take = draft;
    sequence = 0;
    writes = Promise.resolve();
    writeError = null;
    accumulated = 0;
    startedAt = Date.now();
    const draw = () => {
      if (camera.readyState < 2) return;
      const side = Math.min(camera.videoWidth, camera.videoHeight);
      painter.drawImage(camera, (camera.videoWidth - side) / 2, (camera.videoHeight - side) / 2, side, side, 0, 0, 1080, 1080);
      const clock = $('#record-clock');
      if (clock) clock.textContent = fmt((accumulated + (startedAt ? Date.now() - startedAt : 0)) / 1000);
    };
    draw();
    capture = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...cameraStream.getAudioTracks()]);
    const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus'].find(type => MediaRecorder.isTypeSupported(type));
    try {
      if (!mimeType) throw Error('No se encontró un codificador compatible');
      recorder = new MediaRecorder(capture, { mimeType, videoBitsPerSecond: 6500000, audioBitsPerSecond: 128000 });
      recorder.addEventListener('dataavailable', ({ data }) => {
        if (!data.size || writeError) return;
        const next = sequence++;
        writes = writes.then(async () => {
          if (!writeError) await flow('take.append', { id: draft.id, sequence: next, data: await encode(data) });
        }).catch(error => {
          writeError = error;
          notice('Se conservó la parte escrita de la toma. ' + error.message, true);
        });
      });
      recorder.start(1000);
    } catch (error) {
      recorder = null;
      take = null;
      release();
      await flow('take.discard', { id: draft.id });
      throw error;
    }
    drawing = setInterval(draw, 1000 / 30);
    Factory.startPrompter();
    $('#camera-choice').disabled = $('#mic-choice').disabled = true;
    $('[data-action="record-start"]').disabled = true;
    $('[data-action="record-stop"]').disabled = $('[data-action="record-pause"]').disabled = false;
    const defaults = { defaultCamera: $('#camera-choice').value, defaultMic: $('#mic-choice').value };
    api('settings:set', defaults).then(value => { state.settings = value; }).catch(() => {});
  }

  function pause() {
    if (!recorder || recorder.state === 'inactive') return;
    const control = $('[data-action="record-pause"]');
    if (recorder.state === 'paused') {
      recorder.resume();
      startedAt = Date.now();
      if (control) control.textContent = 'Pausar';
      Factory.startPrompter();
    } else {
      recorder.pause();
      accumulated += Date.now() - startedAt;
      startedAt = 0;
      if (control) control.textContent = 'Reanudar';
      Factory.stopPrompter();
    }
  }

  async function stop(review = true) {
    const active = recorder;
    if (active?.state && active.state !== 'inactive') {
      const completed = new Promise(resolve => active.addEventListener('stop', resolve, { once: true }));
      active.stop();
      await completed;
    }
    await writes;
    if (recorder === active) recorder = null;
    Factory.stopPrompter();
    release();
    if (!review || !take || !$('#record-review')) return;
    $('#record-live-actions').hidden = true;
    $('#record-review-actions').hidden = false;
    $('#camera-preview').hidden = true;
    const video = $('#record-review');
    video.hidden = false;
    video.src = 'records://take/' + encodeURIComponent(take.id);
    video.load();
    if (!writeError) notice('Toma guardada temporalmente. Revísala y confirma.');
  }

  async function close() {
    session++;
    const modal = $('#modal-root');
    if (!modal) return;
    await stop(false);
    take = null;
    writes = null;
    modal.hidden = true;
    modal.innerHTML = '';
  }

  async function retry() {
    if (take) await flow('take.discard', { id: take.id });
    Factory.resetPrompter();
    take = null;
    $('#record-live-actions').hidden = false;
    $('#record-review-actions').hidden = true;
    $('#camera-preview').hidden = false;
    $('#record-review').hidden = true;
    $('#record-review').removeAttribute('src');
    $('#record-clock').textContent = '0:00';
    $('#camera-choice').disabled = $('#mic-choice').disabled = false;
    $('[data-action="record-start"]').disabled = false;
    $('[data-action="record-pause"]').textContent = 'Pausar';
    $('[data-action="record-stop"]').disabled = $('[data-action="record-pause"]').disabled = true;
    await openCamera();
  }

  async function keep(id = take?.id) {
    if (!id) throw Error('No hay una toma pendiente');
    const saved = await flow('take.recover', { id });
    await close();
    await openProject(saved.projectId, saved.scene, state.orientation);
    notice('Toma conservada con su audio y encuadre cuadrado');
  }

  async function recovery() {
    const drafts = await flow('take.list', { id: state.project.id });
    const modal = $('#modal-root');
    modal.hidden = false;
    modal.innerHTML = '<div class="modalback"><div class="modal"><div class="row between"><h2>Tomas recuperables</h2>' +
      btn('modal-close', 'Cerrar', 'secondary') + '</div>' +
      (drafts.length ? drafts.map(item => '<section class="asset take-recovery"><div><strong>' + esc(names[item.scene]) +
      '</strong><small>' + esc(new Date(item.at).toLocaleString('es-EC')) + '</small></div>' +
      '<video controls preload="none" src="records://take/' + encodeURIComponent(item.id) + '"></video>' +
      btn('record-keep-recovered', 'Usar toma', 'secondary', 'data-id="' + esc(item.id) + '"') + '</section>').join('') :
      '<p class="muted">El proyecto está al día.</p>') + '</div></div>';
  }

  window.Recording = { open, openCamera, start, pause, stop, close, retry, keep, recovery, busy: () => Boolean(recorder) };
})();
