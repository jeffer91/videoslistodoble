# 11 Récords Studio Desktop

Editor local de fútbol para Windows construido con Electron y FFmpeg. Repositorio de la nueva aplicación de escritorio. **La versión web Videoshort v20 permanece íntegra en `legacy/` como referencia.**

## Instalar en Windows

1. En **Actions → Desktop Windows - pruebas y compilación**, abre el trabajo más reciente que haya terminado correctamente.
2. Descarga el artefacto **11-records-studio-windows**.
3. Extrae el ZIP y ejecuta **11 Récords Studio Setup 0.1.0.exe**.
4. Cuando el instalador solicite una carpeta, selecciona una ubicación en **D:**.
5. El programa creará su biblioteca en **D:\11-Records-Studio**. El disco D es obligatorio; no se redirigen silenciosamente los proyectos a C.

El instalador no tiene firma de editor comercial. Windows puede mostrar una advertencia de reputación SmartScreen. Revisa el origen del instalador antes de ejecutarlo.

## Desarrollo local

```powershell
git clone https://github.com/jeffer91/videoslistodoble.git D:\videoslistodoble
cd D:\videoslistodoble
npm install
npm test
npm start
```

Requisitos para desarrollo: Node.js 22 o superior y Windows con unidad D accesible.

## Flujo actual

1. **Nuevo récord:** título del video y proyecto en la biblioteca local.
2. **Gancho, desarrollo y cierre:** importa un video principal con narración en cada escena, además de fotografías y videos de apoyo.
3. **Silencios:** el programa identifica pausas de 0,5 segundos (configurable). Rojo significa "omitir"; gris significa "conservar". Se guardan como recortes no destructivos.
4. **Dos composiciones:** 9:16 y 16:9 parten de los archivos originales y guardan ajustes por separado.
5. **Exportación Short:** renderiza los segmentos como MP4 H.264 + AAC con FFmpeg local.
6. **Compilación semanal:** propone los Shorts exportados todavía no utilizados y reúne solamente los desarrollos, agregando introducción, cierre y transiciones.
7. **Al exportar** la compilación, se marcan sus récords como utilizados. Los archivos originales de cada récord permanecen intactos; reeditar un récord y volver a exportar la compilación toma los cambios actuales.

## Biblioteca

```text
D:\11-Records-Studio\
  Proyectos\<id>\proyecto.json
  Proyectos\<id>\Originales\
  Compilaciones\<id>\compilacion.json
  Exportaciones\Shorts\
  Exportaciones\Videos-Largos\
  Recursos\logo-11-records.png
  Configuracion\ajustes.json
  Respaldos\
  Temporales\
```

**Importante:** los originales se copian dentro de la biblioteca. El archivo JSON no contiene el video: contiene referencias a la copia local. No borres manualmente sus carpetas. Las compilaciones referencian los mismos originales y no vuelven a copiar su material. La carpeta `Respaldos` existe para la estrategia de recuperación, pero todavía no sustituye un respaldo externo verificado.

## Estructura del código

- `main.cjs`: proceso principal Electron, acceso a disco, diálogos y protocolos de archivos.
- `preload.cjs`: puente limitado entre la interfaz y el proceso principal.
- `backend/store.cjs`: proyectos, biblioteca, importaciones y metadatos.
- `backend/media.cjs`: análisis de audio, recortes no destructivos y renderizado FFmpeg.
- `renderer/`: interfaz de escritorio y composición de vista previa.
- `legacy/`: copia de Videoshort v20; **no** comparte aún los proyectos guardados del editor nuevo.
- `tests/`: pruebas automáticas de guardado, lógica de silencios y renderizado MP4.

## Limitaciones a verificar

- El motor FFmpeg local no reproduce todavía **todas** las animaciones ni el recorte avanzado de fondo con MediaPipe del editor web. Los videos de presentador se incluyen como superposiciones de imagen; el editor web original se conserva para referencia.
- La vista previa CSS sirve para seleccionar medios y composición; el MP4 final es generado por FFmpeg y debe comprobarse visualmente.
- La detección de silencios se basa en nivel de audio; una pausa con ruido de fondo puede no clasificarse como silencio.
- El motor de renderizado utiliza CPU. Compilaciones largas pueden tardar; probar con archivos reales.
- La generación de clips realiza recortes suaves y permite velocidad de apoyo, pero no evita reclamaciones de copyright o Content ID.
- La compilación requiere al menos 8 minutos de contenido. No agrega material automáticamente para rellenar el tiempo.
- Los proyectos no se sincronizan con la nube. Guarda copias externas cuando sean importantes.
- La versión de escritorio no incluye aún edición de subtítulos ni herramientas de creación de miniaturas.

## Construcción y pruebas

GitHub Actions ejecuta `npm run check`, `npm test` y `npm run dist:win`. Si estas pruebas no pasan, **no debe tratarse el instalador como una versión lista para producción**.

Se solicita una prueba de extremo a extremo en un equipo Windows real: importar tres videos, guardar y reabrir proyecto, eliminar silencios, exportar MP4, abrirlo en un reproductor, crear recopilación con intro/cierre y revisar sincronización y calidad.
