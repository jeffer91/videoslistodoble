"""Configuración y constantes compartidas por la app, el motor y el CLI."""
from dataclasses import dataclass, field, asdict

LADO_CORTO = {"HD": 720, "Full HD": 1080, "4K": 2160}
ASPECTOS = ("1:1", "16:9", "9:16")
FPS_VALIDOS = (24, 30, 60)
DURACION_MIN, DURACION_MAX = 3.0, 300.0

FONDOS = {
    "papel": (232, 240, 245),   # BGR
    "blanco": (255, 255, 255),
    "negro": (20, 20, 20),
}


def tamano(aspecto, calidad):
    s = LADO_CORTO[calidad]
    if aspecto == "1:1":
        return s, s
    larga = s * 16 // 9
    return (larga, s) if aspecto == "16:9" else (s, larga)


def hex_a_bgr(txt):
    t = txt.strip().lstrip("#")
    if len(t) != 6:
        raise ValueError(f"Color no válido: {txt}")
    return (int(t[4:6], 16), int(t[2:4], 16), int(t[0:2], 16))


@dataclass
class Encuadre:
    modo: str = "encajar"      # encajar | rellenar
    zoom: float = 1.0
    dx: float = 0.0            # desplazamiento, fracción del ancho del lienzo
    dy: float = 0.0

    def a_dict(self):
        return asdict(self)

    @staticmethod
    def de_dict(d):
        e = Encuadre()
        if d:
            for k in ("modo", "zoom", "dx", "dy"):
                if k in d:
                    setattr(e, k, d[k])
        return e


@dataclass
class Ajustes:
    """Ajustes comunes a todo el proyecto/lote."""
    estilo: str = "lapiz"            # lapiz | pintura | ambos
    aspecto: str = "16:9"
    calidad: str = "Full HD"
    fps: int = 30
    duracion: float = 12.0
    final: float = 2.0
    velocidad: str = "dinamica"      # dinamica | constante
    detalle: int = 5
    quitar_fondo: bool = False
    fondo: str = "papel"             # papel | blanco | negro | color | transparente
    color_fondo: str = "#F5F0E8"
    formato_transparente: str = "mov"  # mov | png
    encuadre: Encuadre = field(default_factory=Encuadre)

    def a_dict(self):
        d = asdict(self)
        return d

    @staticmethod
    def de_dict(d):
        a = Ajustes()
        for k, v in (d or {}).items():
            if k == "encuadre":
                a.encuadre = Encuadre.de_dict(v)
            elif hasattr(a, k):
                setattr(a, k, v)
        return a

    def validar(self):
        self.duracion = float(min(max(self.duracion, DURACION_MIN), DURACION_MAX))
        self.final = float(min(max(self.final, 0.0), self.duracion * 0.5))
        self.detalle = int(min(max(self.detalle, 1), 10))
        if self.fps not in FPS_VALIDOS:
            self.fps = 30
        if self.aspecto not in ASPECTOS:
            self.aspecto = "16:9"
        if self.calidad not in LADO_CORTO:
            self.calidad = "Full HD"
        return self

    @property
    def transparente(self):
        return self.fondo == "transparente"

    def fondo_bgr(self):
        """Color de fondo BGR, o None si es transparente."""
        if self.fondo == "transparente":
            return None
        if self.fondo == "color":
            return hex_a_bgr(self.color_fondo)
        return FONDOS.get(self.fondo, FONDOS["papel"])

    def tamano(self):
        return tamano(self.aspecto, self.calidad)


PERFILES = {
    "YouTube (16:9 Full HD)": dict(aspecto="16:9", calidad="Full HD", fps=30),
    "Shorts / TikTok / Reels (9:16)": dict(aspecto="9:16", calidad="Full HD", fps=30),
    "Instagram cuadrado (1:1)": dict(aspecto="1:1", calidad="Full HD", fps=30),
    "YouTube 4K": dict(aspecto="16:9", calidad="4K", fps=30),
    "Borrador rápido (HD)": dict(calidad="HD", fps=24),
}
