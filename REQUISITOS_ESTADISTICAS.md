# Requisitos del módulo de Estadísticas

**Objetivo.** Desde la app de videos, Jeff debe poder elegir una publicación, saber cuándo se publicó, consultar sus métricas y ver cómo han cambiado desde que Studio empezó a medirla. El alcance solicitado comprende todos los videos y todas las métricas disponibles de sus cuentas en YouTube, TikTok, Instagram y Facebook, incluidos los videos publicados fuera de Studio.

## Qué debe poder hacer el usuario

| Requisito | Criterio de aceptación |
|---|---|
| Entrar a un apartado propio y sencillo | Desde la navegación principal se abre **Estadísticas**. Las dos acciones principales son **Sincronizar por API** y **Leer desde navegador**. |
| Sincronizar las cuentas directamente | Con una cuenta autorizada, Studio recorre las páginas de resultados e incorpora videos antiguos y recientes. Se puede iniciar la consulta en el momento. Con la app abierta, la implementación también contempla una actualización semanal. |
| Usar el navegador de forma independiente | El usuario elige la red, inicia sesión, selecciona la cuenta y abre su contenido. Al pulsar **Leer videos**, Python recorre el listado y las fichas reconocidas. No hace falta conectar la API ni transcribir las cifras. |
| Reunir el catálogo completo | Se incluyen videos largos, Shorts, Reels y demás videos accesibles según la plataforma. Para verificar cobertura se comparan los identificadores con el listado de la misma cuenta, pestaña y período. Un recuento de filas leídas por sí solo no demuestra cobertura total. |
| Identificar y fechar cada publicación | Cada ficha debe identificar la red y el video mediante su ID o enlace, mostrar el título y distinguir la fecha de publicación de la fecha de cada lectura. Si la red omite la fecha de publicación, debe quedar pendiente. |
| Conservar las métricas de cada red | Guardar los indicadores comunes y los específicos que la fuente entregue, con sus nombres y unidades. Por ejemplo, vistas, Me gusta, comentarios, compartidos, alcance, guardados, tiempo de reproducción y retención. Los seguidores de la cuenta se identifican como dato de cuenta. |
| Combinar las dos fuentes | Cuando ambas reconozcan la misma publicación, debe aparecer una sola ficha. Una lectura posterior añade una medición fechada, conserva las cifras anteriores y muestra la fuente de cada valor. Un cero válido se conserva y un campo ausente no borra el último valor conocido. |
| Consultar y reutilizar los datos | La tabla permite filtrar por red, categoría y semana. **Ver detalle** muestra las métricas y el historial. La exportación JSON debe conservar las fechas, las métricas y su procedencia. |
| Reconocer una lectura parcial | Si hay errores de permisos, videos identificados sin cifras o una interfaz que el lector no reconoce, el usuario debe poder distinguir qué se recuperó. Las cifras abreviadas del navegador conservan su texto original en el historial exportado. |

## Alcance de cada conexión

| Red | Conexión directa | Recorrido que se debe comprobar en el navegador |
|---|---|---|
| YouTube | Canal autorizado, lista de subidas, contadores y métricas de Analytics según permisos | YouTube Studio → Contenido. Comprobar las pestañas Videos y Shorts por separado. |
| TikTok | Listado público de la cuenta autorizada y métricas disponibles. Existe también la opción de historial mediante Ayrshare. | TikTok Studio → Contenido. Incluir publicaciones antiguas y revisar la paginación. |
| Instagram | Videos y Reels de la cuenta profesional, con las estadísticas que permita consultar | Perfil → Reels. El lector actual parte de esa pestaña. La cobertura de otros videos del perfil debe contrastarse con la API. |
| Facebook | Videos y Reels de una página autorizada para lectura de estadísticas | Meta Business Suite → Contenido publicado. Seleccionar la página y el período que correspondan. |

## Qué está comprobado y qué falta validar

La integración de ambas vías está en `main`. Las pruebas automatizadas cubren el reconocimiento de enlaces de las cuatro redes con ejemplos, la conservación de ceros y la unión de un Reel leído por API y navegador con sus mediciones fechadas. La cobertura de todas las publicaciones y métricas de las cuentas reales sigue pendiente. Depende de los permisos, el período seleccionado y lo que cada plataforma muestre. El historial local comienza en la primera lectura.

Para aceptar la función en cada cuenta real:

1. Elegir una publicación antigua y una reciente, incluida alguna publicada fuera de Studio. En YouTube, incluir un video largo y un Short.
2. Sincronizar por API. Comparar el catálogo recuperado con el listado de la plataforma y contrastar fecha, vistas y una métrica específica en las publicaciones elegidas.
3. Repetir desde el navegador en esa misma cuenta y período. Comprobar las páginas posteriores a la primera y anotar qué publicaciones o métricas quedaron fuera.
4. Abrir la misma publicación en **Ver detalle**. Confirmar que existe una sola ficha y que se distinguen ambas lecturas. En una fecha posterior, repetir y comprobar que se conserva la medición anterior.
5. Exportar el JSON y contrastarlo con la ficha. Registrar por red el total esperado, el recuperado, los ejemplos revisados y las diferencias pendientes.
