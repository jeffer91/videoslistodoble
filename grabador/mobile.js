'use strict';
(() => {
  const { connect, send, meter, tokenPattern, BLOCK, WINDOW, MAX_FILE } = RecordsRemote;
  const el = id => document.getElementById(id);
  const camera = el('camera');
  const status = message => { el('status').textContent = message; };
  const connection = message => { el('connection').textContent = message; };
  const formats = ['video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm'];
  const idPattern = /^[a-f0-9-]{36}$/;
  const token = location.hash.slice(1);
  let database, pair, link, channel, stream, audioMeter, recorder, take, pending, wakeLock;
  let writes = Promise.resolve();
  let sending, part, opening = false, stopping = false, micEnabled = true, writeError;
  let devices = { video: [], audio: [] };

  function reportLevel(db) {
    el('level').value = db + 60;
    el('level-text').textContent = db <= -60 ? 'Sin señal' : db + ' dBFS';
  }

  function mode() {
    if (stopping) return 'stopping';
    if (recorder?.state === 'recording' || recorder?.state === 'paused') return recorder.state;
    if (pending) return sending ? 'uploading' : 'pending';
    return 'idle';
  }

  const activeTrack = kind => stream?.getTracks().find(track => track.kind === kind && track.readyState === 'live');

  function publish() {
    const current = mode();
    const active = current === 'recording' || current === 'paused';
    el('stop').hidden = !active;
    el('transfer').hidden = !pending || Boolean(sending);
    el('transfer').disabled = channel?.readyState !== 'open';
    el('download').hidden = !pending;
    el('progress').hidden = !sending;
    el('activate').hidden = Boolean(activeTrack('video') && activeTrack('audio'));
    el('activate').disabled = opening || active || stopping;
    el('inputs').hidden = !stream;
    el('camera-choice').disabled = el('mic-choice').disabled = opening || current !== 'idle';
    const ready = !opening && Boolean(activeTrack('video') && activeTrack('audio') && camera.videoWidth);
    send(channel, {
      type: 'state', mode: current, ready, micEnabled,
      id: take?.id || pending?.id, devices,
      selected: { video: activeTrack('video')?.getSettings().deviceId, audio: activeTrack('audio')?.getSettings().deviceId },
      mic: activeTrack('audio')?.label || 'Micrófono asignado por el celular',
      title: take?.title || pending?.title, scene: take?.scene || pending?.scene
    });
  }

  async function deviceList() {
    const available = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    for (const kind of ['video', 'audio']) {
      const list = available.filter(device => device.kind === kind + 'input' && device.deviceId);
      devices[kind] = list.map((device, index) => ({
        id: device.deviceId, label: device.label || (kind === 'video' ? 'Cámara ' : 'Micrófono ') + (index + 1)
      }));
      const select = el(kind === 'video' ? 'camera-choice' : 'mic-choice');
      const selected = activeTrack(kind)?.getSettings().deviceId;
      select.replaceChildren(new Option('Predeterminado del celular', ''),
        ...devices[kind].map(device => new Option(device.label, device.id, false, selected === device.id)));
    }
  }

  function releaseStream() {
    const old = stream;
    stream = null;
    audioMeter?.stop();
    camera.srcObject = null;
    old?.getTracks().forEach(track => track.stop());
  }

  async function activate(videoId = '', audioId = '') {
    if (opening || recorder || stopping) return;
    opening = true;
    publish();
    releaseStream();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 },
          ...(videoId ? { deviceId: { exact: videoId } } : { facingMode: { ideal: 'environment' } })
        },
        audio: {
          echoCancellation: { ideal: false }, noiseSuppression: { ideal: false }, autoGainControl: { ideal: false },
          ...(audioId ? { deviceId: { exact: audioId } } : {})
        }
      });
      camera.srcObject = stream;
      await camera.play();
      stream.getAudioTracks().forEach(track => { track.enabled = micEnabled; });
      audioMeter = meter(stream, reportLevel);
      for (const track of stream.getTracks()) track.addEventListener('ended', () => {
        if (!stream?.getTracks().includes(track)) return;
        if (recorder && recorder.state !== 'inactive') stop('Se desconectó la cámara o el micrófono.').catch(fail);
        else status('Entrada desconectada. Vuelve a activar la cámara y el micrófono.');
        publish();
      });
      await deviceList();
      await link?.setTracks();
      if (pending) status('Hay una toma guardada en este celular.');
      else status('Alinea tus ojos con la guía. Inicia la grabación desde Windows.');
    } catch (error) {
      releaseStream();
      fail(error.name === 'NotAllowedError' ? Error('Autoriza la cámara y el micrófono en este navegador para grabar.') : error);
    } finally {
      opening = false;
      publish();
    }
  }

  function fail(error) {
    const message = String(error?.message || error).slice(0, 360);
    status(message);
    send(channel, { type: 'error', message });
    publish();
  }

  function acquireWakeLock() {
    if (!navigator.wakeLock || wakeLock || document.visibilityState !== 'visible' || !recorder) return;
    navigator.wakeLock.request('screen').then(lock => {
      if (!recorder || wakeLock) return lock.release();
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    }).catch(() => {});
  }

  async function start(command) {
    if (!idPattern.test(command.id) || take || recorder || pending || stopping
      || opening || !activeTrack('video') || !activeTrack('audio') || !camera.videoWidth) {
      throw Error('Prepara la cámara y el micrófono o termina de transferir la toma pendiente.');
    }
    const mimeType = formats.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw Error('Este navegador no tiene un formato compatible de grabación.');
    const capture = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6500000, audioBitsPerSecond: 128000 });
    const draft = { id: command.id, pair, title: String(command.title || '').slice(0, 120),
      scene: command.scene, format: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm',
      at: Date.now(), size: 0, complete: false };
    take = draft;
    writes = Promise.resolve();
    writeError = null;
    try {
      await database.put(draft);
      recorder = capture;
      capture.addEventListener('dataavailable', event => {
        if (!event.data.size) return;
        writes = writes.then(async () => {
          if (writeError) return;
          const offset = draft.size;
          const next = offset + event.data.size;
          if (next > MAX_FILE) throw Error('La toma alcanzó el límite de 1 GB.');
          await database.add({ ...draft, size: next }, offset, event.data);
          draft.size = next;
        }).catch(error => {
          writeError = error;
          if (capture.state !== 'inactive') stop().catch(fail);
        });
      });
      capture.addEventListener('error', event => {
        writeError = event.error || Error('Se interrumpió la grabación.');
      });
      capture.addEventListener('stop', () => finalize(draft).catch(fail), { once: true });
      capture.start(1000);
      acquireWakeLock();
      status('Grabando. Mantén esta página abierta.');
      publish();
    } catch (error) {
      take = recorder = null;
      await database.remove(draft.id).catch(() => {});
      throw error;
    }
  }

  async function finalize(draft) {
    stopping = true;
    publish();
    try {
      await writes;
      recorder = take = null;
      await wakeLock?.release().catch(() => {});
      if (draft.size < 100) {
        await database.remove(draft.id);
        throw writeError || Error('Toma demasiado corta. Intenta de nuevo.');
      }
      draft.complete = true;
      pending = draft;
      await database.put(draft).catch(error => { writeError ||= error; });
      status(writeError ? 'Grabación interrumpida. Se conservó la parte disponible.' : 'Toma lista para transferir.');
    } finally {
      stopping = false;
      publish();
      requestUpload();
    }
  }

  async function stop(message) {
    if (!recorder || recorder.state === 'inactive') return;
    stopping = true;
    recorder.stop();
    status(message || 'Cerrando la grabación…');
    publish();
  }

  function requestUpload() {
    if (!pending || sending || channel?.readyState !== 'open') return;
    sending = { channel, id: pending.id, offset: 0 };
    part = null;
    el('progress').value = 0;
    status('Preparando envío a Windows…');
    publish();
    send(channel, { type: 'upload', id: pending.id, size: pending.size, format: pending.format });
  }

  async function uploadFrom(offset, expected) {
    const session = sending;
    const draft = pending;
    if (!session || !draft || expected !== session.id || !Number.isSafeInteger(offset) || offset < 0 || offset > draft.size
      || session.channel !== channel || offset < session.offset) return;
    session.offset = offset;
    el('progress').value = Math.floor(100 * offset / draft.size);
    if (offset === draft.size) {
      status('Verificando y preparando el video cuadrado en Windows…');
      send(channel, { type: 'finish', id: draft.id });
      return;
    }
    status('Enviando a Windows · ' + el('progress').value + '%');
    let cursor = offset;
    const end = Math.min(draft.size, offset + WINDOW);
    while (cursor < end) {
      if (!part || cursor >= part.offset + part.blob.size || cursor < part.offset) part = await database.part(draft.id, cursor);
      if (sending !== session || session.channel !== channel || channel.readyState !== 'open') return;
      if (!part || part.offset + part.blob.size <= cursor) throw Error('No se encontró un fragmento de la toma en el celular.');
      const position = cursor - part.offset;
      const size = Math.min(BLOCK, end - cursor, part.blob.size - position);
      const bytes = await part.blob.slice(position, position + size).arrayBuffer();
      if (sending !== session || session.channel !== channel || channel.readyState !== 'open') return;
      channel.send(bytes);
      cursor += size;
    }
    send(channel, { type: 'commit', id: draft.id, offset });
  }

  async function message(data) {
    if (typeof data !== 'string' || data.length > 4000) return;
    const command = JSON.parse(data);
    switch (command.type) {
      case 'start': return start(command);
      case 'pause':
        if (recorder?.state === 'recording') { recorder.pause(); status('Grabación en pausa.'); }
        break;
      case 'resume':
        if (recorder?.state === 'paused') { recorder.resume(); status('Grabando. Mantén esta página abierta.'); }
        break;
      case 'stop': return stop();
      case 'mic':
        micEnabled = command.enabled === true;
        stream?.getAudioTracks().forEach(track => { track.enabled = micEnabled; });
        break;
      case 'device':
        if (mode() === 'idle' && ['video', 'audio'].includes(command.kind)) {
          const list = devices[command.kind];
          if (command.id && !list.some(device => device.id === command.id)) throw Error('La entrada seleccionada ya no está disponible.');
          return activate(
            command.kind === 'video' ? command.id : activeTrack('video')?.getSettings().deviceId,
            command.kind === 'audio' ? command.id : activeTrack('audio')?.getSettings().deviceId
          );
        }
        break;
      case 'retry': return requestUpload();
      case 'offset': return uploadFrom(command.offset, command.id);
      case 'saved':
        if (pending?.id === command.id) {
          await database.remove(command.id);
          pending = sending = part = null;
          status('Toma guardada en Windows.');
        }
        break;
      case 'upload-error':
        if (pending && command.id === pending.id) {
          sending = part = null;
          status('La toma sigue en el celular. ' + String(command.message || 'Reintenta la transferencia.'));
        }
        break;
      default: return;
    }
    publish();
  }

  function onChannel(next) {
    channel = next;
    sending = part = null;
    if (next) {
      connection('Conectado a 11 Récords Studio');
      let events = Promise.resolve();
      next.onmessage = event => {
        events = events.then(async () => {
          if (channel === next) await message(event.data);
        }).catch(error => {
          if (channel === next) {
            sending = part = null;
            fail(error);
          }
        });
      };
      if (!take && !pending && !stream) status('Activa la cámara y el micrófono para preparar el encuadre.');
      requestUpload();
    } else {
      connection('Windows desconectado · intentando reconectar…');
      if (pending) status('La toma está guardada en este celular.');
    }
    publish();
  }

  async function download() {
    if (!pending) return;
    const draft = pending;
    const file = await database.file(draft);
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '11-Records-' + draft.id + '.' + draft.format;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function initialize() {
    if (!tokenPattern.test(token)) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.RTCPeerConnection) {
      connection('Abre el enlace en una versión actual de Safari o Chrome.');
      return;
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    pair = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    database = await RecordsTakeStorage.open();
    pending = await database.latest(pair);
    if (pending && pending.size < 100) {
      await database.remove(pending.id);
      pending = null;
    }
    if (pending) status('Hay una toma guardada en este celular.');
    el('capture').hidden = false;
    link = await connect({ token, role: 'phone', tracks: activeTrack,
      onStatus: label => { if (!channel) connection(label); }, onChannel });
    publish();
    el('activate').onclick = () => activate().catch(fail);
    el('camera-choice').onchange = event => activate(event.target.value, el('mic-choice').value).catch(fail);
    el('mic-choice').onchange = event => activate(el('camera-choice').value, event.target.value).catch(fail);
    el('stop').onclick = () => stop().catch(fail);
    el('transfer').onclick = requestUpload;
    el('download').onclick = () => download().catch(fail);
    camera.onloadedmetadata = publish;
    document.addEventListener('visibilitychange', acquireWakeLock);
    window.addEventListener('pagehide', () => { if (recorder?.state !== 'inactive') recorder?.stop(); });
    if (navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', () => deviceList().then(publish).catch(() => {}));
    }
  }

  initialize().catch(error => connection('No se pudo abrir la grabadora. ' + error.message));
})();
