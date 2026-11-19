'use strict';
(() => {
  const remote = window.RecordsRemote;
  const { BLOCK, WINDOW, MAX_FILE, send, meter } = remote;
  let link, channel, loadingLink, personalUrl, dialog, destination, mediaStream, audioMeter;
  let phone = {}, connectionLabel = 'Preparando enlace…', transfer, level = -60;
  let controlPending, commandTimer, recordingMessage = '', testRecorder, testUrl, testTimer, microphoneMessage = '';

  const field = id => dialog?.querySelector('#mobile-' + id);
  const flow = (action, data) => api('mobile:record', { action, data });
  const copyText = (id, value) => { if (field(id)) field(id).textContent = value; };

  function options(kind) {
    const select = field(kind);
    const available = Array.isArray(phone.devices?.[kind]) ? phone.devices[kind].slice(0, 30) : [];
    const signature = JSON.stringify([available, phone.selected?.[kind]]);
    if (select.dataset.devices === signature) return;
    select.dataset.devices = signature;
    select.replaceChildren(new Option('Predeterminado del celular', ''),
      ...available.filter(item => typeof item?.id === 'string' && typeof item?.label === 'string').map(item =>
        new Option(item.label.slice(0, 120), item.id, false, item.id === phone.selected?.[kind])));
  }

  function drawMeter(db) {
    level = db;
    if (!dialog) return;
    field('level').value = db + 60;
    copyText('reading', db <= -60 ? 'Sin señal' : db + ' dBFS');
  }

  function renderDialog() {
    if (!dialog) return;
    const connected = channel?.readyState === 'open';
    const ready = connected && phone.ready;
    const idle = phone.mode === 'idle';
    const recording = phone.mode === 'recording' || phone.mode === 'paused';
    copyText('connection', connected ? (ready ? 'Celular conectado · cámara y micrófono listos'
      : 'Celular conectado · activa la cámara y el micrófono en el enlace') : connectionLabel);
    copyText('destination', destination ? destination.title + ' · ' + names[destination.scene] : '');
    copyText('current', !idle && phone.title ? 'Toma en ' + phone.title + ' · ' + (names[phone.scene] || '') : '');
    copyText('status', recordingMessage || ({
      recording: 'Grabando en el celular…',
      paused: 'Grabación en pausa.',
      stopping: 'Cerrando la toma…',
      pending: 'Toma guardada en el celular y lista para transferir.',
      uploading: 'Recibiendo toma…'
    }[phone.mode] || ''));
    copyText('mic-name', ready ? phone.mic || 'Micrófono del celular' : 'Micrófono del celular');
    copyText('test-status', microphoneMessage);
    drawMeter(level);
    field('link').value = personalUrl || '';
    field('copy').disabled = !personalUrl;
    field('start').disabled = !ready || !idle || Boolean(controlPending || destination == null);
    field('pause').disabled = !connected || !recording || Boolean(controlPending);
    field('pause').textContent = phone.mode === 'paused' ? 'Reanudar' : 'Pausar';
    field('stop').disabled = !connected || !recording || Boolean(controlPending);
    field('transfer').disabled = !connected || phone.mode !== 'pending';
    field('mic-toggle').disabled = !ready || ['uploading', 'stopping'].includes(phone.mode);
    field('mic-toggle').textContent = phone.micEnabled === false ? 'Activar micrófono' : 'Silenciar micrófono';
    field('listen').disabled = !ready;
    field('test').disabled = !ready || phone.micEnabled === false || Boolean(testRecorder);
    field('video').disabled = field('audio').disabled = !idle || !ready || Boolean(controlPending);
    options('video');
    options('audio');
    field('progress').hidden = !transfer;
    field('progress').value = transfer ? Math.floor(100 * transfer.offset / transfer.size) : 0;
    const preview = field('preview');
    if (preview.srcObject !== mediaStream) preview.srcObject = mediaStream || null;
  }

  function clearCommand() {
    controlPending = null;
    clearTimeout(commandTimer);
  }

  function showError(error) {
    recordingMessage = String(error?.message || error).slice(0, 400);
    clearCommand();
    renderDialog();
  }

  function command(type, data = {}, expected) {
    if (!send(channel, { type, ...data })) throw Error('El celular se desconectó');
    if (expected) {
      controlPending = expected;
      clearTimeout(commandTimer);
      commandTimer = setTimeout(() => showError('El celular no confirmó el control. Revisa el enlace abierto.'), 8000);
    }
    recordingMessage = '';
    renderDialog();
  }

  async function start() {
    if (controlPending || phone.mode !== 'idle' || !phone.ready || !destination) return;
    const target = destination;
    controlPending = 'recording';
    renderDialog();
    let draft;
    try {
      if (state.project?.id === target.projectId) await saveNow();
      draft = await flow('begin', target);
      command('start', draft, 'recording');
    } catch (error) {
      if (draft) await flow('cancel', { id: draft.id }).catch(() => {});
      showError(error);
    }
  }

  function onTrack(track) {
    if (!mediaStream) mediaStream = new MediaStream();
    for (const old of mediaStream.getTracks().filter(item => item.kind === track.kind)) mediaStream.removeTrack(old);
    mediaStream.addTrack(track);
    if (track.kind === 'audio') {
      audioMeter?.stop();
      try { audioMeter = meter(mediaStream, drawMeter); }
      catch { drawMeter(-60); }
    }
    renderDialog();
  }

  async function saved(result, activeChannel) {
    recordingMessage = 'Toma guardada en el proyecto y en ' + names[result.scene] + '.';
    if (state.project?.id === result.projectId) {
      const latest = await api('projects:get', { id: result.projectId });
      if (state.project?.id === result.projectId) {
        state.project.assets = latest.assets;
        state.project.urls = latest.urls;
        const index = result.scene;
        if (latest.scenes[index].video === result.assetId) {
          const { video, start, end, silences, cuts, approved } = latest.scenes[index];
          Object.assign(state.project.scenes[index], { video, start, end, silences, cuts, approved });
          delete state.project.scenes[index].cutHistory;
          if (state.scene === index && state.page === 'project') resetCutEditor();
        }
        if (state.page === 'guided') render();
        if (state.page === 'project') {
          render();
          if (state.scene === result.scene) {
            refreshWaveform();
            prepareScenePreview();
          }
        }
      }
    }
    notice('Toma del celular guardada · ' + names[result.scene]);
    if (activeChannel === channel) send(channel, { type: 'saved', id: result.id });
  }

  async function receive(data, activeChannel) {
    if (data instanceof ArrayBuffer) {
      const current = transfer;
      if (!current || !data.byteLength || data.byteLength > BLOCK
        || current.used + data.byteLength > current.buffer.length
        || current.offset + current.used + data.byteLength > current.size) {
        throw Error('El fragmento recibido no coincide con la transferencia');
      }
      current.buffer.set(new Uint8Array(data), current.used);
      current.used += data.byteLength;
      return;
    }
    if (typeof data !== 'string' || data.length > 16000) return;
    const message = JSON.parse(data);
    switch (message.type) {
      case 'state': {
        const before = phone.mode;
        phone = message;
        if (controlPending === phone.mode
          || controlPending === 'stopping' && ['pending', 'uploading', 'idle'].includes(phone.mode)) clearCommand();
        if (before !== phone.mode && ['recording', 'paused', 'stopping'].includes(phone.mode)) recordingMessage = '';
        break;
      }
      case 'error':
        if (transfer) await transferError(Error(message.message), activeChannel);
        else showError(message.message);
        break;
      case 'discard':
        if ((!transfer || transfer.id === message.id) && phone.id === message.id) {
          transfer = null;
          await flow('discard', { id: message.id });
          recordingMessage = 'Toma pendiente descartada desde el celular.';
        }
        break;
      case 'upload': {
        if (!Number.isSafeInteger(message.size) || message.size < 100 || message.size > MAX_FILE) {
          throw Error('Tamaño inválido de la grabación');
        }
        const current = { id: message.id, size: message.size, offset: 0, buffer: new Uint8Array(WINDOW), used: 0 };
        transfer = current;
        const result = await flow('open', message);
        if (activeChannel !== channel || transfer !== current) return;
        if (result.saved) {
          transfer = null;
          await saved(result.saved, activeChannel);
        } else {
          current.offset = result.offset;
          recordingMessage = 'Recibiendo toma…';
          send(channel, { type: 'offset', id: current.id, offset: current.offset });
        }
        break;
      }
      case 'commit': {
        const current = transfer;
        if (!current || current.id !== message.id || message.offset !== current.offset || !current.used) {
          throw Error('El bloque recibido no coincide con el progreso guardado');
        }
        const result = await flow('append', {
          id: current.id, offset: current.offset, data: current.buffer.slice(0, current.used)
        });
        if (activeChannel !== channel || transfer !== current) return;
        current.offset = result.offset;
        current.used = 0;
        recordingMessage = 'Recibiendo toma · ' + Math.floor(100 * current.offset / current.size) + '%';
        send(channel, { type: 'offset', id: current.id, offset: current.offset });
        break;
      }
      case 'finish': {
        const current = transfer;
        if (!current || current.id !== message.id || current.offset !== current.size || current.used) {
          throw Error('Faltan fragmentos de la toma');
        }
        recordingMessage = 'Preparando el video cuadrado y su audio…';
        renderDialog();
        if (state.page === 'project' && state.project) await saveNow();
        const result = await flow('finish', { id: current.id });
        if (transfer === current) transfer = null;
        await saved(result, activeChannel);
        break;
      }
      default: return;
    }
    renderDialog();
  }

  async function transferError(error, activeChannel) {
    if (activeChannel !== channel) return;
    const id = transfer?.id || phone.id;
    transfer = null;
    send(channel, { type: 'upload-error', id, message: String(error?.message || error).slice(0, 360) });
    showError(error);
  }

  function onChannel(next) {
    channel = next;
    clearCommand();
    transfer = null;
    phone = {};
    if (next) {
      recordingMessage = '';
      let events = Promise.resolve();
      next.onmessage = event => {
        events = events.then(async () => {
          if (channel === next) await receive(event.data, next);
        }).catch(error => transferError(error, next));
      };
    } else {
      mediaStream = null;
      audioMeter?.stop();
      audioMeter = null;
      connectionLabel = 'Celular desconectado · esperando reconexión…';
    }
    renderDialog();
  }

  async function initialize(create = false) {
    if (link) return;
    if (loadingLink) await loadingLink;
    if (link) return;
    loadingLink = (async () => {
      const token = await api('mobile:link', { create });
      if (!token) return;
      personalUrl = remote.PAGE + '#' + token;
      link = await remote.connect({ token, role: 'desktop', onStatus: label => { connectionLabel = label; renderDialog(); },
        onTrack, onChannel });
      renderDialog();
    })();
    try { await loadingLink; } finally { loadingLink = null; }
  }

  async function testMicrophone() {
    const input = mediaStream?.getAudioTracks()[0];
    if (!input || input.readyState !== 'live') throw Error('El micrófono del celular todavía no está disponible');
    audioMeter?.resume();
    if (testUrl) URL.revokeObjectURL(testUrl);
    const preview = field('test-audio');
    preview.hidden = true;
    preview.removeAttribute('src');
    const recording = new MediaRecorder(new MediaStream([input]));
    testRecorder = recording;
    const chunks = [];
    recording.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recording.onerror = () => {
      microphoneMessage = 'No se pudo grabar la prueba del micrófono.';
    };
    recording.onstop = () => {
      clearTimeout(testTimer);
      testRecorder = null;
      if (chunks.length) {
        testUrl = URL.createObjectURL(new Blob(chunks, { type: recording.mimeType }));
        preview.src = testUrl;
        preview.hidden = false;
        microphoneMessage = 'Reproduce la prueba para escuchar el lavalier.';
      }
      renderDialog();
    };
    recording.start();
    microphoneMessage = 'Habla durante cuatro segundos…';
    testTimer = setTimeout(() => { if (recording.state !== 'inactive') recording.stop(); }, 4000);
    renderDialog();
  }

  function mount() {
    dialog = document.createElement('dialog');
    dialog.className = 'modal mobile-recording-modal';
    dialog.setAttribute('aria-labelledby', 'mobile-heading');
    dialog.innerHTML = '<div class="row between"><h2 id="mobile-heading">Grabar con celular</h2>' +
      '<button class="secondary" id="mobile-close">Cerrar</button></div>' +
      '<p class="muted">Destino <strong id="mobile-destination"></strong></p><p id="mobile-current" class="mini muted"></p>' +
      '<label class="field">Tu enlace para el celular<input readonly id="mobile-link" autocomplete="off" spellcheck="false"></label>' +
      '<div class="row wrap"><button class="secondary" id="mobile-copy">Copiar enlace</button>' +
      '<small id="mobile-connection" role="status"></small></div>' +
      '<div class="mobile-stage"><video id="mobile-preview" autoplay muted playsinline></video>' +
      '<div class="mobile-guide" aria-hidden="true"><span class="head"></span><span class="shoulders"></span>' +
      '<span class="eyes"><span>Altura de los ojos</span></span><span class="frame-label">Colócate dentro de la silueta</span></div></div>' +
      '<div class="two"><label class="field">Cámara<select id="mobile-video"></select></label>' +
      '<label class="field">Micrófono<select id="mobile-audio"></select></label></div>' +
      '<div class="row wrap mobile-mic-reading"><label id="mobile-mic-name" for="mobile-level">Micrófono del celular</label>' +
      '<meter id="mobile-level" min="0" max="60" low="20" high="55" optimum="45"></meter><span id="mobile-reading" class="mini"></span></div>' +
      '<div class="row wrap"><button class="secondary" id="mobile-mic-toggle">Silenciar micrófono</button>' +
      '<button class="secondary" id="mobile-listen">Escuchar en vivo</button>' +
      '<button class="secondary" id="mobile-test">Probar micrófono (4 s)</button></div>' +
      '<p class="mini" id="mobile-test-status" role="status"></p><audio id="mobile-test-audio" controls hidden></audio>' +
      '<div class="row wrap mobile-controls"><button id="mobile-start">Grabar</button>' +
      '<button class="secondary" id="mobile-pause">Pausar</button><button class="danger" id="mobile-stop">Detener</button>' +
      '<button class="secondary" id="mobile-transfer">Transferir</button></div>' +
      '<p id="mobile-status" role="status" aria-live="polite"></p>' +
      '<progress id="mobile-progress" max="100" value="0" aria-label="Transferencia desde el celular" hidden></progress>';
    document.body.append(dialog);
    field('close').onclick = () => dialog.close();
    dialog.onclose = () => {
      field('preview').muted = true;
      field('listen').textContent = 'Escuchar en vivo';
      field('test-audio').pause();
    };
    const bind = (id, action) => { field(id).onclick = () => Promise.resolve().then(action).catch(showError); };
    bind('copy', async () => { await api('mobile:copy', { url: personalUrl }); notice('Enlace del celular copiado'); });
    bind('start', start);
    bind('pause', () => phone.mode === 'paused' ? command('resume', {}, 'recording') : command('pause', {}, 'paused'));
    bind('stop', () => command('stop', {}, 'stopping'));
    bind('transfer', () => command('retry'));
    bind('mic-toggle', () => command('mic', { enabled: phone.micEnabled === false }));
    bind('test', testMicrophone);
    bind('listen', () => {
      const preview = field('preview');
      preview.muted = !preview.muted;
      field('listen').textContent = preview.muted ? 'Escuchar en vivo' : 'Silenciar monitor';
      if (!preview.muted) preview.play().catch(showError);
    });
    for (const kind of ['video', 'audio']) field(kind).onchange = event => {
      try { command('device', { kind, id: event.target.value }); }
      catch (error) { showError(error); }
    };
  }

  async function open() {
    if (!state.project || !names[state.scene]) throw Error('Abre un récord y selecciona una escena');
    destination = { projectId: state.project.id, scene: state.scene, title: state.project.title };
    if (!dialog) mount();
    if (!dialog.open) dialog.showModal();
    audioMeter?.resume();
    renderDialog();
    await initialize(true);
  }

  document.addEventListener('DOMContentLoaded', () => initialize().catch(error => {
    connectionLabel = error.message;
    renderDialog();
  }));
  window.MobileRecording = { open };
})();
