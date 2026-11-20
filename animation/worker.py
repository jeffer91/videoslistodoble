"""Render one project asset with the original 11 Records drawing engine."""
import json
import os
import sys
import threading
from pathlib import Path
from animacion_app.config import Ajustes, Encuadre
from animacion_app.trabajos import Trabajo, procesar

def main():
    source, destination, style, seconds, ffmpeg = sys.argv[1:6]
    import movimiento  # movimientos de cámara y efectos con capas
    if style in movimiento.STYLES:
        options = json.loads(sys.argv[6]) if len(sys.argv) > 6 else {}
        movimiento.render(source, destination, style, float(seconds), ffmpeg, options)
        return
    os.environ["ANIMACION_FFMPEG"] = ffmpeg
    options = Ajustes(estilo=style, aspecto="1:1", calidad="HD", fps=24,
                      duracion=float(seconds), final=1)
    options.validar()
    target = Path(destination)
    job = Trabajo(source, style, options, Encuadre(), False,
                  carpeta_exportacion=str(target.parent), carpeta_temp=str(target.parent))
    procesar(job, threading.Event(), lambda _: None)
    Path(job.salida).replace(target)

if __name__ == "__main__":
    main()
