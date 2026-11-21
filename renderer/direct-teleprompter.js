'use strict';
/**
 * Videos largos directos · teleprompter.
 * Se dibuja como capa HTML sobre la vista de cámara: nunca entra en el
 * lienzo que se graba, así que su texto no aparece en la toma ni en el MP4.
 *
 * Modo A · desplazamiento automático con velocidad, pausa, retroceso y avance.
 * Modo B · seguimiento por voz: un detector de voz local avanza al ritmo de
 *          lectura y se detiene en los silencios; cada ~2 s Whisper (local)
 *          reconoce lo último dicho y recoloca la posición, también cuando se
 *          repite una frase.
 */
(function () {
  const L = window.DirectLayout;
  const state = {
    root: null, text: '', tokens: [], mode: 'auto', running: false, speed: 3, size: 46, opacity: 0.62,
    scroll: 0, cursor: 0, frame: 0, last: 0,
    voice: { ctx: null, analyser: null, processor: null, buffer: [], rate: 48000, noise: 0.008, speaking: false, silentFor: 0, wps: 2.4, pending: false, lastSend: 0, whisper: null, heard: '' }
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function markup() {
    // Cada palabra en su propio <span> para poder resaltar la posición de lectura.
    const re = /(\S+)(\s*)/g;
    let html = '', match, index = 0;
    const raw = state.text;
    let lastEnd = 0;
    while ((match = re.exec(raw))) {
      html += escapeHtml(raw.slice(lastEnd, match.index)).replace(/\n/g, '<br>');
      const norm = L.normalize(match[1]);
      html += norm ? '<span class="dl-w" data-i="' + index++ + '">' + escapeHtml(match[1]) + '</span>' : escapeHtml(match[1]);
      html += escapeHtml(match[2]).replace(/\n/g, '<br>');
      lastEnd = re.lastIndex;
    }
    return html || '<span class="muted">Esta sección no tiene texto narrable.</span>';
  }

  function mount(container, text) {
    unmount();
    state.root = container;
    state.text = String(text || '');
    state.tokens = L.tokens(state.text);
    state.scroll = 0;
    state.cursor = 0;
    container.innerHTML = '<div class="dl-prompter" style="--dl-size:' + state.size + 'px;--dl-opacity:' + state.opacity + '">' +
      '<div class="dl-prompter-mask"><div class="dl-prompter-text">' + markup() + '</div></div><div class="dl-prompter-guide"></div>' +
      '<div class="dl-prompter-status" aria-live="polite"></div></div>';
    paint();
  }

  function unmount() {
    stop();
    stopVoice();
    if (state.root) state.root.innerHTML = '';
    state.root = null;
  }

  function el(selector) { return state.root?.querySelector(selector); }

  function status(message) { const s = el('.dl-prompter-status'); if (s) s.textContent = message || ''; }

  function paint() {
    const text = el('.dl-prompter-text');
    if (!text) return;
    if (state.mode === 'voice') {
      const target = text.querySelector('.dl-w[data-i="' + Math.min(state.cursor, state.tokens.length - 1) + '"]');
      if (target) state.scroll += ((target.offsetTop - text.parentElement.clientHeight * 0.3) - state.scroll) * 0.18;
      text.querySelectorAll('.dl-w.read').forEach(w => { if (Number(w.dataset.i) >= state.cursor) w.classList.remove('read'); });
      for (let i = Math.max(0, state.cursor - 80); i < state.cursor; i++) text.querySelector('.dl-w[data-i="' + i + '"]')?.classList.add('read');
      text.querySelectorAll('.dl-w.now').forEach(w => w.classList.remove('now'));
      target?.classList.add('now');
    }
    const max = Math.max(0, text.scrollHeight - text.parentElement.clientHeight * 0.35);
    state.scroll = Math.max(0, Math.min(max, state.scroll));
    text.style.transform = 'translateY(' + (-state.scroll).toFixed(1) + 'px)';
  }

  function loop(now) {
    const dt = state.last ? Math.min(0.1, (now - state.last) / 1000) : 0;
    state.last = now;
    if (state.mode === 'auto' && state.running) state.scroll += dt * state.speed * state.size * 0.42;
    if (state.mode === 'voice' && state.running) voiceStep(dt);
    paint();
    state.frame = requestAnimationFrame(loop);
  }

  function start() {
    if (!state.root) return;
    state.running = true;
    state.last = 0;
    cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(loop);
  }

  function stop() {
    state.running = false;
    cancelAnimationFrame(state.frame);
    state.frame = 0;
  }

  function toggle() { state.running ? stop() : start(); return state.running; }

  function jump(lines) {
    if (state.mode === 'voice') state.cursor = Math.max(0, Math.min(state.tokens.length, state.cursor + lines * 6));
    else state.scroll += lines * state.size * 1.35;
    paint();
  }

  function reset() { state.scroll = 0; state.cursor = 0; paint(); }

  function setSize(px) {
    state.size = Math.max(24, Math.min(110, Number(px) || 46));
    el('.dl-prompter')?.style.setProperty('--dl-size', state.size + 'px');
    paint();
  }
  function setSpeed(value) { state.speed = Math.max(0.5, Math.min(12, Number(value) || 3)); }
  function setOpacity(value) {
    state.opacity = Math.max(0.2, Math.min(0.95, Number(value) || 0.62));
    el('.dl-prompter')?.style.setProperty('--dl-opacity', state.opacity);
  }

  // ── Seguimiento por voz ────────────────────────────────────────────────────
  async function setMode(mode, stream) {
    stopVoice();
    state.mode = mode === 'voice' ? 'voice' : 'auto';
    el('.dl-prompter')?.classList.toggle('voice', state.mode === 'voice');
    if (state.mode !== 'voice') { status(''); return { mode: state.mode }; }
    if (!stream?.getAudioTracks().length) throw Error('Activa el micrófono para el seguimiento por voz');
    const v = state.voice;
    if (v.whisper === null) {
      try { v.whisper = (await window.studio.call('direct:call', { action: 'intel.status' })).data?.whisper === true; } catch { v.whisper = false; }
    }
    v.ctx = new AudioContext();
    v.rate = v.ctx.sampleRate;
    const source = v.ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    v.analyser = v.ctx.createAnalyser();
    v.analyser.fftSize = 2048;
    source.connect(v.analyser);
    // Guarda los últimos 4 s de audio para el reconocimiento local.
    v.processor = v.ctx.createScriptProcessor(4096, 1, 1);
    v.buffer = [];
    v.processor.onaudioprocess = event => {
      v.buffer.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      const max = Math.ceil(v.rate * 4 / 4096);
      if (v.buffer.length > max) v.buffer.splice(0, v.buffer.length - max);
    };
    const mute = v.ctx.createGain();
    mute.gain.value = 0;
    source.connect(v.processor);
    v.processor.connect(mute);
    mute.connect(v.ctx.destination);
    await v.ctx.resume();
    status(v.whisper ? 'Seguimiento por voz activo · reconocimiento local con Whisper' : 'Seguimiento por voz por ritmo de lectura · instala Whisper en Configuración para recolocar la posición');
    return { mode: state.mode, whisper: v.whisper };
  }

  function stopVoice() {
    const v = state.voice;
    try { v.processor?.disconnect(); } catch { /* ya desconectado */ }
    if (v.ctx && v.ctx.state !== 'closed') v.ctx.close().catch(() => {});
    v.ctx = v.analyser = v.processor = null;
    v.buffer = [];
    v.speaking = false;
  }

  function level() {
    const v = state.voice;
    if (!v.analyser) return 0;
    const data = new Float32Array(v.analyser.fftSize);
    v.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const x of data) sum += x * x;
    return Math.sqrt(sum / data.length);
  }

  function voiceStep(dt) {
    const v = state.voice;
    const rms = level();
    // Umbral adaptativo: sigue el ruido de fondo cuando no se habla.
    if (!v.speaking) v.noise = v.noise * 0.98 + rms * 0.02;
    const speaking = rms > Math.max(0.012, v.noise * 2.6);
    v.silentFor = speaking ? 0 : v.silentFor + dt;
    v.speaking = speaking || v.silentFor < 0.35;
    if (v.speaking) v.progress = (v.progress || 0) + dt * v.wps;
    while ((v.progress || 0) >= 1) { v.progress -= 1; state.cursor = Math.min(state.tokens.length, state.cursor + 1); }
    el('.dl-prompter')?.classList.toggle('listening', v.speaking);
    const now = performance.now();
    if (v.whisper && v.speaking && !v.pending && now - v.lastSend > 1800 && v.buffer.length > 6) {
      v.lastSend = now;
      recognize().catch(() => {});
    }
  }

  function wav(samples, inputRate) {
    // Reduce a 16 kHz mono PCM de 16 bits.
    const ratio = inputRate / 16000, length = Math.floor(samples.length / ratio);
    const buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer);
    const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    write(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) {
      const s = Math.max(-1, Math.min(1, samples[Math.floor(i * ratio)]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  async function recognize() {
    const v = state.voice;
    const total = v.buffer.reduce((n, b) => n + b.length, 0);
    const merged = new Float32Array(total);
    let at = 0;
    for (const chunk of v.buffer) { merged.set(chunk, at); at += chunk.length; }
    v.pending = true;
    const sentAt = state.cursor;
    try {
      const response = await window.studio.call('direct:call', { action: 'intel.listen', data: { wav: wav(merged, v.rate) } });
      const text = response.ok ? response.data?.text || '' : '';
      if (!text) return;
      v.heard = text;
      const found = L.align(state.tokens, text, state.cursor);
      if (found >= 0) {
        // Ajusta también la velocidad estimada de lectura.
        const drift = found - state.cursor;
        if (Math.abs(drift) <= 25 && Math.abs(drift) >= 2) v.wps = Math.max(1.2, Math.min(4.5, v.wps * (1 + drift / 40)));
        // Lo reconocido llega con ~1 s de retraso: se suma lo avanzado mientras tanto.
        state.cursor = Math.min(state.tokens.length, found + Math.max(0, state.cursor - sentAt));
        status('Posición sincronizada con tu voz');
      }
    } finally { v.pending = false; }
  }

  window.DirectPrompter = { mount, unmount, start, stop, toggle, jump, reset, setSize, setSpeed, setOpacity, setMode, state: () => ({ mode: state.mode, running: state.running, speed: state.speed, size: state.size, opacity: state.opacity, cursor: state.cursor, words: state.tokens.length }), wav };
})();
