"""
Generación de videos: un trabajo = una imagen + un estilo + un formato de salida.

`procesar()` es síncrono y cancelable; `Cola` ejecuta los trabajos de uno en uno en un
hilo de fondo (la interfaz nunca se bloquea) y un fallo no detiene a los demás.
"""
import copy
import itertools
import threading
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path

from . import exportador, fondo
from .config import Ajustes, Encuadre
from .motor import Animador, Render, Sujeto

_ids = itertools.count(1)

EN_COLA, PROCESANDO, LISTO, ERROR, CANCELADO = "En cola", "Procesando", "Listo", "Error", "Cancelado"


class Cancelado(Exception):
    pass


@dataclass
class Trabajo:
    imagen: str
    estilo: str                         # lapiz | pintura
    ajustes: Ajustes
    encuadre: Encuadre
    quitar_fondo: bool
    proyecto: str = "Proyecto"
    nombre: str = ""
    carpeta_exportacion: str = ""
    carpeta_temp: str = ""
    gpu: str = "auto"
    politica: str = "versionar"
    modelo_fondo: str = "u2net"
    id: int = field(default_factory=lambda: next(_ids))
    estado: str = EN_COLA
    progreso: float = 0.0
    etapa: str = ""
    salida: str = ""
    error: str = ""
    avisos: list = field(default_factory=list)

    @property
    def formato(self):
        if self.ajustes.transparente:
            return self.ajustes.formato_transparente      # mov | png
        return "mp4"

    @property
    def titulo(self):
        return f"{Path(self.imagen).stem} · {'Lápiz' if self.estilo == 'lapiz' else 'Pintura'}"

    def carpeta_destino(self):
        sub = "transparente" if self.ajustes.transparente else "con_fondo"
        return Path(self.carpeta_exportacion) / exportador.nombre_seguro(self.proyecto) / sub


def render_desde(ajustes: Ajustes, estilo, encuadre, W=None, H=None):
    a = ajustes
    w, h = (W, H) if W else a.tamano()
    return Render(estilo=estilo, W=w, H=h, fps=a.fps, duracion=a.duracion, final=a.final,
                  fondo=a.fondo_bgr(), detalle=a.detalle, velocidad=a.velocidad, encuadre=encuadre)


def cargar_sujeto(ruta, quitar, carpeta_temp, modelo="u2net", avisos=None, progreso=None):
    alpha = None
    if quitar:
        if progreso:
            progreso("Quitando fondo")
        alpha, info = fondo.obtener_alpha(ruta, carpeta_temp, modelo)
        if info.get("aviso") and avisos is not None:
            avisos.append(info["aviso"])
    return Sujeto.desde_archivo(ruta, alpha)


def procesar(t: Trabajo, cancelar: threading.Event, notificar=lambda t: None):
    """Genera el video de un trabajo. Lanza Cancelado o ErrorExportacion si falla."""
    a = t.ajustes.validar()
    t.estado, t.progreso = PROCESANDO, 0.0

    def etapa(txt, p=None):
        t.etapa = txt
        if p is not None:
            t.progreso = p
        notificar(t)

    etapa("Leyendo imagen", 0.0)
    if cancelar.is_set():
        raise Cancelado()
    suj = cargar_sujeto(t.imagen, t.quitar_fondo, t.carpeta_temp, t.modelo_fondo, t.avisos,
                        lambda s: etapa(s, 0.02))
    if cancelar.is_set():
        raise Cancelado()
    cfg = render_desde(a, t.estilo, t.encuadre)
    an = Animador(suj, cfg)
    etapa("Analizando trazos", 0.05)
    an.preparar(lambda s: etapa(s, 0.06))
    if cancelar.is_set():
        raise Cancelado()

    ext = {"mp4": ".mp4", "mov": ".mov", "png": "_png"}[t.formato]
    carpeta = t.carpeta_destino()
    exportador.verificar_espacio(carpeta, cfg.W, cfg.H, cfg.fps, cfg.duracion, t.formato)
    base = exportador.nombre_seguro(t.nombre or f"{Path(t.imagen).stem}_{t.estilo}")
    destino = exportador.ruta_unica(carpeta, base, ext, t.politica)
    salida = exportador.Salida(destino, t.formato, cfg.W, cfg.H, cfg.fps, a.calidad, t.gpu)
    ok = False
    try:
        ultimo = 0.0
        for c in an.cuadros():
            if cancelar.is_set():
                raise Cancelado()
            salida.escribir(c.img)
            t.etapa = c.etapa
            t.progreso = 0.08 + 0.92 * (c.indice + 1) / c.total
            if time.time() - ultimo > 0.15:
                ultimo = time.time()
                notificar(t)
        ok = True
    finally:
        res = salida.cerrar(ok)
    t.salida = str(res)
    t.estado, t.progreso, t.etapa = LISTO, 1.0, "Terminado"
    notificar(t)


class Cola:
    """Cola secuencial en hilo de fondo con cancelación segura."""

    def __init__(self, notificar=lambda t: None, al_terminar=lambda: None):
        self.notificar, self.al_terminar = notificar, al_terminar
        self.trabajos: list[Trabajo] = []
        self._cancel: dict[int, threading.Event] = {}
        self._hilo = None
        self._lock = threading.Lock()

    def agregar(self, t: Trabajo):
        with self._lock:
            self.trabajos.append(t)
            self._cancel[t.id] = threading.Event()
        self.notificar(t)
        self._arrancar()

    def _arrancar(self):
        with self._lock:
            if self._hilo and self._hilo.is_alive():
                return
            self._hilo = threading.Thread(target=self._bucle, daemon=True)
            self._hilo.start()

    def _siguiente(self):
        with self._lock:
            for t in self.trabajos:
                if t.estado == EN_COLA:
                    return t
        return None

    def _bucle(self):
        while True:
            t = self._siguiente()
            if t is None:
                break
            try:
                procesar(t, self._cancel[t.id], self.notificar)
            except Cancelado:
                t.estado, t.etapa = CANCELADO, "Cancelado"
            except Exception as e:
                t.estado, t.error, t.etapa = ERROR, str(e) or e.__class__.__name__, "Error"
                t.avisos.append(traceback.format_exc(limit=3))
            self.notificar(t)
        self.al_terminar()

    def cancelar(self, tid):
        ev = self._cancel.get(tid)
        for t in self.trabajos:
            if t.id == tid and t.estado == EN_COLA:
                t.estado, t.etapa = CANCELADO, "Cancelado"
                self.notificar(t)
        if ev:
            ev.set()

    def cancelar_todo(self):
        for t in list(self.trabajos):
            if t.estado in (EN_COLA, PROCESANDO):
                self.cancelar(t.id)

    def activo(self):
        return any(t.estado in (EN_COLA, PROCESANDO) for t in self.trabajos)

    def limpiar_terminados(self):
        with self._lock:
            self.trabajos = [t for t in self.trabajos if t.estado in (EN_COLA, PROCESANDO)]
