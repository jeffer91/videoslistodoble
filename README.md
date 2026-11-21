# 11 Récords Studio

Aplicación de Windows para producir Shorts y compilaciones de fútbol. Edita, transcribe y renderiza localmente. Puedes importar investigación, guiones y planes de Claude Code como archivos JSON.

## Producción guiada

Desde **Inicio → Crear un Short**, escribe el título y continúa a la cámara. Guarda el gancho, el desarrollo y el cierre por separado. Puedes usar el celular o importar una toma desde las opciones de grabación. Inicio permite retomar el último Short pendiente.

En **Revisar Short**, reproduce el montaje. En Gancho o Desarrollo pulsa **Animar imagen**, elige lápiz o pintura, indica el segundo de la toma y selecciona la foto. Studio genera el clip localmente con el motor de Animación y lo incorpora a esa escena. Aprueba el montaje y exporta el MP4. La ficha, el editor detallado y el calendario siguen disponibles.

En **Videos largos**, crea una compilación semanal o por categoría. Ordena los desarrollos y continúa a la introducción y al cierre. Al revisar la compilación verás también las animaciones de cada desarrollo. La exportación horizontal conserva el mínimo de ocho minutos.

### Actualizar la copia de trabajo en Windows

Cierra Studio. En PowerShell, desde la carpeta del repositorio, ejecuta:

~~~powershell
cd D:\videoslistodoble
git pull --ff-only origin main
npm start
~~~

La primera vez que pulses **Animar imagen**, Studio descarga y prepara el motor local si hace falta. Los siguientes arranques reutilizan esa copia. Si usas un intérprete propio, puedes seleccionarlo con `RECORDS_PYTHON`. El instalador de Windows ya incluye el motor.

## Instalar en Windows

