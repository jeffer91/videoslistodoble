# 11 Récords Studio

Aplicación de Windows para producir Shorts y compilaciones de fútbol. Edita, transcribe y renderiza localmente. Puedes importar investigación, guiones y planes de Claude Code como archivos JSON.

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

## Conectar redes

**Configuración → Cuentas de publicación** guarda los accesos con el cifrado del equipo. Al mover la biblioteca a otro equipo se vuelven a conectar las cuentas.

| Red | Configuración | Portada |
| --- | --- | --- |
| YouTube | Activa YouTube Data API v3 y YouTube Analytics API en Google Cloud. Crea un cliente OAuth de escritorio y autoriza el canal desde la app. | Miniatura generada o la predeterminada del video. |
| TikTok | Vincula TikTok en un perfil de Ayrshare con acceso a su API e introduce su clave. Un cliente propio requiere los permisos de TikTok para publicar y consultar videos. | Variante generada vía Ayrshare o fotograma por tiempo. |
| Instagram | Usa una cuenta profesional conectada a una página de Facebook y un token de Meta para su ID de Instagram. Los permisos incluyen instagram_basic e instagram_content_publish. Para métricas añade instagram_manage_insights. | Fotograma o URL HTTPS de una imagen para la portada. |

TikTok reserva la publicación directa pública a clientes que cumplen sus condiciones. Los proyectos de uso interno pueden recurrir a un servicio aprobado o registrar el enlace después de publicar desde TikTok. [TikTok Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines) · [Ayrshare para TikTok](https://www.ayrshare.com/tiktok-api/)

La cola respeta la hora local del equipo y procesa publicaciones cuando la aplicación está abierta. El archivo y la cuenta autorizados se verifican antes de cada envío. Si hay un corte durante una entrega, verifica lo que recibió la red antes de reintentar. La ficha conserva los enlaces devueltos por la red o registrados por ti.

**Estadísticas** filtra por red, categoría y semana. Las cifras pueden sincronizarse con las cuentas conectadas o registrarse manualmente si la plataforma no las devuelve. El panel muestra vistas, me gusta, comentarios, seguidores y porcentaje medio visto cuando la cuenta lo ofrece. Exporta el JSON para que Claude prepare las siguientes ideas.

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
