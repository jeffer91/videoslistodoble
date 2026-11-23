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
