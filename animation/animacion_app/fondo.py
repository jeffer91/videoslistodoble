"""
Eliminación automática de fondo, 100 % local.

Usa `rembg` (modelos ONNX) cuando está instalado y el modelo existe; el modelo se
descarga una sola vez y después funciona sin internet. Si no está disponible, usa
GrabCut de OpenCV como alternativa (resultado más básico) e informa del aviso.
"""
import hashlib
import json
import os
from pathlib import Path

import cv2
import numpy as np

from .ajustes import carpeta_datos

MODELOS = ("u2net", "isnet-general-use", "silueta", "u2netp")


def carpeta_modelos():
    p = Path(os.environ.get("ANIMACION_MODELOS", carpeta_datos() / "modelos"))
    p.mkdir(parents=True, exist_ok=True)
    return p


def _rembg():
    os.environ.setdefault("U2NET_HOME", str(carpeta_modelos()))
    try:
        import rembg  # noqa: F401
        return rembg
    except Exception:
        return None


def estado():
    """Diccionario con la disponibilidad del recorte automático."""
    r = _rembg()
    modelos = []
    base = Path(os.environ.get("U2NET_HOME", carpeta_modelos()))
    for m in MODELOS:
        if list(base.rglob(f"{m}.onnx")):
            modelos.append(m)
    return {"rembg": r is not None, "modelos": modelos}


def descargar_modelo(nombre="u2net"):
    """Descarga el modelo (requiere internet solo esta vez)."""
    rembg = _rembg()
    if rembg is None:
        raise RuntimeError("rembg no está instalado (pip install rembg onnxruntime).")
    rembg.new_session(nombre)
    return nombre


def _grabcut(bgr):
    h, w = bgr.shape[:2]
    esc = 640.0 / max(h, w) if max(h, w) > 640 else 1.0
    chico = cv2.resize(bgr, (int(w * esc), int(h * esc)), interpolation=cv2.INTER_AREA)
    hh, ww = chico.shape[:2]
    mask = np.zeros((hh, ww), np.uint8)
    rect = (int(ww * 0.06), int(hh * 0.04), int(ww * 0.88), int(hh * 0.92))
    bg, fg = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(chico, mask, rect, bg, fg, 5, cv2.GC_INIT_WITH_RECT)
    a = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    a = cv2.GaussianBlur(a, (0, 0), 1.5)
    return cv2.resize(a, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0


def quitar_fondo(bgr, modelo="u2net", alta_precision=False):
    """Devuelve (alpha float32 0..1, info). info: backend, cobertura, aviso."""
    h, w = bgr.shape[:2]
    info = {"backend": "grabcut", "modelo": None, "aviso": None}
    alpha = None
    rembg = _rembg()
    if rembg is not None:
        esc = 1.0
        entrada = bgr
        if max(h, w) > 2200:
            esc = 2200.0 / max(h, w)
            entrada = cv2.resize(bgr, (int(w * esc), int(h * esc)), interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(entrada, cv2.COLOR_BGR2RGB)
        orden = [modelo] + [m for m in MODELOS if m != modelo]
        for m in orden:
            try:
                sesion = rembg.new_session(m)
                out = rembg.remove(rgb, session=sesion, alpha_matting=alta_precision,
                                   post_process_mask=True)
                a = np.asarray(out)[:, :, 3].astype(np.float32) / 255.0
                if esc != 1.0:
                    a = cv2.resize(a, (w, h), interpolation=cv2.INTER_LINEAR)
                alpha, info["backend"], info["modelo"] = a, "rembg", m
                break
            except Exception as e:  # modelo ausente / sin internet / error de ONNX
                info["aviso"] = f"No se pudo usar el modelo '{m}': {e.__class__.__name__}"
                continue
    if alpha is None:
        alpha = _grabcut(bgr)
        info["aviso"] = ("Se usó un recorte básico porque el modelo de IA no está disponible. "
                         "Instala 'rembg' y descarga el modelo para mejor calidad.")
    cob = float((alpha > 0.5).mean())
    info["cobertura"] = cob
    if cob < 0.02:
        info["aviso"] = "No se detectó un sujeto claro: el recorte es insuficiente."
    elif cob > 0.97:
        info["aviso"] = "Casi toda la imagen se consideró sujeto: el fondo no se pudo separar."
    return alpha, info


def obtener_alpha(ruta, carpeta_temp, modelo="u2net", alta_precision=False):
    """Recorte con caché en disco (no modifica el original)."""
    st = os.stat(ruta)
    clave = hashlib.sha1(f"{os.path.abspath(ruta)}|{st.st_size}|{st.st_mtime_ns}|{modelo}|{alta_precision}"
                         .encode()).hexdigest()[:20]
    d = Path(carpeta_temp) / "recortes"
    d.mkdir(parents=True, exist_ok=True)
    png, js = d / f"{clave}.png", d / f"{clave}.json"
    if png.exists() and js.exists():
        a = cv2.imdecode(np.fromfile(str(png), np.uint8), cv2.IMREAD_GRAYSCALE)
        if a is not None:
            return a.astype(np.float32) / 255.0, json.loads(js.read_text(encoding="utf-8"))
    from .util import leer_imagen
    img = leer_imagen(ruta)
    bgr = img[:, :, :3]
    alpha, info = quitar_fondo(bgr, modelo, alta_precision)
    if img.shape[2] == 4:                       # respeta transparencia previa
        alpha = np.minimum(alpha, img[:, :, 3].astype(np.float32) / 255.0)
    ok, buf = cv2.imencode(".png", (alpha * 255).astype(np.uint8))
    if ok:
        buf.tofile(str(png))
        js.write_text(json.dumps(info), encoding="utf-8")
    return alpha, info
