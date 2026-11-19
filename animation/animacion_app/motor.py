"""
Motor de animación v2.

Convierte un *sujeto* (imagen + canal alfa) en una secuencia de fotogramas donde
un lápiz o un pincel visibles dibujan el contorno, sombrean o pintan, y la
imagen termina convertida en la original a color.

Trabaja con alfa real: con fondo sólido produce fotogramas BGR; con fondo
transparente produce BGRA (alfa sin premultiplicar), listos para exportar.
"""
from dataclasses import dataclass, field

import cv2
import numpy as np

from . import recorrido as rc
from .config import Encuadre
from .util import leer_imagen

GRAFITO = np.array([66, 64, 68], np.float32) / 255.0      # lápiz (BGR)
TINTA = np.array([36, 31, 30], np.float32) / 255.0        # contorno en pintura (BGR)


# ---------------------------------------------------------------------------
# Datos de entrada
# ---------------------------------------------------------------------------

@dataclass
class Sujeto:
    bgr: np.ndarray            # HxWx3 uint8
    alpha: np.ndarray          # HxW float32 0..1

    @staticmethod
    def desde_archivo(ruta, alpha_extra=None):
        img = leer_imagen(ruta)
        if img.shape[2] == 4:
            alpha = img[:, :, 3].astype(np.float32) / 255.0
            bgr = img[:, :, :3]
        else:
            alpha = np.ones(img.shape[:2], np.float32)
            bgr = img
        if alpha_extra is not None:
            if alpha_extra.shape != alpha.shape:
                alpha_extra = cv2.resize(alpha_extra, (bgr.shape[1], bgr.shape[0]),
                                         interpolation=cv2.INTER_LINEAR)
            alpha = np.minimum(alpha, alpha_extra.astype(np.float32))
        return Sujeto(np.ascontiguousarray(bgr), alpha)

    def recortado(self, pad=0.03):
        """Recorta al sujeto cuando hay transparencia, para poder centrarlo."""
        if self.alpha.min() > 0.99:
            return self
        ys, xs = np.nonzero(self.alpha > 0.05)
        if len(xs) == 0:
            return self
        h, w = self.alpha.shape
        px, py = int((xs.max() - xs.min()) * pad) + 2, int((ys.max() - ys.min()) * pad) + 2
        x0, x1 = max(0, xs.min() - px), min(w, xs.max() + px + 1)
        y0, y1 = max(0, ys.min() - py), min(h, ys.max() + py + 1)
        return Sujeto(self.bgr[y0:y1, x0:x1].copy(), self.alpha[y0:y1, x0:x1].copy())


def colocar(suj, W, H, enc: Encuadre, margen=0.92):
    """Coloca el sujeto en un lienzo W×H según el encuadre (sin deformar)."""
    h, w = suj.alpha.shape
    if enc.modo == "rellenar":
        esc = max(W / w, H / h)
    else:
        esc = min(W * margen / w, H * margen / h)
    esc *= float(np.clip(enc.zoom, 0.1, 8.0))
    nw, nh = max(1, int(round(w * esc))), max(1, int(round(h * esc)))
    interp = cv2.INTER_AREA if esc < 1 else cv2.INTER_CUBIC
    bgr = cv2.resize(suj.bgr, (nw, nh), interpolation=interp)
    alpha = cv2.resize(suj.alpha, (nw, nh), interpolation=interp)
    x0 = int(round(W / 2 + enc.dx * W - nw / 2))
    y0 = int(round(H / 2 + enc.dy * H - nh / 2))
    color_full = np.zeros((H, W, 3), np.uint8)
    alpha_full = np.zeros((H, W), np.float32)
    xa, ya = max(0, x0), max(0, y0)
    xb, yb = min(W, x0 + nw), min(H, y0 + nh)
    if xa < xb and ya < yb:
        color_full[ya:yb, xa:xb] = bgr[ya - y0:yb - y0, xa - x0:xb - x0]
        alpha_full[ya:yb, xa:xb] = alpha[ya - y0:yb - y0, xa - x0:xb - x0]
    return color_full, alpha_full


