"""
Análisis de la imagen y construcción de los recorridos del lápiz y del pincel.

Un *recorrido* es la lista de posiciones por las que pasa la punta del
instrumento. Cada punto sabe si el trazo se dibuja (lápiz apoyado) o si es un
desplazamiento en el aire, y cuánto "tiempo" cuesta (ritmo dinámico).
"""
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class Recorrido:
    P: np.ndarray        # (N,2) float32, posición de la punta
    baja: np.ndarray     # (N,) bool: el tramo (i-1 -> i) deja trazo
    w: np.ndarray        # (N,) float32, coste de tiempo del punto
    nivel: np.ndarray    # (N,) int8, capa donde se dibuja (hachurado por niveles)

    def __post_init__(self):
        self.cum = np.cumsum(self.w).astype(np.float64)

    def __len__(self):
        return len(self.P)

    def indice(self, frac):
        """Cuántos puntos se han recorrido cuando el avance es `frac` (0..1)."""
        if len(self.P) == 0:
            return 0
        objetivo = float(np.clip(frac, 0, 1)) * self.cum[-1]
        return int(np.searchsorted(self.cum, objetivo, side="left")) + (1 if frac > 0 else 0)


def _curvatura(r, k=6):
    n = len(r)
    c = np.zeros(n, np.float32)
    if n <= 2 * k + 1:
        return c
    a = r[k:-k] - r[:-2 * k]
    b = r[2 * k:] - r[k:-k]
    cruz = a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]
    punto = a[:, 0] * b[:, 0] + a[:, 1] * b[:, 1]
    ang = np.abs(np.arctan2(cruz, punto))
    c[k:-k] = np.clip(ang / (np.pi / 2), 0, 1)
    return c


def construir_recorrido(runs, dinamico=True, esc=1.0, niveles=None):
    """Une trazos sueltos en un recorrido continuo con desplazamientos suaves."""
    Ps, bs, ws, ns = [], [], [], []
    pos = None
    for idx, r in enumerate(runs):
        r = np.asarray(r, np.float32)
        if len(r) < 2:
            continue
        niv = 0 if niveles is None else int(niveles[idx])
        if pos is not None:
            d = float(np.hypot(*(r[0] - pos)))
            if d > 2:
                n = int(np.clip(d / (34 * esc), 1, 14))
                t = (np.arange(1, n) / n)[:, None].astype(np.float32)
                tr = pos + (r[0] - pos) * t
                if len(tr):
                    Ps.append(tr)
                    bs.append(np.zeros(len(tr), bool))
                    ws.append(np.full(len(tr), 0.35 if dinamico else 0.2, np.float32))
                    ns.append(np.zeros(len(tr), np.int8))
        Ps.append(r)
        b = np.ones(len(r), bool)
        b[0] = False
        bs.append(b)
        if dinamico:
            w = 0.45 + 3.2 * _curvatura(r)
        else:
            w = np.ones(len(r), np.float32)
        w[0] = 0.4
        ws.append(w.astype(np.float32))
        ns.append(np.full(len(r), niv, np.int8))
        pos = r[-1]
    if not Ps:
        z = np.zeros((0, 2), np.float32)
        return Recorrido(z, np.zeros(0, bool), np.zeros(0, np.float32), np.zeros(0, np.int8))
    return Recorrido(np.concatenate(Ps), np.concatenate(bs), np.concatenate(ws), np.concatenate(ns))


# ---------------------------------------------------------------------------
# Contornos
# ---------------------------------------------------------------------------

