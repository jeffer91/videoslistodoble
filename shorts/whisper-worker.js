/*
 * Whisper dentro del navegador (Transformers.js), en un hilo aparte para no congelar la página.
 * Mensajes: { type: 'load', config } y { type: 'transcribe', id, audio, language }.
 */
const vendor = new URL('./vendor/transformers/', self.location.href).href;
let lib = null;
let asr = null;
let loaded = null;

async function hasWebGPU() {
  try { return Boolean(self.navigator?.gpu && await self.navigator.gpu.requestAdapter()); } catch { return false; }
}

async function load(config) {
  lib = lib || await import(vendor + 'transformers.min.js');
  const { env, pipeline } = lib;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  if (config.remoteHost) env.remoteHost = config.remoteHost;
  if (config.remotePathTemplate) env.remotePathTemplate = config.remotePathTemplate;
  const webgpu = config.device !== 'wasm' && await hasWebGPU();
  // Safari anterior a 26 sin WebGPU no admite la variante «asyncify» del motor.
  const ua = self.navigator.userAgent;
  const oldSafari = /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua) && Number((/Version\/(\d+)/.exec(ua) || [])[1] || 0) < 26;
  const variant = oldSafari && !webgpu ? '' : '.asyncify';
  env.backends.onnx.wasm.wasmPaths = { mjs: vendor + 'ort-wasm-simd-threaded' + variant + '.mjs', wasm: vendor + 'ort-wasm-simd-threaded' + variant + '.wasm' };
  env.backends.onnx.wasm.numThreads = 1;
  const files = {};
  const progress_callback = info => {
    if (info.status === 'progress' && info.total) {
      files[info.file] = { loaded: info.loaded, total: info.total };
      const all = Object.values(files);
      const loadedBytes = all.reduce((n, f) => n + f.loaded, 0), totalBytes = all.reduce((n, f) => n + f.total, 0);
      postMessage({ type: 'download', loaded: loadedBytes, total: totalBytes });
    }
  };
  const attempts = webgpu
    ? [{ device: 'webgpu', dtype: config.webgpuDtype || { encoder_model: 'fp32', decoder_model_merged: 'q4' } }, { device: 'wasm', dtype: config.wasmDtype || 'q8' }]
    : [{ device: 'wasm', dtype: config.wasmDtype || 'q8' }];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      asr = await pipeline('automatic-speech-recognition', config.model, { ...attempt, progress_callback });
      return { device: attempt.device };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || Error('No se pudo cargar Whisper');
}

async function transcribe(audio, language) {
  const options = { language, task: 'transcribe' };
  try {
    const out = await asr(audio, { ...options, return_timestamps: 'word' });
    const words = (out.chunks || []).map(c => ({ text: c.text, start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] }));
    if (words.length || !String(out.text || '').trim()) return { mode: 'word', words, text: out.text };
  } catch (error) {
    // Algunos modelos no exportan la atención necesaria: se usan tiempos por frase.
  }
  const out = await asr(audio, { ...options, return_timestamps: true });
  return { mode: 'chunk', chunks: out.chunks || [], text: out.text };
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      loaded = loaded || load(data.config);
      const info = await loaded;
      postMessage({ type: 'ready', ...info });
    } else if (data.type === 'transcribe') {
      await loaded;
      const result = await transcribe(data.audio, data.language);
      postMessage({ type: 'result', id: data.id, ...result });
    }
  } catch (error) {
    if (data.type === 'load') loaded = null;
    postMessage({ type: 'error', id: data.id, message: String(error?.message || error) });
  }
};
