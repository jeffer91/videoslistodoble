'use strict';
/*
 * Procesa las tres tomas y genera el MP4 del Short.
 * Ruta principal: WebCodecs + Mediabunny (más rápido que tiempo real, MP4 H.264/AAC).
 * Respaldo: reproducir y grabar el lienzo en tiempo real con MediaRecorder.
 */
const ShortsExport = (() => {
  const C = ShortsCore;
  const SR = C.SAMPLE_RATE;
  const FPS = C.FPS;
  let mediabunny = null;

  const BASE = document.currentScript?.src || location.href;

  async function library() {
    if (!mediabunny) mediabunny = await import(new URL('vendor/mediabunny.min.mjs', BASE).href);
    return mediabunny;
  }

  function aborted(signal) {
    if (signal?.aborted) throw Object.assign(Error('Proceso cancelado'), { name: 'AbortError' });
  }

  async function assets(base) {
    const [logo, plate, stamp] = await Promise.all([
      ShortsCompose.loadImage(new URL('media/logo-11-records.png', base).href).catch(() => null),
      ShortsCompose.loadImage(new URL('media/sello-vertical.png', base).href).catch(() => null),
      fetch(new URL('media/sello.wav', base).href).then(r => r.ok ? r.blob() : null).then(b => b ? ShortsAudio.decode(b) : null).catch(() => null)
    ]);
    return { logo, plate, stamp: stamp?.samples || null };
  }

  /** ¿Puede este navegador exportar MP4 sin tiempo real? */
  async function fastPathAvailable() {
    if (typeof VideoEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
    try {
      const { canEncodeVideo } = await library();
      return await canEncodeVideo('avc', { width: C.WIDTH, height: C.HEIGHT });
    } catch { return false; }
  }

  /**
   * project: proyecto del almacén. blobs: { hook, body, closing } con las tomas.
   * onProgress({ step, progress, message, preview }) informa del avance.
   */
  async function render({ project, blobs, base, onProgress = () => {}, signal, preview, forceRealtime = false }) {
    const options = { cutSilences: true, stamp: true, logo: true, ...(project.options || {}) };
    const report = (step, progress, message) => onProgress({ step, progress, message });

    report('analyze', 0, 'Leyendo el audio de las tomas');
    const media = await assets(base);
    const parts = [];
    let rawSeconds = 0;
    for (const [i, key] of C.SCENES.entries()) {
      aborted(signal);
      const audio = await ShortsAudio.decode(blobs[key]);
      rawSeconds += audio.duration;
      const detected = options.cutSilences ? C.detectSpeech(audio.samples, SR) : { ranges: [{ start: 0, end: audio.duration }] };
      parts.push({ key, samples: audio.samples, ranges: detected.ranges, duration: audio.duration });
      report('analyze', (i + 1) / C.SCENES.length, 'Silencios detectados en ' + C.SCENE_LABELS[key]);
    }

    report('audio', 0, 'Limpiando la voz y ajustando el volumen');
    const timeline = C.buildTimeline(parts, { stamp: options.stamp && Boolean(media.plate) });
    const sound = await ShortsAudio.soundtrack(parts, timeline, media.stamp);
    report('audio', 1, 'Voz a ' + (Number.isFinite(sound.lufs) ? sound.lufs.toFixed(1) : '—') + ' LUFS');

    const captions = options.captions === false ? null : await captionWords({ project, parts, timeline, options, report, signal });
    const pages = captions?.words?.length ? C.captionPages(captions.words) : null;

    const composer = ShortsCompose.createComposer({ title: project.title, logo: media.logo, plate: media.plate, options, captions: pages });
    const stats = { rawSeconds, finalSeconds: timeline.duration, removedSeconds: Math.max(0, rawSeconds - timeline.content), lufs: sound.lufs };

    let result = null;
    if (!forceRealtime && await fastPathAvailable()) {
      try {
        result = await renderFast({ blobs, timeline, sound, composer, report, signal, preview });
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        console.warn('Exportación rápida no disponible, se usa tiempo real', error);
        report('video', 0, 'Cambiando a exportación en tiempo real');
      }
    }
    if (!result) result = await renderRealtime({ blobs, timeline, sound, composer, report, signal, preview });
    report('done', 1, 'Short listo');
    return { ...result, stats, timeline, captions };
  }

  /** Identifica las tomas y el recorte usados, para reutilizar subtítulos ya hechos o corregidos. */
  const captionSource = project => C.SCENES.map(k => project.takes?.[k]?.blob || '').join('|') + '|' + (project.options?.cutSilences !== false);

  async function captionWords({ project, parts, timeline, options, report, signal }) {
    const source = captionSource(project);
    if (project.captions?.source === source && Array.isArray(project.captions.words)) {
      report('captions', 1, project.captions.edited ? 'Usando tus subtítulos corregidos' : 'Usando los subtítulos ya escritos');
      return project.captions;
    }
    try {
      const scenes = parts.map(part => ({
        key: part.key,
        samples: C.joinRanges([part], SR),
        offset: (timeline.segments.find(s => s.scene === part.key) || { outStart: 0 }).outStart,
        script: project.script?.[part.key] || ''
      }));
      const result = await ShortsWhisper.transcribe(scenes, {
        quality: options.captionQuality || 'base', signal,
        onProgress: (progress, message) => report('captions', progress, message)
      });
      return { ...result, source, edited: false, at: new Date().toISOString() };
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      console.warn('Subtítulos no disponibles', error);
      report('captions', 1, 'Sin subtítulos: ' + (error.message || error));
      return null;
    }
  }

  async function renderFast({ blobs, timeline, sound, composer, report, signal, preview }) {
    const mb = await library();
    const { Input, ALL_FORMATS, BlobSource, CanvasSink, Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource, QUALITY_HIGH, canEncodeAudio } = mb;
    if (!(await canEncodeAudio('aac'))) {
      report('video', 0, 'Preparando el codificador de audio');
      const aac = await import(new URL('vendor/mediabunny-aac-encoder.min.mjs', BASE).href);
      aac.registerAacEncoder();
    }
    const tracks = {};
    for (const key of C.SCENES) {
      const input = new Input({ source: new BlobSource(blobs[key]), formats: ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw Error('La toma de ' + C.SCENE_LABELS[key] + ' no tiene video.');
      if (!(await track.canDecode())) throw Error('Este navegador no puede decodificar la toma.');
      const longest = Math.max(track.displayWidth, track.displayHeight);
      const scale = Math.min(1, 1280 / longest);
      tracks[key] = {
        input, offset: await track.getFirstTimestamp(),
        sink: new CanvasSink(track, { width: Math.round(track.displayWidth * scale / 2) * 2, height: Math.round(track.displayHeight * scale / 2) * 2, fit: 'fill', poolSize: 3 })
      };
    }

    const surface = ShortsCompose.canvas(C.WIDTH, C.HEIGHT);
    const ctx = surface.getContext('2d', { alpha: false });
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const video = new CanvasSource(surface, { codec: 'avc', bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
    const audio = new AudioBufferSource({ codec: 'aac', bitrate: 160000 });
    output.addVideoTrack(video, { frameRate: FPS });
    output.addAudioTrack(audio);
    await output.start();

    const frames = Math.max(1, Math.round(timeline.duration * FPS));
    const plan = [];
    for (let i = 0; i < frames; i++) {
      const t = i / FPS;
      plan.push({ i, t, at: C.locate(timeline, t) });
    }
    // Agrupa los fotogramas por escena para decodificar cada toma en orden.
    const runs = [];
    for (const frame of plan) {
      const key = frame.at.segment.scene;
      const last = runs[runs.length - 1];
      if (last && last.key === key) last.frames.push(frame); else runs.push({ key, frames: [frame] });
    }

    const audioChunk = SR;
    let audioSent = 0;
    const totalSamples = sound.mono.length;
    async function feedAudio(untilSeconds) {
      const until = Math.min(totalSamples, Math.round(untilSeconds * SR));
      while (audioSent < until) {
        const end = Math.min(until, audioSent + audioChunk);
        await audio.add(ShortsAudio.toBuffer(sound.mono, audioSent, end));
        audioSent = end;
      }
    }

    try {
      let done = 0;
      for (const run of runs) {
        const track = tracks[run.key];
        const stamps = run.frames.map(f => Math.max(0, f.at.srcTime) + track.offset);
        let index = 0;
        for await (const wrapped of track.sink.canvasesAtTimestamps(stamps)) {
          aborted(signal);
          const frame = run.frames[index++];
          composer.draw(ctx, wrapped?.canvas || null, {
            sceneKey: run.key, segment: frame.at.segment, local: frame.at.local, t: frame.t, stamp: frame.at.stamp
          });
          await feedAudio(frame.t + 1);
          await video.add(frame.t, 1 / FPS);
          done++;
          if (done % 6 === 0 || done === frames) {
            report('video', done / frames, 'Montando el video ' + Math.round(100 * done / frames) + ' %');
            if (preview) preview(surface);
          }
        }
      }
      await feedAudio(timeline.duration + 1);
      report('video', 1, 'Guardando el MP4');
      await output.finalize();
    } catch (error) {
      try { await output.cancel(); } catch {}
      throw error;
    } finally {
      for (const track of Object.values(tracks)) try { track.input.dispose?.(); } catch {}
    }
    const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
    return { blob, mimeType: 'video/mp4', extension: 'mp4', method: 'webcodecs' };
  }

  function pickRecorderType() {
    // H.264 primero: es lo que aceptan sin problemas TikTok, Instagram y YouTube.
    const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4D0028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4',
      'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return types.find(type => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || '';
  }

  async function renderRealtime({ blobs, timeline, sound, composer, report, signal, preview }) {
    if (!window.MediaRecorder) throw Error('Este navegador no puede generar el video. Usa Chrome o Safari actualizado.');
    const surface = ShortsCompose.canvas(C.WIDTH, C.HEIGHT);
    const ctx = surface.getContext('2d', { alpha: false });
    const urls = [];
    const players = {};
    for (const key of C.SCENES) {
      const url = URL.createObjectURL(blobs[key]);
      urls.push(url);
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      await new Promise((resolve, reject) => {
        v.onloadeddata = resolve;
        v.onerror = () => reject(Error('No se pudo abrir la toma de ' + C.SCENE_LABELS[key]));
      });
      players[key] = v;
    }
    const audioContext = new AudioContext({ sampleRate: SR });
    const destination = audioContext.createMediaStreamDestination();
    const source = audioContext.createBufferSource();
    source.buffer = ShortsAudio.toBuffer(sound.mono);
    source.connect(destination);
    const stream = new MediaStream([...surface.captureStream(FPS).getVideoTracks(), ...destination.stream.getAudioTracks()]);
    const mimeType = pickRecorderType();
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 8000000, audioBitsPerSecond: 160000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });

    let current = null;
    composer.draw(ctx, players.hook, { sceneKey: 'hook', segment: timeline.segments[0], local: 0, t: 0, stamp: null });
    await audioContext.resume();
    recorder.start(1000);
    const t0 = audioContext.currentTime + 0.1;
    source.start(t0);
    try {
      await new Promise((resolve, reject) => {
        const tick = () => {
          try {
            aborted(signal);
            const t = Math.max(0, audioContext.currentTime - t0);
            if (t >= timeline.duration) return resolve();
            const at = C.locate(timeline, t);
            const key = at.segment.scene;
            const player = players[key];
            if (current !== at.segment) {
              current = at.segment;
              for (const other of Object.values(players)) if (other !== player) other.pause();
              player.currentTime = at.srcTime;
              if (at.stamp === null) player.play().catch(() => {});
            } else if (at.stamp !== null) {
              player.pause();
            } else if (Math.abs(player.currentTime - at.srcTime) > 0.2) {
              player.currentTime = at.srcTime;
            }
            composer.draw(ctx, player, { sceneKey: key, segment: at.segment, local: at.local, t, stamp: at.stamp });
            report('video', t / timeline.duration, 'Grabando el montaje ' + Math.round(100 * t / timeline.duration) + ' % (tiempo real)');
            if (preview) preview(surface);
            setTimeout(tick, 1000 / (FPS * 2));
          } catch (error) { reject(error); }
        };
        tick();
      });
    } finally {
      try { source.stop(); } catch {}
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      for (const player of Object.values(players)) player.pause();
      for (const url of urls) URL.revokeObjectURL(url);
      audioContext.close().catch(() => {});
    }
    const type = (recorder.mimeType || mimeType || 'video/webm').split(';')[0];
    return { blob: new Blob(chunks, { type }), mimeType: type, extension: type.includes('mp4') ? 'mp4' : 'webm', method: 'realtime' };
  }

  return { render, fastPathAvailable, pickRecorderType, captionSource };
})();
