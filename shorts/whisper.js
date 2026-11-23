'use strict';
/* Subtítulos automáticos: transcribe la voz ya recortada de cada escena con Whisper. */
const ShortsWhisper = (() => {
  const C = ShortsCore;
  const MODELS = {
    base: { model: 'onnx-community/whisper-base_timestamped', label: 'Normal', size: '≈ 80–150 MB' },
    tiny: { model: 'onnx-community/whisper-tiny_timestamped', label: 'Ligera', size: '≈ 40–80 MB' }
  };
  const SCRIPT_URL = document.currentScript?.src || location.href;
  let worker = null, ready = null, sequence = 0, listener = null;
  const pending = new Map();

  /** Ajustes para pruebas: localStorage['shorts-11-whisper'] = {"model": "...", "remoteHost": "..."} */
  function override() {
    try { return JSON.parse(localStorage.getItem('shorts-11-whisper') || 'null'); } catch { return null; }
  }

  function config(quality) {
    const custom = override();
    return { model: (MODELS[quality] || MODELS.base).model, ...(custom || {}) };
  }

  function start(quality, onDownload) {
    listener = onDownload;
    if (ready) return ready;
    worker = new Worker(new URL('whisper-worker.js', SCRIPT_URL));
    worker.onmessage = ({ data }) => {
      if (data.type === 'download') return listener?.(data.loaded, data.total);
      if (data.type === 'ready' || (data.type === 'error' && data.id === undefined)) {
        const job = pending.get('load');
        pending.delete('load');
        return data.type === 'ready' ? job?.resolve(data) : job?.reject(Error(data.message));
      }
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id);
      if (data.type === 'error') job.reject(Error(data.message)); else job.resolve(data);
    };
    worker.onerror = event => {
      for (const job of pending.values()) job.reject(Error(event.message || 'Whisper se detuvo'));
      pending.clear();
      reset();
    };
    ready = new Promise((resolve, reject) => pending.set('load', { resolve, reject }));
    worker.postMessage({ type: 'load', config: config(quality) });
    ready.catch(() => reset());
    return ready;
  }

  function reset() {
    try { worker?.terminate(); } catch {}
    worker = null; ready = null;
  }

  function request(audio, language) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'transcribe', id, audio, language }, [audio.buffer]);
    });
  }

  /** Remuestrea a 16 kHz, que es lo que espera Whisper. */
  async function to16k(samples, sampleRate) {
    const length = Math.max(1, Math.ceil(samples.length * 16000 / sampleRate));
    const context = new OfflineAudioContext(1, length, 16000);
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    return (await context.startRendering()).getChannelData(0).slice();
  }

  /**
   * scenes: [{ key, samples (voz recortada a 48 kHz), offset (segundo del Short donde empieza), script }]
   * Devuelve las palabras con tiempos del Short ya corregidas con el guion.
   */
  async function transcribe(scenes, { quality = 'base', language = 'spanish', onProgress = () => {}, signal } = {}) {
    onProgress(0, 'Preparando Whisper');
    const info = await start(quality, (loaded, total) => {
      onProgress(0.4 * loaded / total, 'Descargando el modelo de subtítulos ' + Math.round(100 * loaded / total) + ' % (solo la primera vez)');
    });
    const jobs = [];
    for (const scene of scenes) {
      for (const part of C.splitForTranscription(scene.samples, C.SAMPLE_RATE)) jobs.push({ scene, part });
    }
    const totalSeconds = jobs.reduce((n, j) => n + j.part.end - j.part.start, 0) || 1;
    let doneSeconds = 0;
    const byScene = new Map(scenes.map(s => [s.key, []]));
    let mode = 'word';
    for (const { scene, part } of jobs) {
      if (signal?.aborted) throw Object.assign(Error('Proceso cancelado'), { name: 'AbortError' });
      onProgress(0.4 + 0.6 * doneSeconds / totalSeconds, 'Escribiendo los subtítulos de ' + C.SCENE_LABELS[scene.key].toLowerCase());
      const slice = scene.samples.subarray(Math.round(part.start * C.SAMPLE_RATE), Math.round(part.end * C.SAMPLE_RATE));
      const result = await request(await to16k(slice, C.SAMPLE_RATE), language);
      if (result.mode !== 'word') mode = 'chunk';
      const words = result.mode === 'word' ? result.words : C.wordsFromChunks(result.chunks);
      for (const w of words) {
        if (!Number.isFinite(w.start)) continue;
        const end = Number.isFinite(w.end) && w.end >= w.start ? w.end : w.start + 0.3;
        byScene.get(scene.key).push({ text: String(w.text).trim(), start: part.start + w.start, end: part.start + Math.min(end, part.end - part.start) });
      }
      doneSeconds += part.end - part.start;
    }
    const all = [];
    let corrected = 0;
    for (const scene of scenes) {
      const raw = C.dropHallucinations(byScene.get(scene.key).filter(w => w.text), scene.script);
      const aligned = C.alignToScript(raw, scene.script);
      corrected += aligned.corrected;
      for (const w of aligned.words) all.push({ text: w.text, start: scene.offset + w.start, end: scene.offset + w.end });
    }
    onProgress(1, all.length + ' palabras' + (corrected ? ', ' + corrected + ' corregidas con el guion' : ''));
    return { words: all, mode, device: info.device, model: config(quality).model };
  }

  return { transcribe, MODELS, reset };
})();
