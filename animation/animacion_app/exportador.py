"""
Exportación a MP4 (H.264), MOV ProRes 4444 con alfa y secuencia PNG RGBA.

Todo se escribe primero en un archivo temporal (.parte) y solo se renombra cuando
FFmpeg termina bien: nunca queda un archivo que parezca completo estando corrupto.
"""
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path

import cv2
import numpy as np

_NOWIN = {"creationflags": 0x08000000} if sys.platform.startswith("win") else {}
_cache = {}


class ErrorExportacion(RuntimeError):
    pass


def ruta_ffmpeg():
    """FFmpeg: variable de entorno > carpeta bin/ de la app > PATH > imageio-ffmpeg."""
    if "ffmpeg" in _cache:
        return _cache["ffmpeg"]
    cand = []
    if os.environ.get("ANIMACION_FFMPEG"):
        cand.append(os.environ["ANIMACION_FFMPEG"])
    raiz = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    exe = "ffmpeg.exe" if sys.platform.startswith("win") else "ffmpeg"
    cand += [str(raiz / "bin" / exe), str(Path(sys.executable).parent / "bin" / exe)]
    w = shutil.which("ffmpeg")
    if w:
        cand.append(w)
    for c in cand:
        if c and os.path.exists(c):
            _cache["ffmpeg"] = c
            return c
    try:
        import imageio_ffmpeg
        c = imageio_ffmpeg.get_ffmpeg_exe()
        if c and os.path.exists(c):
            _cache["ffmpeg"] = c
            return c
    except Exception:
        pass
    raise ErrorExportacion("No se encontró FFmpeg. Instálalo o colócalo en la carpeta 'bin' de la aplicación.")


def _ejecutar(args, timeout=30):
    return subprocess.run([ruta_ffmpeg(), "-hide_banner", *args], capture_output=True,
                          timeout=timeout, **_NOWIN)


def codificadores_gpu():
    """Lista de codificadores H.264 por hardware que realmente funcionan aquí."""
    if "gpu" in _cache:
        return _cache["gpu"]
    ok = []
    try:
        lista = _ejecutar(["-encoders"]).stdout.decode("utf-8", "ignore")
    except Exception:
        lista = ""
    for enc in ("h264_nvenc", "h264_qsv", "h264_amf"):
        if enc not in lista:
            continue
        try:
            r = _ejecutar(["-f", "lavfi", "-i", "color=c=black:s=256x144:d=0.2", "-frames:v", "2",
                           "-c:v", enc, "-f", "null", "-"], timeout=20)
            if r.returncode == 0:
                ok.append(enc)
        except Exception:
            pass
    _cache["gpu"] = ok
    return ok


def info_hardware():
    g = codificadores_gpu()
    return ("Aceleración por GPU disponible: " + ", ".join(g)) if g else "Sin aceleración por GPU: se usará la CPU"


def ruta_unica(carpeta, nombre, ext, politica="versionar"):
    """Evita sobrescribir: nombre.ext -> nombre_v2.ext, nombre_v3.ext ..."""
    carpeta = Path(carpeta)
    carpeta.mkdir(parents=True, exist_ok=True)
    base = carpeta / f"{nombre}{ext}"
    if politica == "sobrescribir" or not base.exists():
        return base
    n = 2
    while (carpeta / f"{nombre}_v{n}{ext}").exists():
        n += 1
    return carpeta / f"{nombre}_v{n}{ext}"


def nombre_seguro(txt):
    bad = '<>:"/\\|?*'
    t = "".join("_" if c in bad else c for c in txt).strip(" .")
    return t or "animacion"


def verificar_espacio(carpeta, W, H, fps, duracion, formato):
    Path(carpeta).mkdir(parents=True, exist_ok=True)
    px = W * H
    if formato == "mp4":
        est = px * fps * duracion * 0.12
    elif formato == "mov":
        est = px * fps * duracion * 1.1
    else:
        est = px * fps * duracion * 1.6
    libre = shutil.disk_usage(carpeta).free
    if libre < est * 1.3 + 50e6:
        raise ErrorExportacion(
            f"No hay espacio suficiente en disco: se necesitan unos {est/1e9:.1f} GB y hay {libre/1e9:.1f} GB libres.")