1. Descarga el instalador más reciente desde [Releases](https://github.com/jeffer91/videoslistodoble/releases). Cada versión también queda disponible en [Actions](https://github.com/jeffer91/videoslistodoble/actions/workflows/windows-build.yml).
2. Ejecuta **11 Récords Studio Setup** y selecciona una carpeta del disco **D:**.
3. Abre la aplicación. La biblioteca se crea en **D:\11-Records-Studio** y reutiliza los proyectos anteriores.
4. En **Configuración**, sitúa el respaldo en otra carpeta. Pulsa **Instalar Whisper** para descargar una vez el motor y el modelo multilingüe. En otra arquitectura puedes seleccionar manualmente los dos archivos.

El instalador se genera sin firma de editor comercial. Configuración muestra la versión instalada y permite buscar, descargar e instalar actualizaciones desde Releases. Las versiones se publican después de las pruebas sobre la aplicación instalada.

## Producir un Short

1. Crea una idea con fuente y fecha. Al aprobarla, se crea una ficha. Asigna su fecha de producción para que aparezca en Inicio.
2. Escribe el guion por escenas o impórtalo con sus etiquetas. La ficha y la biblioteca conservan la fecha, la etapa y el uso de Claude.
3. Abre el editor y graba el gancho, el desarrollo y el cierre. Elige cámara y micrófono, comprueba el medidor y usa el prompter. La captura genera archivos de 1080 × 1080. Una cámara de menor resolución se escala conservando el encuadre.
4. Pausa, reanuda, revisa y guarda la toma. Si el programa se cerró durante la captura, abre **Recuperar toma** en la ficha. Los fragmentos escritos siguen en disco. También puedes importar videos y crear una copia cuadrada con fondo desenfocado desde la biblioteca del proyecto.
5. Ajusta los cortes, fondo, marco, apoyo visual y texto de cada escena. Desde **Transcripción y plan** puedes generar subtítulos con resaltado palabra por palabra, corregir los tiempos, seleccionar un perfil de voz e insertar rótulos, gráficos y memes.
6. Aprueba las escenas, revisa el montaje y exporta. Puedes **Renderizar vista previa** para ver el montaje de FFmpeg con efectos y audio antes de exportar. La exportación verifica duración, resolución, audio, márgenes de los rótulos generados y reproducción.
7. Abre el MP4 exportado. Genera tres miniaturas y guarda título, descripción y etiquetas por red. Tras la revisión del MP4 puedes aprobar ese archivo y autorizar el envío a cada cuenta.

## Grabar con el celular

1. En Windows, abre el récord y elige **Gancho**, **Desarrollo** o **Cierre**. Dentro de **Grabación y composición**, pulsa **Grabar con celular** y **Copiar enlace**.
2. Abre tu enlace personal en Safari o Chrome en el celular. Reutiliza ese enlace con la misma instalación de Windows abierta. La [página de la grabadora](https://jeffer91.github.io/videoslistodoble/grabador/) explica cómo conectar si la abres sin el enlace personal.
3. Pulsa **Activar cámara y micrófono** en el celular y concédele acceso al navegador. Conecta tu lavalier al celular antes de activar la captura. Usa el medidor y **Probar micrófono (4 s)** en Windows para escuchar qué entrada se está usando. Si el navegador muestra varias entradas, puedes elegirla desde Windows.
4. Usa la silueta y la línea de los ojos en cualquiera de las dos pantallas. Desde Windows puedes grabar, pausar, reanudar, silenciar el micrófono y detener.
5. Al detener, el celular envía la toma automáticamente. Windows conserva el original y asigna una copia cuadrada **1080 × 1080 con audio** a la escena seleccionada al empezar. Si se interrumpe el envío, conserva abierta la grabadora o vuelve a abrir tu enlace en el mismo navegador. La toma sigue disponible para reintentar (**Transferir**) o guardar una copia en el celular.

El enlace personal da acceso a esa instalación. Guárdalo para tu propio uso. Se necesita internet para enlazar los dispositivos y una ruta WebRTC directa o por retransmisión para transferir. Si una red bloquea WebRTC, prueba con ambos dispositivos en la misma Wi-Fi. GitHub Pages sirve la interfaz y los videos se guardan en la biblioteca local, dentro de **D:\11-Records-Studio**. Mantén abierta la página del celular durante la toma.

## Videos largos

La compilación semanal propone los récords con Short exportado que aún no se usaron en otra semanal. Una compilación temática reúne los de una etiqueta y puede reutilizar récords. La app avisa cuando los desarrollos elegibles alcanzan ocho minutos.

La línea de tiempo permite reordenar los récords y grabar introducción y cierre. El render recompone el material original en 1920 × 1080 y vuelve a leer los cambios de las escenas. Desde la exportación puedes consultar los capítulos con sus tiempos. También se guardan en un TXT junto al MP4.

## Videos largos directos

Este apartado sirve para documentales, historias y análisis de varios minutos grabados directamente con la cámara. Es independiente de los Shorts y de las compilaciones. Ábrelo desde **Videos largos directos** en el menú.

1. Crea un proyecto. Se guarda en **D:\11-Records-Studio\Directos** y puedes retomarlo otro día.
2. Sube tu guion o pégalo. Se admiten PDF, Word (.docx), .txt, .md, el texto completo o un solo fragmento. Studio reconoce `━━━` y `SECCIÓN 01 · TÍTULO` y crea una sección por cada una. Los separadores no pasan al teleprompter.
3. Graba cada sección en formato cuadrado con el teleprompter:
   - **A · Automático**: con velocidad, pausa, retroceso y avance.
   - **B · Seguimiento por voz**: avanza mientras hablas. Con Whisper instalado, recoloca la posición también cuando repites una frase.
   Cada sección guarda una sola toma. Si grabas otra, la anterior se conserva hasta que la nueva queda verificada.
4. En **Edición**, cambia la distribución en cualquier momento de la toma:
   - A · presentador grande;
   - B · presentador e imagen;
   - C · presentador en una esquina;
   - D · imagen a pantalla completa;
   - E · fondo deportivo.
   **Proponer composición** analiza la narración y sugiere cambios editables. **Detectar menciones** busca fotos con licencia libre en Wikimedia Commons; también puedes subir las tuyas. Configura además la transición de cada sección.
5. En **Música y efectos**, elige la música de cada sección. Studio crea la música y los efectos en tu equipo y añade ducking automático. En **Subtítulos**, transcribe con Whisper, corrige el texto y elige si quieres el .srt o los subtítulos integrados.
6. En **Exportar y publicar**, genera una vista previa rápida o el MP4 final de 1920 × 1080 con los capítulos calculados. Después puedes publicarlo en YouTube con la autorización oficial de Google.

Con el **piloto automático** solo tienes que pasar el guion y grabar:

- **Grabación seguida**: al detener, la toma se guarda y la siguiente sección empieza tras 3 segundos.
- **Al guardar cada toma**, Studio:
  - transcribe la voz y corta silencios, muletillas y frases repetidas (se conserva el último intento);
  - limpia la voz;
  - busca fotos, primero en tu **biblioteca de fotos** y después en internet;
  - crea los gráficos de las cifras y compone la sección;
  - añade los llamados a la acción.
- **Con todo grabado**, exporta el MP4 final con pantalla final, título, descripción, etiquetas y revisión final, y puede publicarlo en YouTube o programarlo.

Pide el guion a Claude con el botón **Copiar instrucciones** para incluir marcas como `[IMAGEN: Harry Kane Bayern]`, `[DATO: 44 goles]` o `[PREGUNTA: ¿Kane ganará la Champions?]`.

Detalles técnicos, funciones locales o con internet y pruebas: [Requisitos de Videos largos directos](REQUISITOS_VIDEOS_LARGOS_DIRECTOS.md).

## Estadísticas

**Estadísticas** es una sección propia, separada de la producción, con cuatro pestañas:

| Pestaña | Para qué sirve |
| --- | --- |
| **Resumen** | Vistas, publicaciones, promedio por video, interacción y seguidores. Compara **Shorts y Reels** con **videos largos**, muestra las vistas por semana, una tarjeta por red, los videos con más vistas y qué temas y jugadores funcionan mejor. |
| **Central de datos** | Conclusiones automáticas (red más fuerte, quién crece, Shorts frente a largos, videos que despegaron o no arrancan, mejor día y hora, temas que más atraen), comparativa por red, curva de crecimiento de seguidores y vistas, el mismo récord en las cuatro redes, y videos en subida. |
| **Videos** | Tabla de todas las publicaciones con búsqueda, orden por cualquier columna y detalle con el historial de cada medición. |
| **Conexiones** | Asistente paso a paso para conectar cada red por su API oficial, con enlaces a cada página, prueba de conexión y estado del acceso. |
| **Lector de navegador** | Lectura supervisada de YouTube Studio, TikTok Studio, Instagram y Meta Business Suite para completar lo que la API no entrega. |

Todos los filtros (formato, red, período y categoría) se aplican a la vez. Se considera Short o Reel todo video de hasta 3 minutos; los publicados desde Studio usan su tipo real.

### Conectar cada red

Cada red se configura una sola vez desde **Estadísticas → Conexiones → Conectar paso a paso**. Los accesos se guardan con el cifrado del equipo y sirven también para publicar. Al mover la biblioteca a otro equipo hay que volver a conectarlas.

| Red | Qué entrega | Qué necesitas |
| --- | --- | --- |
| YouTube | Vistas, me gusta, comentarios, compartidos, minutos vistos, retención y suscriptores | Proyecto de Google Cloud con YouTube Data API v3 y YouTube Analytics API, y un cliente OAuth de escritorio. Publica la pantalla de consentimiento para que Google no pida autorizar cada 7 días. |
| Instagram | Vistas, alcance, me gusta, comentarios, guardados, compartidos y tiempo medio visto | Cuenta profesional y un token de la **API de Instagram con inicio de sesión de Instagram** (no necesita página de Facebook). Studio renueva el token de 60 días automáticamente. El método anterior con página de Facebook sigue disponible. |
| Facebook | Vistas, reacciones, comentarios, compartidos y tiempo medio visto de videos y Reels de la página | Token de página con pages_read_engagement y read_insights, ampliado en el Depurador de tokens para que no venza. |
| TikTok | Vistas, me gusta, comentarios y compartidos | App en TikTok for Developers con Login Kit y Display API (video.list) en modo Sandbox, o Ayrshare. El tiempo visto se completa con el lector de navegador. |

**Sincronizar ahora** recorre todas las páginas de resultados de cada cuenta, incluidos los videos publicados fuera de Studio. Con la app abierta se sincroniza sola una vez por semana. Cada lectura añade una medición fechada: un cero válido se conserva y un campo ausente no borra el último valor conocido. **Exportar para Claude** genera un JSON con las fechas, las métricas y su procedencia.

El **lector de navegador** abre Edge o Chrome con un perfil propio por red y prepara Python y Playwright la primera vez. Inicia sesión, abre el listado indicado y pulsa **Leer videos**. Si un video ya llegó por API, la lectura se suma a la misma ficha. Los cambios de diseño de cada red pueden afectar a la lectura y las cifras abreviadas («1,2 K») se guardan con su texto original.

Cada lectura (API o navegador) guarda una **foto diaria por red** con seguidores, vistas acumuladas y número de videos: es la base de las curvas de crecimiento. El lector de navegador recorre solo el contenido de cada red, abre la analítica de cada video y usa un diccionario común (por ejemplo, «Reacciones» = me gusta, «Favoritos» = guardados) para que las cuatro redes guarden las mismas métricas: vistas, me gusta, comentarios, compartidos, guardados, alcance, tiempo medio visto, % que vio el video completo y seguidores nuevos.

### Copia en Firebase

**Estadísticas → Conexiones → Base de datos en la nube** sube una copia a Firebase Realtime Database después de cada lectura, **sin cuentas ni inicio de sesión**:

1. Pega el bloque `firebaseConfig` de la consola de Firebase y pulsa **Conectar Firebase**.
2. Studio genera una **clave de datos** secreta y guarda todo en `estudios/<clave>`: `videos`, `mediciones` (historial con fecha), `crecimiento` (foto diaria por red) y `cuentas`.
3. En Realtime Database → Reglas, pega las reglas que muestra Studio y pulsa Publicar. Solo abren la carpeta de tu clave: quien no la conozca no puede leer ni borrar nada. Las reglas del «modo de prueba» vencen a los 30 días y después Firebase rechaza todas las escrituras. Si prefieres la base totalmente abierta, Studio también muestra esas reglas.

Para usar la misma copia en otro equipo, copia la clave de datos y pégala al conectar. La clave se guarda cifrada en el equipo y los datos locales siguen siendo la fuente principal.

El alcance y las pruebas de aceptación del módulo están en [Requisitos de Estadísticas](REQUISITOS_ESTADISTICAS.md).

### Publicación automática

**Publicación automática** (menú lateral) publica los videos que ya revisaste y aprobaste en la pantalla de entrega, en los horarios que elijas para cada red y sin repetir contenido:

- **Sin repetir:** el mismo archivo (o su huella SHA-256) solo va una vez a cada cuenta, el mismo récord solo se publica una vez por red, y si las estadísticas muestran un video con el mismo título ya publicado a mano, tampoco se programa. Un envío automático cancelado no se vuelve a programar en esa red.
- **Adaptado a cada red:** título dentro de su límite, #Shorts en YouTube, #Reels en Instagram, hashtags del récord y fijos hasta el máximo de cada red, y una frase final distinta por red.
- **Requisitos que comprueba antes de programar:** duración, formato vertical u horizontal y límites diarios (Studio se queda por debajo de los de cada plataforma).
- La app planifica cada 10 minutos mientras está abierta; la cola reintenta y registra el enlace publicado.

Por defecto Studio **publica por navegador**: abre Edge o Chrome con el perfil propio de cada red (el mismo del lector de estadísticas, con la sesión ya iniciada) y publica desde la web, como si lo hicieras tú. No hace falta conectar cuentas por API ni pasar auditorías.

| Red | Por navegador | Por API (opcional) |
| --- | --- | --- |
| YouTube | YouTube Studio: título, descripción, «No es para niños» y visibilidad. Espera a que termine la carga antes de publicar. | Bloqueado como privado hasta la auditoría de Google. |
| TikTok | TikTok Studio: texto con hashtags y Publicar cuando el video está procesado. | Borrador sin auditoría; directo con auditoría o Ayrshare. |
| Instagram | Crear → Reel con su texto y Compartir. | Reel con instagram_business_content_publish. |
| Facebook | Meta Business Suite: Reel (hasta 90 s en vertical) o video de la página, y opcionalmente también en tu grupo. | Página con pages_manage_posts; los grupos no tienen API. |

- **Probar sin publicar** (en cada red) hace todo excepto pulsar el botón final, con el último video apto. YouTube deja un borrador privado que puedes borrar.
- El lector y el publicador nunca usan el navegador a la vez: si está ocupado, la publicación espera 5 minutos.
- Si algo falla antes de publicar, el envío queda como «Falló» con una captura de la pantalla. Si ya se pulsó Publicar y no llegó la confirmación, queda como «Revisar» y no se reintenta solo, para no duplicar.
- Publicar de forma automatizada desde la web puede hacer que una red pida verificaciones; cuando una red cambia su diseño puede hacer falta ajustar el publicador.

### Publicar en las redes

Las mismas conexiones permiten publicar desde Studio.

| Red | Configuración | Portada |
| --- | --- | --- |
| YouTube | Activa YouTube Data API v3 y YouTube Analytics API en Google Cloud. Crea un cliente OAuth de escritorio y autoriza el canal desde la app. | Miniatura generada o la predeterminada del video. |
| TikTok | Vincula TikTok en un perfil de Ayrshare con acceso a su API e introduce su clave. Un cliente propio requiere los permisos de TikTok para publicar y consultar videos. | Variante generada vía Ayrshare o fotograma por tiempo. |
| Instagram | Con el token de inicio de sesión de Instagram añade instagram_business_content_publish. Con el método anterior (página de Facebook) usa instagram_basic, instagram_content_publish e instagram_manage_insights. | Fotograma o URL HTTPS de una imagen para la portada. |

TikTok reserva la publicación directa pública a clientes que cumplen sus condiciones. Los proyectos de uso interno pueden recurrir a un servicio aprobado o registrar el enlace después de publicar desde TikTok. [TikTok Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines) · [Ayrshare para TikTok](https://www.ayrshare.com/tiktok-api/)

La cola respeta la hora local del equipo y procesa publicaciones cuando la aplicación está abierta. El archivo y la cuenta autorizados se verifican antes de cada envío. Si hay un corte durante una entrega, verifica lo que recibió la red antes de reintentar. La ficha conserva los enlaces devueltos por la red o registrados por ti.

## Trabajo con Claude Code

Puedes usar el repositorio local en D con Node.js 22 o superior. Los pasos de edición y exportación funcionan con los controles de la app y los planes manuales.

~~~powershell
git clone https://github.com/jeffer91/videoslistodoble.git D:\videoslistodoble
cd D:\videoslistodoble
npm start
npm run studio -- --help
~~~

Los comandos imprimen JSON y el progreso de render va a la consola. **Ctrl+C** cancela los procesos de FFmpeg o Whisper. El tipo de compilación en los comandos es **week**.

~~~powershell
npm run studio -- list
npm run studio -- ideas D:\planes\ideas.json
npm run studio -- script ID_DEL_RECORD D:\planes\guion.json
npm run studio -- transcribe ID_DEL_RECORD
npm run studio -- handoff ID_DEL_RECORD
npm run studio -- plan ID_DEL_RECORD D:\planes\edicion.json
npm run studio -- preview short ID_DEL_RECORD
npm run studio -- render short ID_DEL_RECORD
npm run studio -- covers short ID_DEL_RECORD
npm run studio -- metrics
~~~

Plantilla del archivo de guion.

~~~json
{
  "source": "claude",
  "title": "El gol más rápido de la fecha",
  "tags": { "jugadores": ["Nombre"], "competiciones": ["Torneo"], "tipos": ["Gol rápido"] },
  "script": { "hook": "Gancho", "body": "Desarrollo", "closing": "Cierre" }
}
~~~

El plan usa segundos del original. Las escenas admitidas son hook, body y closing. En los cortes, mode acepta both, audio o video. Los recursos se referencian por el ID del archivo en el proyecto. La transcripción exportada incluye esos IDs y los tiempos para trabajar con texto.

~~~json
{
  "version": 1,
  "source": "claude",
  "voice": "limpia",
  "captions": true,
  "scenes": {
    "body": {
      "cuts": [{ "start": 2.8, "end": 3.5, "mode": "both" }],
      "texts": [{ "start": 1, "end": 3, "text": "La cifra oficial" }],
      "highlights": ["récord", "segundos"],
      "graphics": [{ "start": 1.4, "end": 4.4, "text": "La marca anterior" }],
      "memes": []
    }
  }
}
~~~

Para HyperFrames, ejecuta **npm run studio -- hyperframe ID_DEL_RECORD D:\planes\grafico.json**. El JSON puede tener title, detail, duration y format (short o wide). Desde la carpeta que devuelve el comando, ejecuta **npx hyperframes render --format webm --output grafico.webm** con HyperFrames disponible. Importa el WebM al proyecto y selecciónalo en **Añadir gráfico**. El plan manual también tiene un rótulo animado que renderiza sin HyperFrames. [Documentación de HyperFrames](https://hyperframes.app/docs/5-packages/cli)

Para ordenar una compilación, **Importar plan** acepta version, title, projectIds, intro, closing, source y transition (title o cut). Conserva los IDs de los récords de la compilación y cambia su orden. El guion de introducción y cierre aparece en el prompter de sus escenas.

## Biblioteca y pruebas

La raíz de Windows contiene **Proyectos**, **Compilaciones**, **Recursos**, **Exportaciones**, **Configuracion** y **Temporales**. Los originales se copian al importar. Los respaldos incluyen los proyectos, recetas, recursos, exportaciones y configuración. El almacén de accesos permanece ligado al equipo. Para restaurar una copia, cierra la app, conserva otra copia de los archivos que estés reemplazando y repón las carpetas en la misma raíz D.

~~~powershell
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:desktop
~~~

GitHub Actions instala y prueba la aplicación de Windows con dispositivos audiovisuales simulados. También prueba el enlace con el navegador móvil, los controles y la transferencia WebRTC con reconexión. En un equipo real, comprueba la cámara, el micrófono y la calidad del MP4 con sus propios medios. Las pruebas de publicación simulan las respuestas de las plataformas sin producir publicaciones reales.
