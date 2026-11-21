# Once Records — Videos largos directos (apartado 3)

Este documento recoge cómo se implementó el tercer apartado, qué decisiones técnicas se tomaron tras analizar el repositorio y cómo se comprueba cada criterio de aceptación.

## 1. Análisis previo del repositorio

| Punto | Resultado |
| --- | --- |
| Arquitectura | Aplicación de escritorio **Electron 34** (Windows). Proceso principal en `main.cjs`, lógica en `backend/*.cjs`, interfaz en `renderer/` sin framework (HTML + JS). |
| Comunicación | IPC con lista blanca en `preload.cjs` (`window.studio.call`). Archivos servidos por el protocolo propio `records://`. |
| Cámara y grabación | `MediaRecorder` sobre un lienzo cuadrado 1080 × 1080; los fragmentos se escriben en disco cada segundo. |
| Edición y exportación | FFmpeg (`ffmpeg-static`) y `sharp` locales; Whisper (`whisper.cpp`) para transcribir en el equipo. |
| YouTube | OAuth de escritorio y YouTube Data API v3 ya integrados (`backend/network-clients.cjs`, `backend/publishing.cjs`) con accesos cifrados por el sistema. |
| GitHub Pages | Solo sirve la grabadora móvil (`grabador/`). La aplicación no depende de Pages, por lo que sus limitaciones no afectan a este apartado. |

## 2. Independencia respecto de los apartados existentes

El apartado es un módulo nuevo. Los cambios en archivos existentes son solo de integración y no alteran su comportamiento:

- `renderer/index.html`: un botón de menú, un contenedor `#direct-view`, una hoja de estilos y cuatro scripts nuevos.
- `preload.cjs`: el canal `direct:call` y el evento `direct:progress`.
- `main.cjs`: la ruta `records://direct/…` y la instalación del módulo (`directLong.install`).
- `backend/network-clients.cjs`: `googleOAuth` acepta una lista de permisos opcional. Sin ella sigue pidiendo los mismos que antes.
- `package.json`: dependencia `pdfjs-dist`, script `test:direct` y versión 0.12.0. `windows-build.yml` ejecuta también la prueba de extremo a extremo del apartado.

Los proyectos se guardan en una carpeta propia (`Directos/`), separada de `Proyectos/` (Shorts) y `Compilaciones/` (videos largos por unión). Todas las pruebas previas siguen pasando.

| Archivo nuevo | Función |
| --- | --- |
| `backend/direct-long.cjs` | Puente IPC, cola de copias MP4, rutas `records://direct/…` |
| `backend/direct-store.cjs` | Proyectos, secciones, tomas con reemplazo seguro, imágenes, audio, copias `.tar`, espacio en disco |
| `backend/direct-script.cjs` | Lectura de PDF, Word, TXT y MD; reconocimiento de secciones |
| `backend/direct-intel.cjs` | Transcripción, entidades deportivas, propuestas, Wikimedia Commons, seguimiento por voz |
| `backend/direct-graphics.cjs` | Fondos, marcos, rótulos, cartelas y gráficos de estadísticas originales |
| `backend/direct-audio.cjs` | Música y efectos originales sintetizados con FFmpeg |
| `backend/direct-captions.cjs` | SRT y ASS con resaltado |
| `backend/direct-render.cjs` | Exportación MP4, mezcla de audio y capítulos |
| `backend/direct-youtube.cjs` | Subida reanudable a YouTube |
| `renderer/direct-*.js`, `direct-long.css` | Interfaz, teleprompter, editor y geometría compartida |

## 3. Decisiones técnicas

