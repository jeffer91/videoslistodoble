"""Preferencias del usuario, carpetas de la app, proyectos recientes y perfiles."""
import json
import os
import sys
import tempfile
from pathlib import Path


def carpeta_datos():
    if sys.platform.startswith("win"):
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    p = base / "Animacion"
    p.mkdir(parents=True, exist_ok=True)
    return p


def carpeta_documentos():
    d = Path.home() / "Documents"
    return d if d.exists() else Path.home()


class Preferencias:
    """Guarda y recuerda la configuración entre sesiones (REQ-17)."""

    def __init__(self, ruta=None):
        self.ruta = Path(ruta) if ruta else carpeta_datos() / "preferencias.json"
        self.d = {
            "ultimos_ajustes": {},
            "carpeta_exportacion": str(carpeta_documentos() / "Animacion" / "Exportaciones"),
            "carpeta_proyectos": str(carpeta_documentos() / "Animacion" / "Proyectos"),
            "carpeta_temporal": str(Path(tempfile.gettempdir()) / "Animacion"),
            "recientes": [],
            "perfiles": {},
            "gpu": "auto",            # auto | cpu
            "sobrescribir": "versionar",  # versionar | sobrescribir
            "modelo_fondo": "u2net",
        }
        self.cargar()

    def cargar(self):
        try:
            with open(self.ruta, "r", encoding="utf-8") as f:
                self.d.update(json.load(f))
        except (OSError, ValueError):
            pass

    def guardar(self):
        try:
            self.ruta.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.ruta.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.d, f, indent=2, ensure_ascii=False)
            os.replace(tmp, self.ruta)
        except OSError:
            pass

    def __getitem__(self, k):
        return self.d[k]

    def __setitem__(self, k, v):
        self.d[k] = v

    def agregar_reciente(self, ruta):
        ruta = str(ruta)
        r = [x for x in self.d["recientes"] if x != ruta]
        self.d["recientes"] = ([ruta] + r)[:12]
        self.guardar()

    def recientes_existentes(self):
        return [r for r in self.d["recientes"] if os.path.exists(r)]

    def limpiar_temporales(self):
        """Borra solo la caché temporal; nunca proyectos ni exportaciones."""
        import shutil
        t = Path(self.d["carpeta_temporal"])
        n = 0
        for sub in ("recortes", "preview"):
            p = t / sub
            if p.exists():
                shutil.rmtree(p, ignore_errors=True)
                n += 1
        return n