def _gris_sobre_blanco(color_bgr, alpha):
    g = cv2.cvtColor(color_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    return (g * alpha + 255.0 * (1 - alpha)).astype(np.uint8)


def _caras(gris):
    """Rectángulos de caras (si OpenCV trae el detector)."""
    try:
        ruta = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        import os
        if not os.path.exists(ruta):
            return []
        det = cv2.CascadeClassifier(ruta)
        if det.empty():
            return []
        h, w = gris.shape
        mn = max(40, w // 14)
        return [tuple(int(v) for v in r) for r in
                det.detectMultiScale(gris, 1.1, 5, minSize=(mn, mn))]
    except Exception:
        return []


def extraer_runs(color_bgr, alpha, detalle):
    """Trazos (polilíneas) de los contornos importantes e interiores."""
    gris = _gris_sobre_blanco(color_bgr, alpha)
    h, w = gris.shape
    suav = cv2.bilateralFilter(gris, 7, 40, 40)
    suav = cv2.GaussianBlur(suav, (0, 0), 1.2)

    lo = max(12, 120 - detalle * 10)
    bordes = cv2.Canny(suav, lo, lo * 2.5, L2gradient=True)

    # contorno del sujeto recortado (solo si hay transparencia real dentro del encuadre)
    a8 = (alpha * 255).astype(np.uint8)
    recortado = bool(alpha.min() < 0.97)
    if recortado:
        bordes |= cv2.Canny(cv2.GaussianBlur(a8, (0, 0), 1.2), 70, 180)

    # más detalle en los rostros (para conservar los rasgos)
    for (x, y, fw, fh) in _caras(suav):
        px, py = int(fw * 0.1), int(fh * 0.1)
        x0, y0 = max(0, x - px), max(0, y - py)
        x1, y1 = min(w, x + fw + px), min(h, y + fh + py)
        b = cv2.Canny(suav[y0:y1, x0:x1], max(8, lo * 0.55), max(20, lo * 1.4), L2gradient=True)
        bordes[y0:y1, x0:x1] |= b

    # limpiar lo que cae fuera del sujeto (solo hay efecto con fondo eliminado)
    if recortado:
        bordes[cv2.erode((a8 > 40).astype(np.uint8), np.ones((3, 3), np.uint8)) == 0] = 0
        bordes |= cv2.Canny(cv2.GaussianBlur(a8, (0, 0), 1.2), 70, 180)

    bordes = cv2.dilate(bordes, np.ones((3, 3), np.uint8))
    esq = cv2.ximgproc.thinning(bordes)
    cont, _ = cv2.findContours(esq, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)

    min_len = max(8, (12 - detalle) * 6)
    cont = [c[:, 0, :] for c in cont if len(c) >= min_len]
    cont.sort(key=len, reverse=True)

    visitado = np.zeros((h, w), bool)
    runs = []
    for c in cont:
        actual = []
        for (px, py) in c:
            if visitado[py, px]:
                if len(actual) >= 4:
                    runs.append(np.array(actual, np.float32))
                actual = []
                continue
            visitado[py, px] = True
            actual.append((px, py))
        if len(actual) >= 4:
            runs.append(np.array(actual, np.float32))
    return runs


def ordenar_runs(runs):
    """Orden natural: primero los contornos grandes, luego el detalle más cercano."""
    if not runs:
        return []
    largos = np.array([len(r) for r in runs])
    corte = np.percentile(largos, 70)
    grupos = [[r for r in runs if len(r) >= corte], [r for r in runs if len(r) < corte]]
    salida, pos = [], None
    for g in grupos:
        if not g:
            continue
        starts = np.array([r[0] for r in g], np.float32)
        ends = np.array([r[-1] for r in g], np.float32)
        libre = np.ones(len(g), bool)
        if pos is None:
            i = int(np.argmax([len(r) for r in g]))
            libre[i] = False
            salida.append(g[i])
            pos = g[i][-1]
        for _ in range(int(libre.sum())):
            d1 = np.where(libre, ((starts - pos) ** 2).sum(1), np.inf)
            d2 = np.where(libre, ((ends - pos) ** 2).sum(1), np.inf)
            i1, i2 = int(d1.argmin()), int(d2.argmin())
            if d1[i1] <= d2[i2]:
                i, r = i1, g[i1]
            else:
                i, r = i2, g[i2][::-1]
            libre[i] = False
            salida.append(r)
            pos = r[-1]
    return salida


# ---------------------------------------------------------------------------
# Sombreado por hachurado
# ---------------------------------------------------------------------------

def mapa_tono(color_bgr, alpha, esc):
    """Tono 0..1 (1 = muy oscuro) suavizado."""
    gris = _gris_sobre_blanco(color_bgr, alpha).astype(np.float32)
    s = max(2.0, 4.0 * esc)
    return 1.0 - cv2.GaussianBlur(gris, (0, 0), s) / 255.0


def niveles_hachurado(tono, alpha, esc, percentiles=(42, 68, 86)):
    """Máscaras binarias de las zonas que se hachuran en cada pasada."""
    dentro = alpha > 0.4
    if dentro.sum() < 50:
        return [np.zeros(tono.shape, np.uint8) for _ in percentiles]
    mascaras = []
    k = max(3, int(round(7 * esc)) | 1)
    nuc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    for p in percentiles:
        umbral = np.percentile(tono[dentro], p)
        m = ((tono >= umbral) & dentro).astype(np.uint8) * 255
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, nuc)
        mascaras.append(m)
    return mascaras


def runs_hachurado(mascara, angulo, sep, esc, paso=3.0):
    """Líneas paralelas (en serpentina) recortadas a la máscara."""
    h, w = mascara.shape
    if mascara.max() == 0:
        return []
    D = int(np.ceil(np.hypot(w, h))) + 4
    c = (w / 2.0, h / 2.0)
    M = cv2.getRotationMatrix2D(c, angulo, 1.0)
    M[0, 2] += D / 2.0 - c[0]
    M[1, 2] += D / 2.0 - c[1]
    rot = cv2.warpAffine(mascara, M, (D, D), flags=cv2.INTER_NEAREST) > 127
    Minv = cv2.invertAffineTransform(M)
    min_seg = max(5, int(8 * esc))
    runs = []
    fila = 0
    for y in range(0, D, sep):
        a = rot[y]
        if not a.any():
            continue
        d = np.diff(np.concatenate([[0], a.astype(np.int8), [0]]))
        s = np.flatnonzero(d == 1)
        e = np.flatnonzero(d == -1) - 1
        segs = [(xs, xe) for xs, xe in zip(s, e) if xe - xs >= min_seg]
        if fila % 2:
            segs = [(xe, xs) for xs, xe in segs[::-1]]
        fila += 1
        for xs, xe in segs:
            n = max(2, int(abs(xe - xs) / paso))
            xs_ = np.linspace(xs, xe, n)
            pts = np.stack([xs_, np.full(n, y, np.float64)], 1)
            ox = Minv[0, 0] * pts[:, 0] + Minv[0, 1] * pts[:, 1] + Minv[0, 2]
            oy = Minv[1, 0] * pts[:, 0] + Minv[1, 1] * pts[:, 1] + Minv[1, 2]
            runs.append(np.stack([ox, oy], 1).astype(np.float32))
    return runs


def runs_pintura(alpha, alto_banda, esc):
    """Pasadas del pincel en serpentina, solo por donde hay sujeto."""
    h, w = alpha.shape
    n = int(np.ceil(h / alto_banda))
    runs, k = [], 0
    for b in range(n):
        y0, y1 = b * alto_banda, min(h, (b + 1) * alto_banda)
        cols = np.flatnonzero((alpha[y0:y1] > 0.05).any(axis=0))
        if len(cols) == 0:
            continue
        xa = max(0, cols[0] - alto_banda * 0.3)
        xb = min(w - 1, cols[-1] + alto_banda * 0.3)
        paso = max(4.0, alto_banda * 0.30)
        x = np.arange(xa, xb + paso, paso, dtype=np.float32)
        yc = (y0 + y1) / 2.0
        y = yc + np.sin(x / (alto_banda * 1.7) + b) * alto_banda * 0.20
        r = np.stack([x, y], 1).astype(np.float32)
        if k % 2:
            r = r[::-1].copy()
        runs.append(r)
        k += 1
    return runs