class Salida:
    """Escritor de video. `escribir(frame)` recibe BGR (mp4) o BGRA (mov/png)."""

    def __init__(self, destino, formato, W, H, fps, calidad="Full HD", gpu="auto"):
        self.formato, self.W, self.H = formato, W, H
        self.destino = Path(destino)
        self.parte = self.destino.with_name(self.destino.name + ".parte")
        self.n = 0
        self.proc = None
        self.err = b""
        self.codec = "libx264"
        if formato == "png":
            if self.parte.exists():
                shutil.rmtree(self.parte, ignore_errors=True)
            self.parte.mkdir(parents=True)
            return
        cmd = [ruta_ffmpeg(), "-y", "-loglevel", "error", "-f", "rawvideo",
               "-pix_fmt", "bgr24" if formato == "mp4" else "bgra",
               "-s", f"{W}x{H}", "-r", str(fps), "-i", "-", "-an"]
        if formato == "mp4":
            crf = "20" if calidad == "4K" else "17"
            hw = codificadores_gpu() if gpu == "auto" else []
            if hw:
                self.codec = hw[0]
                if self.codec == "h264_nvenc":
                    cmd += ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", crf, "-b:v", "0"]
                elif self.codec == "h264_qsv":
                    cmd += ["-c:v", "h264_qsv", "-global_quality", crf]
                else:
                    cmd += ["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp",
                            "-qp_i", crf, "-qp_p", crf]
            else:
                cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", crf]
            cmd += ["-pix_fmt", "yuv420p", "-movflags", "+faststart", "-f", "mp4"]
        else:
            self.codec = "prores_ks"
            cmd += ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le",
                    "-alpha_bits", "16", "-vendor", "apl0", "-f", "mov"]
        cmd.append(str(self.parte))
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE, **_NOWIN)
        self._h = threading.Thread(target=self._leer_err, daemon=True)
        self._h.start()

    def _leer_err(self):
        try:
            self.err = self.proc.stderr.read() or b""
        except Exception:
            pass

    def escribir(self, frame):
        if self.formato == "png":
            self.n += 1
            ok, buf = cv2.imencode(".png", frame, [cv2.IMWRITE_PNG_COMPRESSION, 3])
            if not ok:
                raise ErrorExportacion("No se pudo codificar un fotograma PNG.")
            buf.tofile(str(self.parte / f"frame_{self.n:05d}.png"))
            return
        try:
            self.proc.stdin.write(np.ascontiguousarray(frame).tobytes())
            self.n += 1
        except (BrokenPipeError, OSError) as e:
            self._h.join(timeout=2)
            raise ErrorExportacion(f"FFmpeg se detuvo: {self.err.decode('utf-8', 'ignore')[-400:] or e}") from e

    def cerrar(self, ok=True):
        """ok=True: finaliza y publica el archivo. ok=False: descarta el temporal."""
        if self.formato == "png":
            if ok and self.n:
                if self.destino.exists():
                    shutil.rmtree(self.destino, ignore_errors=True)
                os.replace(self.parte, self.destino)
            else:
                shutil.rmtree(self.parte, ignore_errors=True)
            return self.destino
        try:
            if self.proc.poll() is None:
                if ok:
                    try:
                        self.proc.stdin.close()
                    except OSError:
                        pass
                    self.proc.wait(timeout=600)
                else:
                    self.proc.kill()
                    self.proc.wait()
            else:
                self.proc.wait()
        finally:
            self._h.join(timeout=3)
            for f in (self.proc.stdin, self.proc.stderr):
                try:
                    f.close()
                except Exception:
                    pass
        if not ok:
            self.parte.unlink(missing_ok=True)
            return None
        if self.proc.returncode != 0 or not self.parte.exists() or self.parte.stat().st_size < 1000:
            msg = self.err.decode("utf-8", "ignore")[-400:]
            self.parte.unlink(missing_ok=True)
            raise ErrorExportacion(f"El video no se generó correctamente. {msg}")
        os.replace(self.parte, self.destino)
        return self.destino