# ---------------------------------------------------------------------------
# Configuración de un render
# ---------------------------------------------------------------------------

@dataclass
class Render:
    estilo: str = "lapiz"                 # lapiz | pintura
    W: int = 1920
    H: int = 1080
    fps: int = 30
    duracion: float = 12.0
    final: float = 2.0
    fondo: tuple | None = (232, 240, 245)  # BGR; None = transparente
    detalle: int = 5
    velocidad: str = "dinamica"
    encuadre: Encuadre = field(default_factory=Encuadre)


@dataclass
class Cuadro:
    indice: int
    total: int
    etapa: str
    img: np.ndarray            # BGR (fondo sólido) o BGRA (transparente)


# ---------------------------------------------------------------------------
# Piezas visuales
# ---------------------------------------------------------------------------

def _suave(t):
    t = float(np.clip(t, 0, 1))
    return t * t * (3 - 2 * t)


def _ruido(h, w, escala, rng):
    chico = rng.random((h // escala + 3, w // escala + 3)).astype(np.float32)
    g = cv2.resize(chico, (w, h), interpolation=cv2.INTER_CUBIC)
    g -= g.min()
    return g / max(float(g.max()), 1e-6)


def _barrido(h, w, rng, soft=0.35):
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    T = (xs / max(w, 1) * 0.5 + ys / max(h, 1) * 0.5) * 0.55 + _ruido(h, w, max(24, w // 14), rng) * 0.45
    T -= T.min()
    T /= max(float(T.max()), 1e-6)
    return T, soft


def _mascara_barrido(T, soft, t):
    return np.clip((t * (1 + soft) - T) / soft, 0, 1)


def _quad(p, d, n, a, b, ha, hb):
    return np.array([p + d * a + n * ha, p + d * b + n * hb,
                     p + d * b - n * hb, p + d * a - n * ha], np.float32)


def _tile_herramienta(tipo, s, ang_deg, color_punta):
    """Dibuja lápiz o pincel con la punta en el ancla (esquina inferior izquierda)."""
    L, pad = int(440 * s), int(26 * s)
    S = L + pad
    ax, ay = pad, S - pad
    a = np.deg2rad(ang_deg)
    d = np.array([np.cos(a), np.sin(a)], np.float32)
    n = np.array([-d[1], d[0]], np.float32)
    p = np.array([ax, ay], np.float32)
    if tipo == "lapiz":
        capas = [(0, 72, 0, 13, (170, 205, 235)), (0, 25, 0, 4.5, (70, 70, 75)),
                 (72, 330, 13, 13, (40, 190, 245)), (330, 352, 13, 13, (190, 190, 195)),
                 (352, 388, 13, 13, (150, 150, 235))]
    else:
        capas = [(0, 58, 2, 11, color_punta), (58, 128, 11, 11, (200, 200, 205)),
                 (128, 400, 11, 8, (40, 60, 150))]
    tile = np.zeros((S, S, 3), np.uint8)
    masc = np.zeros((S, S), np.uint8)
    for a0, b0, ha, hb, col in capas:
        q = _quad(p, d, n, a0 * s, b0 * s, ha * s, hb * s)
        q16 = np.round(q * 16).astype(np.int32)
        cv2.fillPoly(tile, [q16], col, cv2.LINE_AA, 4)
        cv2.fillPoly(masc, [q16], 255, cv2.LINE_AA, 4)
        cv2.polylines(tile, [q16], True, (25, 25, 30), 1, cv2.LINE_AA, 4)
        cv2.polylines(masc, [q16], True, 255, 1, cv2.LINE_AA, 4)
    return tile, masc, ax, ay, d


def _pegar_tile(frame, tile, masc, x, y, f=1.0):
    """Compone el tile (premultiplicado) sobre el fotograma BGR o BGRA."""
    h, w = frame.shape[:2]
    th, tw = masc.shape
    xa, ya = max(0, x), max(0, y)
    xb, yb = min(w, x + tw), min(h, y + th)
    if xa >= xb or ya >= yb:
        return
    t = tile[ya - y:yb - y, xa - x:xb - x].astype(np.float32) * f
    ta = masc[ya - y:yb - y, xa - x:xb - x].astype(np.float32) / 255.0 * f
    reg = frame[ya:yb, xa:xb]
    if frame.shape[2] == 3:
        reg[:] = np.clip(t + reg.astype(np.float32) * (1 - ta[..., None]), 0, 255).astype(np.uint8)
    else:
        fa = reg[..., 3].astype(np.float32) / 255.0
        oa = ta + fa * (1 - ta)
        rgb = (t + reg[..., :3].astype(np.float32) * (fa * (1 - ta))[..., None]) / np.maximum(oa, 1e-4)[..., None]
        reg[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
        reg[..., 3] = np.clip(oa * 255, 0, 255).astype(np.uint8)


class _Pluma:
    """Dibuja progresivamente un recorrido sobre uno o varios lienzos de máscara."""

    def __init__(self, rec: rc.Recorrido, shape, grosor, n_lienzos=1):
        self.rec = rec
        self.lienzos = [np.zeros(shape, np.uint8) for _ in range(n_lienzos)]
        self.i = 0
        self.grosor = grosor

    def hasta(self, k):
        k = int(min(len(self.rec), k))
        a = max(self.i, 1)
        if k > a:
            baja = self.rec.baja[a:k]
            if baja.any():
                d = np.diff(np.concatenate([[0], baja.astype(np.int8), [0]]))
                for s, e in zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)):
                    s_abs, e_abs = a + s, a + e
                    pts = np.round(self.rec.P[s_abs - 1:e_abs]).astype(np.int32)
                    lienzo = self.lienzos[int(self.rec.nivel[s_abs])]
                    cv2.polylines(lienzo, [pts.reshape(-1, 1, 2)], False, 255, self.grosor, cv2.LINE_AA)
        self.i = max(self.i, k)

    def punta(self):
        if len(self.rec) == 0:
            return None
        return self.rec.P[max(0, min(len(self.rec) - 1, self.i - 1))]


# ---------------------------------------------------------------------------
# Animador
# ---------------------------------------------------------------------------

def reparto(cfg: Render):
    """Reparto de fotogramas por etapa: (total, ini, n1, n2, n3, fin, etapas)."""
    total = int(round(cfg.duracion * cfg.fps))
    ini = int(round(min(0.3, cfg.duracion * 0.08) * cfg.fps))
    fin = int(round(min(cfg.final, cfg.duracion * 0.5) * cfg.fps))
    dib = max(6, total - ini - fin)
    fr = (0.50, 0.25, 0.25) if cfg.estilo == "lapiz" else (0.33, 0.52, 0.15)
    n1, n2 = max(2, int(dib * fr[0])), max(2, int(dib * fr[1]))
    n3 = max(2, dib - n1 - n2)
    fin = total - ini - n1 - n2 - n3
    if fin < 0:
        n3 += fin
        fin = 0
    nombres = ("Dibujo", "Sombreado" if cfg.estilo == "lapiz" else "Pintura", "Color", "Imagen final")
    a = ini
    etapas = [("Inicio", 0, ini), (nombres[0], a, a + n1), (nombres[1], a + n1, a + n1 + n2),
              (nombres[2], a + n1 + n2, a + n1 + n2 + n3), (nombres[3], a + n1 + n2 + n3, total)]
    return total, ini, n1, n2, n3, fin, etapas


class Animador:
    def __init__(self, sujeto: Sujeto, cfg: Render):
        self.cfg = cfg
        self.sujeto = sujeto.recortado()
        self.esc = max(cfg.W, cfg.H) / 1920.0
        (self.total, self.ini, self.n1, self.n2, self.n3, self.fin, self.etapas) = reparto(cfg)
        self.listo = False

    # ----------------------------------------------------------------- análisis
    def preparar(self, progreso=None):
        cfg, esc = self.cfg, self.esc
        rng = np.random.default_rng(11)

        def avisa(txt):
            if progreso:
                progreso(txt)

        avisa("Encuadrando imagen")
        color_full, alpha_full = colocar(self.sujeto, cfg.W, cfg.H, cfg.encuadre)
        ys, xs = np.nonzero(alpha_full > 0.02)
        if len(xs) == 0:
            raise ValueError("La imagen quedó fuera del encuadre o es totalmente transparente.")
        ax0, ax1, ay0, ay1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        opaca = float(alpha_full[ay0:ay1, ax0:ax1].min()) >= 0.97
        pad = 0 if opaca else 6                     # imagen rectangular completa: sin margen (evita marcos)
        x0, x1 = max(0, ax0 - pad), min(cfg.W, ax1 + pad)
        y0, y1 = max(0, ay0 - pad), min(cfg.H, ay1 + pad)
        self.roi = (x0, y0, x1 - x0, y1 - y0)
        self.cr = color_full[y0:y1, x0:x1]
        self.ar = alpha_full[y0:y1, x0:x1]
        rh, rw = self.ar.shape
        self.col_pm = (self.cr.astype(np.float32) / 255.0) * self.ar[..., None]
        self.grosor = max(1, int(round(2.3 * esc)))
        dinamico = cfg.velocidad == "dinamica"

        avisa("Analizando contornos")
        runs = rc.ordenar_runs(rc.extraer_runs(self.cr, self.ar, cfg.detalle))
        if not runs:
            raise ValueError("No se encontraron trazos. Sube el nivel de detalle.")
        self.rec_trazo = rc.construir_recorrido(runs, dinamico, esc)
        self.pluma_trazo = _Pluma(self.rec_trazo, (rh, rw), self.grosor)
        self.ink = TINTA if cfg.estilo == "pintura" else GRAFITO

        if cfg.estilo == "lapiz":
            avisa("Preparando sombreado")
            tono = rc.mapa_tono(self.cr, self.ar, esc)
            dentro = self.ar > 0.4
            base = float(np.percentile(tono[dentro], 15)) if dentro.any() else 0.0
            self.tono = np.clip((tono - base) / 0.75, 0, 1) * self.ar
            masc = rc.niveles_hachurado(tono, self.ar, esc)
            sep = max(3, int(round(7 * esc)))
            hruns, nivs = [], []
            for lvl, (m, ang, s) in enumerate(zip(masc, (45, 135, 90), (sep, sep, int(sep * 1.4)))):
                r = rc.runs_hachurado(m, ang, s, esc)
                hruns.extend(r)
                nivs.extend([lvl] * len(r))
            self.rec_sombra = rc.construir_recorrido(hruns, dinamico, esc, nivs)
            self.pluma_sombra = _Pluma(self.rec_sombra, (rh, rw), max(1, int(round(1.4 * esc))), 3)
            self.k_nivel = (0.34, 0.32, 0.30)
            self.T3, self.soft3 = _barrido(rh, rw, rng)
        else:
            avisa("Preparando pincel")
            self.banda = max(24, int(round(80 * esc)))
            runs_p = rc.runs_pintura(self.ar, self.banda, esc)
            self.rec_pintura = rc.construir_recorrido(runs_p, False, esc)
            self.pluma_pintura = _Pluma(self.rec_pintura, (rh, rw), int(self.banda * 1.45))

        self.bg = None
        if cfg.fondo is not None:
            self.bg = np.empty((rh, rw, 3), np.float32)
            self.bg[:] = np.array(cfg.fondo, np.float32) / 255.0
        self.dir = np.array([0.0, 0.0], np.float32)
        self.ultima = None
        self.listo = True

    # ------------------------------------------------------------- composición
    @staticmethod
    def _sobre(top_rgb, top_a, bot_rgb, bot_a):
        return top_rgb + bot_rgb * (1 - top_a[..., None]), top_a + bot_a * (1 - top_a)

    def _capa_ink(self, mascara, factor=1.0):
        a = mascara.astype(np.float32) / 255.0 * factor
        return self.ink * a[..., None], a

    def _frame(self, rgb_pm, a):
        """Vuelca la composición del ROI al fotograma completo (BGR o BGRA)."""
        cfg = self.cfg
        x0, y0, rw, rh = self.roi
        if cfg.fondo is not None:
            full = np.empty((cfg.H, cfg.W, 3), np.uint8)
            full[:] = np.array(cfg.fondo, np.uint8)
            out = rgb_pm + self.bg * (1 - a[..., None])
            full[y0:y0 + rh, x0:x0 + rw] = np.clip(out * 255.0 + 0.5, 0, 255).astype(np.uint8)
        else:
            full = np.zeros((cfg.H, cfg.W, 4), np.uint8)
            rgb = rgb_pm / np.maximum(a, 1e-4)[..., None]
            full[y0:y0 + rh, x0:x0 + rw, :3] = np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8)
            full[y0:y0 + rh, x0:x0 + rw, 3] = np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8)
        return full

    def _herramienta(self, full, punta, tipo, retiro=0.0):
        if punta is None:
            return
        x0, y0, _, _ = self.roi
        x, y = float(punta[0] + x0), float(punta[1] + y0)
        if self.ultima is not None:
            v = np.array([x - self.ultima[0], y - self.ultima[1]], np.float32)
            self.dir = self.dir * 0.9 + v * 0.1
        self.ultima = (x, y)
        giro = float(np.clip(self.dir[0] / (14 * self.esc), -1, 1)) * 11.0
        ang = -52.0 + giro
        col = (60, 60, 60)
        if tipo == "pincel":
            cy = int(np.clip(punta[1], 0, self.cr.shape[0] - 1))
            cx = int(np.clip(punta[0], 0, self.cr.shape[1] - 1))
            col = tuple(int(v) for v in self.cr[cy, cx])
        tile, masc, ax, ay, d = _tile_herramienta(tipo, self.esc, ang, col)
        r = _suave(retiro)
        x += d[0] * 480 * self.esc * r
        y += d[1] * 480 * self.esc * r
        _pegar_tile(full, tile, masc, int(round(x)) - ax, int(round(y)) - ay, 1.0 - r)

    # -------------------------------------------------------------- generación
    def cuadros(self):
        """Genera todos los fotogramas en orden."""
        if not self.listo:
            self.preparar()
        cfg = self.cfg
        rh, rw = self.ar.shape
        vacio_rgb = np.zeros((rh, rw, 3), np.float32)
        vacio_a = np.zeros((rh, rw), np.float32)
        idx = 0

        def emite(etapa, full):
            nonlocal idx
            c = Cuadro(idx, self.total, etapa, full)
            idx += 1
            return c

        # ---- inicio en blanco
        for _ in range(self.ini):
            yield emite("Inicio", self._frame(vacio_rgb, vacio_a))

        # ---- fase 1: contorno
        for f in range(self.n1):
            self.pluma_trazo.hasta(self.rec_trazo.indice((f + 1) / self.n1))
            rgb, a = self._capa_ink(self.pluma_trazo.lienzos[0])
            full = self._frame(rgb, a)
            self._herramienta(full, self.pluma_trazo.punta(), "lapiz")
            yield emite("Dibujo", full)
        self.pluma_trazo.hasta(len(self.rec_trazo))
        ink_rgb, ink_a = self._capa_ink(self.pluma_trazo.lienzos[0])

        if cfg.estilo == "lapiz":
            yield from self._lapiz(ink_rgb, ink_a, emite)
        else:
            yield from self._pintura(ink_rgb, ink_a, emite)

        # ---- imagen final
        final_full = self._frame(self.col_pm, self.ar)
        for _ in range(self.fin):
            yield emite("Imagen final", final_full)

    def _sombra_capa(self, prog):
        a_ni = [np.clip(k * (l.astype(np.float32) / 255.0), 0, 1) * self.ar
                for k, l in zip(self.k_nivel, self.pluma_sombra.lienzos)]
        fade = np.clip((prog - 0.35) / 0.65, 0, 1)
        a_tono = self.tono * 0.50 * fade
        restante = (1 - a_ni[0]) * (1 - a_ni[1]) * (1 - a_ni[2]) * (1 - a_tono)
        a = 1 - restante
        return GRAFITO * a[..., None], a

    def _lapiz(self, ink_rgb, ink_a, emite):
        # fase 2: sombreado a lápiz
        for f in range(self.n2):
            t = (f + 1) / self.n2
            self.pluma_sombra.hasta(self.rec_sombra.indice(t))
            s_rgb, s_a = self._sombra_capa(t)
            rgb, a = self._sobre(ink_rgb, ink_a, s_rgb, s_a)
            full = self._frame(rgb, a)
            self._herramienta(full, self.pluma_sombra.punta(), "lapiz")
            yield emite("Sombreado", full)
        self.pluma_sombra.hasta(len(self.rec_sombra))
        s_rgb, s_a = self._sombra_capa(1.0)
        lap_rgb, lap_a = self._sobre(ink_rgb, ink_a, s_rgb, s_a)
        # fase 3: el lápiz se retira y aparece el color
        nr = max(1, min(int(0.6 * self.cfg.fps), self.n3 // 2))
        punta = self.pluma_sombra.punta()
        for f in range(self.n3):
            t = _suave((f + 1) / self.n3)
            m = _mascara_barrido(self.T3, self.soft3, t)
            c_rgb, c_a = self.col_pm * m[..., None], self.ar * m
            rgb, a = self._sobre(c_rgb, c_a, lap_rgb * (1 - m[..., None]), lap_a * (1 - m))
            full = self._frame(rgb, a)
            if f < nr:
                self._herramienta(full, punta, "lapiz", retiro=(f + 1) / nr)
            yield emite("Color", full)

    def _pintura(self, ink_rgb, ink_a, emite):
        sig = max(1.5, 3.0 * self.esc)
        # fase 2: pintar con pincel
        for f in range(self.n2):
            t = (f + 1) / self.n2
            self.pluma_pintura.hasta(self.rec_pintura.indice(t))
            m = cv2.GaussianBlur(self.pluma_pintura.lienzos[0], (0, 0), sig).astype(np.float32) / 255.0
            c_rgb, c_a = self.col_pm * m[..., None], self.ar * m
            rgb, a = self._sobre(ink_rgb, ink_a, c_rgb, c_a)
            full = self._frame(rgb, a)
            self._herramienta(full, self.pluma_pintura.punta(), "pincel")
            yield emite("Pintura", full)
        punta = self.pluma_pintura.punta()
        # fase 3: el pincel se retira y se desvanece el contorno
        nr = max(1, min(int(0.6 * self.cfg.fps), self.n3 // 2))
        for f in range(self.n3):
            t = _suave((f + 1) / self.n3)
            rgb, a = self._sobre(ink_rgb * (1 - t), ink_a * (1 - t), self.col_pm, self.ar)
            full = self._frame(rgb, a)
            if f < nr:
                self._herramienta(full, punta, "pincel", retiro=(f + 1) / nr)
            yield emite("Color", full)
