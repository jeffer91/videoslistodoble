# Librerías incluidas

| Archivo | Origen | Versión | Licencia |
| --- | --- | --- | --- |
| `mediabunny.min.mjs` | [mediabunny](https://github.com/Vanilagy/mediabunny) (`dist/bundles/mediabunny.min.mjs`) | 1.66.2 | MPL-2.0 |
| `mediabunny-aac-encoder.min.mjs` | [@mediabunny/aac-encoder](https://www.npmjs.com/package/@mediabunny/aac-encoder) (`dist/bundles/mediabunny-aac-encoder.min.mjs`) | 1.66.2 | MPL-2.0 |

En el codificador AAC se cambió la importación `from "mediabunny"` por `from "./mediabunny.min.mjs"` para cargarlo sin empaquetador. Solo se descarga cuando el navegador no tiene AAC propio (Firefox, Chrome en Linux, iOS anterior a la versión 26).

Para actualizar:

~~~bash
npm pack mediabunny @mediabunny/aac-encoder
# copia los dos archivos y repite el cambio de la importación
sed -i 's#from"mediabunny"#from"./mediabunny.min.mjs"#g' shorts/vendor/mediabunny-aac-encoder.min.mjs
~~~

## Whisper (subtítulos)

Transformers.js y el motor ONNX **no** se guardan en el repositorio porque pesan unos 40 MB. Su versión está fijada en `web-vendor/package.json` y `web-vendor/package-lock.json`; el workflow de Pages los instala con `npm ci --prefix web-vendor --ignore-scripts` y `scripts/build-pages.cjs` copia a `site/shorts/vendor/transformers/`:

- `transformers.min.js` (@huggingface/transformers 4.3.2, Apache-2.0)
- `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` y `ort-wasm-simd-threaded.{mjs,wasm}` (onnxruntime-web, MIT). La segunda variante es para Safari anterior a 26 sin WebGPU.

Los modelos (`onnx-community/whisper-base_timestamped` y `onnx-community/whisper-tiny_timestamped`) se descargan de Hugging Face la primera vez y quedan guardados en el navegador.

- `paises.json`: contornos de países (Natural Earth 1:110m, dominio público) con nombres en español para la marca `[MAPA: …]`. Se regenera con `scripts/build-map-data.cjs`.