**Almacenamiento.** El documento pedía evaluar IndexedDB y OPFS. Como la aplicación es Electron y ya guarda su biblioteca en disco, las grabaciones se escriben directamente en `D:\11-Records-Studio\Directos\<proyecto>\` mediante el proceso principal. Esto ofrece más capacidad que IndexedDB y OPFS, evita los límites de cuota del navegador y hace que los proyectos no desaparezcan al borrar los datos del navegador. Cada fragmento de grabación se sincroniza con `fsync` y el JSON del proyecto se escribe de forma atómica (temporal + `rename`). La pantalla de proyectos muestra el espacio libre y avisa cuando queda poco. Antes de grabar se exigen 600 MB libres y antes de exportar, 1,5 GB.

**Una toma por sección.** La toma nueva se graba en `Temporales/`. Solo cuando se confirma, se verifica con FFprobe (imagen, sonido y duración), se copia a `Tomas/` comprobando el tamaño y se actualiza el proyecto. La toma anterior se borra después. Si algo falla, la toma activa queda intacta y la nueva sigue disponible como «toma recuperable».

**Edición no destructiva.** La toma original (WebM) no se modifica. En segundo plano se crea una copia MP4 indexada (H.264, 30 FPS constantes) para buscar con precisión y exportar. Las composiciones, imágenes, títulos, música y subtítulos se guardan como datos del proyecto.

**Vista previa igual a la exportación.** `renderer/direct-layout.js` calcula la geometría de las distribuciones A–E y lo usan tanto el canvas del editor como FFmpeg. Las capas gráficas (fondo y marcos) son los mismos PNG en ambos casos.

**Exportación.** Cada pieza se renderiza por separado: cartela de transición o tramo de composición, con fotogramas exactos. Después se unen sin recodificar. El audio se monta en una sola pasada:

- voz continua;
- música por sección con fundidos cruzados de 1,5 s;
- ducking con `sidechaincompress`;
- efectos en cada transición;
- normalización a −14 LUFS.

Al final se verifica la resolución, el audio y la duración del MP4.

**Capítulos.** Cada capítulo empieza donde empieza su transición, según la duración real de las piezas renderizadas. El primero siempre va en 00:00. La app avisa si YouTube no los aceptaría (menos de 3 capítulos o alguno de menos de 10 s).

**Teleprompter.** Es una capa HTML sobre la vista de cámara. El lienzo que se graba solo recibe la imagen de la cámara, por eso el texto no aparece en la toma. La prueba de extremo a extremo lo comprueba midiendo la luminosidad de la zona superior de la toma grabada.

**Seguimiento por voz.** La API Web Speech de Chromium no funciona dentro de Electron porque depende de servicios de Google sin clave. Por eso se implementó con procesamiento local:

1. Un detector de voz avanza el texto al ritmo de lectura y lo detiene en los silencios.
2. Cada ~2 s se envían los últimos 4 s de audio (16 kHz) a `whisper-cli` en el equipo.
3. El texto reconocido se alinea con el guion por similitud de palabras. Así recoloca la posición, también hacia atrás cuando se repite una frase, y ajusta la velocidad estimada.

Sin Whisper instalado, el modo B funciona solo con el detector de voz y lo indica en pantalla.

**Imágenes.** Las sugerencias vienen de la API pública de **Wikimedia Commons**, que ofrece la licencia y el autor de cada archivo. Solo se muestran licencias libres (CC, dominio público), con mínimo 1200 px de ancho. Se ordenan por relevancia, fecha, resolución y proximidad a 16:9. Se descartan las marcadas como no libres y se muestran las restricciones (por ejemplo, derechos de imagen). Las miniaturas se descargan en el proceso principal: la interfaz no carga recursos externos y su política de seguridad (CSP) no cambia. La atribución se guarda con la imagen y se añade a la descripción de YouTube. Para fotos actuales de agencias el usuario sube las suyas con licencia.

**Música y efectos.** Se sintetizan en el equipo con FFmpeg: 4 estilos de música y 6 efectos, todos originales de la aplicación, sin licencias de terceros. También se pueden importar pistas propias indicando su licencia.

**Gráficos deportivos.** Los fondos se generan como SVG y se rasterizan con sharp: estadio iluminado, túnel, césped, luces, gráficos modernos y movimiento. Lo mismo ocurre con los marcos dorados, los rótulos, las cartelas y las tarjetas de estadísticas. Son diseño propio con la identidad de Once Records: verde, dorado y el sello «11».

**Miniaturas.** No se genera ninguna miniatura, por decisión del usuario. Solo se puede elegir un archivo propio al publicar («Publicar con mi miniatura»).

## 4. Funciones locales y funciones que requieren internet

| Función | Dónde se procesa |
| --- | --- |
| Proyectos, guiones, grabación, teleprompter, edición, gráficos, música, efectos, subtítulos, exportación MP4, copias de seguridad | Local, sin conexión |
| Transcripción y seguimiento por voz con Whisper | Local (se necesita internet solo la primera vez para «Instalar Whisper» en Configuración) |
| Sugerencias de imágenes | Internet: Wikimedia Commons |
| Publicación en YouTube | Internet: OAuth de Google y YouTube Data API v3 |

No hay claves privadas en la interfaz. El cliente OAuth de escritorio se guarda cifrado con `safeStorage`, en la misma bóveda que Estadísticas → Conexiones. Wikimedia Commons no requiere clave.

## 5. Limitaciones conocidas

- **YouTube.** Los proyectos de Google Cloud sin auditoría solo pueden subir videos privados; la app avisa si YouTube cambió la visibilidad. La miniatura propia requiere un canal verificado. La cuota diaria de la API limita el número de subidas.
- **Ventana minimizada.** Igual que en el apartado 1, si la ventana se minimiza durante la grabación, Chromium puede reducir los fotogramas del lienzo. Conviene grabar con la ventana visible.
- **Seguimiento por voz.** La precisión depende del modelo de Whisper instalado (por defecto `base`) y del equipo. Se probó la lógica de alineación con pruebas automáticas; no se ha probado con una voz real en este entorno.
- **Imágenes recientes.** Commons tiene pocas fotos de agencia del último partido. La búsqueda prioriza lo más reciente disponible con licencia libre.
- **Música.** La música generada es sencilla (pads, percusión y arpegios). Para producciones con música orquestal, importa pistas de la Biblioteca de audio de YouTube.

## 6. Automatización: «paso el guion, grabo y el video queda listo»

| Función | Cómo funciona |
| --- | --- |
| **Piloto automático** (`backend/direct-long.cjs`) | Se activa al guardar cada toma. Prepara la copia MP4, transcribe con Whisper, corta errores, busca imágenes, crea los gráficos de los datos, compone la sección y aplica la música y la transición pedidas. Cuando todas las secciones están listas, rellena los datos de YouTube, exporta el MP4 final con su revisión y, si se activa, lo publica. Respeta las composiciones hechas a mano. Botón «Procesar ahora» para repetirlo. |
| **Corte de errores** (`backend/direct-auto.cjs`) | Alinea el guion con lo dicho: quita silencios de más de 0,8 s (deja un respiro), muletillas («eh», «mmm») e intentos fallidos. Si una frase se empieza y se repite, se conserva el último intento. Los cortes son no destructivos: aparecen en la pista «Cortes» y un clic los anula. La exportación une los tramos con fundidos de 8 ms y desplaza subtítulos, llamados y capítulos. |
| **Guion con marcas** | `[IMAGEN: …]`, `[DATO: 44 goles]`, `[MÚSICA: …]`, `[TRANSICIÓN: …]`, `[COMPOSICIÓN: A–E]`, `[PREGUNTA: …]`, `[CTA: …]`. No se leen en el teleprompter. Se sitúan en el tiempo según la palabra en la que van. El botón «Copiar instrucciones para pedir el guion a Claude» da el formato listo para usar. |
| **Voz con calidad de estudio** | Reutiliza la limpieza con IA de Studio (DeepFilterNet, se descarga verificada una vez) y los perfiles de voz existentes (natural, locutor, podcast…). Sin IA aplica filtros clásicos. |
| **Biblioteca de fotos** (`backend/direct-library.cjs`) | Fotos etiquetadas por jugador, club o estadio, compartidas entre proyectos. El piloto las usa antes que internet. Las descargadas de Commons y las etiquetadas en un proyecto se guardan solas en la biblioteca. |
| **Grabación seguida** | Al detener, la toma se guarda y, tras una cuenta atrás de 3 s (que se puede pausar), empieza la siguiente sección. Opcionalmente se detiene sola cuando el teleprompter llega al final y hay 2 s sin voz. |
| **Llamados a la acción** | Tarjetas animadas «Suscríbete» con campana, «Dale like» y «Comenta» con tu pregunta, con un clic sonoro. Salen cuando dices «suscríbete», «like» o «comenta», en las marcas `[CTA]` y `[PREGUNTA]`, en recordatorios automáticos (hacia 1:30 y al final, sin repetir) o donde las añadas. Se colocan arriba, del lado contrario al presentador, sin tapar los subtítulos. Cada una se puede quitar desde la pista «Llamados». |
| **Pantalla final** | De 5 a 20 s, con espacio para el video recomendado y el botón de suscripción. YouTube no permite colocar esos elementos por la API: se añaden en YouTube Studio. |
| **YouTube automático** | Título, descripción (gancho, pregunta, llamado y hashtags), etiquetas por entidades y primer comentario con la pregunta. Publicación programada (`publishAt`). El comentario se publica cuando el video es público; si es programado, queda pendiente y se envía al comprobar el estado. Fijarlo arriba solo es posible desde YouTube. |
| **Revisión final** | Picos de audio, silencios largos, capítulos, secciones sin grabar o sin subtítulos, llamados presentes, imágenes repetidas, secciones monótonas, duración (8 min para anuncios intermedios) y largo del título. |

Para publicar el comentario, YouTube exige el permiso `youtube.force-ssl`. La conexión de este apartado lo solicita. Si el canal se conectó antes desde Estadísticas, hay que volver a conectarlo aquí.

## 7. Criterios de aceptación y pruebas

| Criterio | Comprobación |
| --- | --- |
| Los apartados originales siguen igual | `npm test` (todas las pruebas previas en verde); `tests/direct-desktop.cjs` vuelve a Inicio y Videos largos |
| Tercer apartado independiente | `tests/direct-desktop.cjs`: menú propio, `#view` intacto |
| Cinco tipos de entrada de guion | `direct-long.test.cjs`: TXT, MD, DOCX, PDF y texto pegado |
| Secciones de Once Records | `direct-long.test.cjs` y e2e: números, títulos, texto sin separadores |
| Una toma por sección | `direct-long.test.cjs`: la toma dañada no reemplaza a la activa; la nueva sí, y la anterior se borra después |
| Teleprompter fuera de la grabación | e2e: luminosidad de la toma real con el teleprompter abierto |
| Proyectos locales recuperables y copias | `direct-long.test.cjs`: crear, renombrar, eliminar con confirmación, exportar/importar `.tar` con grabaciones |
| Distribuciones visuales a lo largo de la toma | `direct-long.test.cjs`: exportación con A, B, C, D y E en una misma toma |
| Imágenes relacionadas | `direct-long.test.cjs`: entidades, propuestas con imagen y gráfico, Wikimedia con licencias |
| Transiciones entre secciones | `direct-long.test.cjs`: duraciones y capítulos con transiciones |
| Música y efectos integrados | `direct-long.test.cjs`: nivel de audio en transiciones y secciones |
| Subtítulos sincronizados | `direct-long.test.cjs`: SRT desplazado tras la transición; ASS integrado |
| MP4 final reproducible | `direct-long.test.cjs`: 1920 × 1080, H.264 + AAC, duración verificada |
| Publicación en YouTube | `direct-long.test.cjs`: subida reanudable por bloques con corte de red simulado, capítulos y aviso de privacidad |
| Automatización completa | `direct-auto.test.cjs`: marcas, corte de errores, llamados a la acción, metadatos, biblioteca, publicación programada con comentario, y el piloto automático de toma guardada a MP4 final revisado |
| Grabación seguida | `tests/direct-desktop.cjs`: tres secciones encadenadas con una sola pulsación de «Iniciar grabación» |

Ejecución local:

```powershell
npm test               # incluye tests/direct-long.test.cjs
npm run test:direct    # Electron con cámara y micrófono simulados
```
