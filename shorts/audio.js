'use strict';
/* Audio del Short: decodificar tomas, limpiar la voz y preparar la pista final. */
const ShortsAudio = (() => {
  const C = ShortsCore;
  const SR = C.SAMPLE_RATE;

  /** Decodifica el audio de un video o sonido y lo devuelve en mono a 48 kHz. */
  async function decode(blob) {
    const data = await blob.arrayBuffer();
    const context = new OfflineAudioContext(1, 1, SR);
    let buffer;
    try {
      buffer = await context.decodeAudioData(data);
    } catch {
      throw Error('No se pudo leer el audio de la toma. Vuelve a grabarla con el micrófono activado.');
    }
    const channels = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
    return { samples: C.mixToMono(channels), duration: buffer.duration };
  }

  /** Limpieza de voz: quita graves de fondo, da presencia y comprime con suavidad. */
  async function enhance(samples) {
    if (!samples.length) return samples;
    const context = new OfflineAudioContext(1, samples.length, SR);
    const buffer = context.createBuffer(1, samples.length, SR);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass'; highpass.frequency.value = 80; highpass.Q.value = 0.7;
    const mud = context.createBiquadFilter();
    mud.type = 'peaking'; mud.frequency.value = 280; mud.Q.value = 1; mud.gain.value = -2;
    const presence = context.createBiquadFilter();
    presence.type = 'peaking'; presence.frequency.value = 3500; presence.Q.value = 0.9; presence.gain.value = 2.5;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -26; compressor.knee.value = 8; compressor.ratio.value = 3;
    compressor.attack.value = 0.004; compressor.release.value = 0.18;
    source.connect(highpass).connect(mud).connect(presence).connect(compressor).connect(context.destination);
    source.start();
    const rendered = await context.startRendering();
    return rendered.getChannelData(0).slice();
  }

  /**
   * Prepara la pista completa del Short.
   * parts: [{ samples, ranges }] en el orden de las escenas.
   */
  async function soundtrack(parts, timeline, stampSamples) {
    const joined = C.joinRanges(parts, SR);
    const cleaned = await enhance(joined);
    const normalized = C.normalizeVoice(cleaned, SR);
    const total = Math.round(timeline.duration * SR);
    let mono = new Float32Array(total);
    mono.set(normalized.samples.subarray(0, Math.min(total, normalized.samples.length)));
    if (timeline.tail > 0 && stampSamples?.length) mono = C.mixAt(mono, stampSamples, SR, timeline.content, -2);
    return { mono, lufs: normalized.after, gainDb: normalized.gainDb };
  }

  /** AudioBuffer estéreo (dos canales iguales) a partir de una pista mono. */
  function toBuffer(mono, start = 0, end = mono.length) {
    const length = Math.max(1, end - start);
    const buffer = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: SR });
    const slice = mono.subarray(start, start + length);
    buffer.copyToChannel(slice, 0);
    buffer.copyToChannel(slice, 1);
    return buffer;
  }

  return { decode, enhance, soundtrack, toBuffer };
})();
