"""Utilidades de E/S seguras para Windows (rutas con tildes, ñ, etc.)."""
import os
import sys
import cv2
import numpy as np

EXTENSIONES = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


def leer_imagen(ruta):
    """Lee una imagen (BGR o BGRA). Lanza ValueError si está dañada."""
    try:
        datos = np.fromfile(str(ruta), dtype=np.uint8)
    except OSError as e:
        raise ValueError(f"No se pudo abrir el archivo: {e}") from e
    if datos.size == 0:
        raise ValueError("El archivo está vacío.")
    img = cv2.imdecode(datos, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError("Archivo dañado o formato no compatible.")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.dtype == np.uint16:
        img = (img / 257).astype(np.uint8)
    if img.shape[2] == 2:
        raise ValueError("Formato de canales no compatible.")
    return img


def escribir_imagen(ruta, img):
    ext = os.path.splitext(str(ruta))[1] or ".png"
    ok, buf = cv2.imencode(ext, img)
    if not ok:
        raise IOError("No se pudo codificar la imagen")
    buf.tofile(str(ruta))


def es_imagen(ruta):
    return str(ruta).lower().endswith(EXTENSIONES)


def abrir_carpeta(ruta):
    """Abre una carpeta en el explorador del sistema."""
    ruta = str(ruta)
    try:
        if sys.platform.startswith("win"):
            os.startfile(ruta)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            os.system(f'open "{ruta}"')
        else:
            os.system(f'xdg-open "{ruta}" >/dev/null 2>&1 &')
    except OSError:
        pass
