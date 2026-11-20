"""Movimientos de cámara para fotos: suaves, nítidos y con efectos de profundidad.

Cada fotograma se calcula con precisión de subpíxel (sin el temblor de zoompan) y se
envía a FFmpeg. Los efectos con capas separan al protagonista con un modelo U²-Net.
"""
import json
import math
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

FPS = 30
LONG_SIDE = 1080
CLASSIC = {"still", "in", "out", "pan"}
LAYERED = {"profundidad", "destacado"}
STYLES = CLASSIC | LAYERED | {"impacto"}
LIGHT = (235, 248, 255)  # luz blanca cálida (BGR)


def ease(t):
    """Arranque y frenado suaves (seno)."""
    t = min(1.0, max(0.0, t))
    return 0.5 - 0.5 * math.cos(math.pi * t)


def ease_out_back(t, s=1.4):
    t = min(1.0, max(0.0, t)) - 1
    return 1 + (s + 1) * t ** 3 + s * t ** 2


def output_size(image):
    h, w = image.shape[:2]
    scale = LONG_SIDE / max(w, h)
    return max(2, 2 * round(w * scale / 2)), max(2, 2 * round(h * scale / 2))


def camera(image, size, zoom, cx, cy, angle=0.0, dx=0.0, dy=0.0, border=cv2.BORDER_REFLECT101):
    """Vista de la imagen con zoom centrado en (cx, cy) (0-1), giro en grados y desplazamiento relativo."""
    w, h = size
    ih, iw = image.shape[:2]
    base = max(w / iw, h / ih)
    s = base * zoom
    # El centro de la vista no puede salir de la foto: limita el encuadre a lo visible.
    half_w, half_h = w / (2 * s), h / (2 * s)
    px = min(max(cx * iw + dx * iw, half_w), iw - half_w) if iw > 2 * half_w else iw / 2
    py = min(max(cy * ih + dy * ih, half_h), ih - half_h) if ih > 2 * half_h else ih / 2
    matrix = cv2.getRotationMatrix2D((px, py), angle, s)
    matrix[0, 2] += w / 2 - px
    matrix[1, 2] += h / 2 - py
    return cv2.warpAffine(image, matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=border)


def encoder(ffmpeg, destination, size):
    w, h = size
    return subprocess.Popen([ffmpeg, "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
                             "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                             "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(destination)], stdin=subprocess.PIPE)


def glow(frame, t):
    """Destello suave a mitad del clip (opción «brillo»)."""
    amount = 0.08 * math.sin(math.pi * t) ** 8
    return cv2.convertScaleAbs(frame, alpha=1.0, beta=255 * amount) if amount > 0.002 else frame


# ------------------------------------------------------------------ protagonista

def subject_mask(image, model, focus):
    """Máscara 0-1 del protagonista; elige la zona más cercana al punto de enfoque."""
    net = cv2.dnn.readNetFromONNX(str(model))
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    x = cv2.resize(rgb, (320, 320), interpolation=cv2.INTER_AREA)
    x = (x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    net.setInput(x.transpose(2, 0, 1)[None].copy())
    raw = net.forward()[0, 0]
    raw = (raw - raw.min()) / max(1e-6, float(raw.max() - raw.min()))
    mask = cv2.resize(raw, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_LINEAR)
    binary = (mask > 0.5).astype(np.uint8)
    count, labels, stats, centers = cv2.connectedComponentsWithStats(binary)
    if count <= 1:
        return None
    h, w = binary.shape
    fx, fy = focus[0] * w, focus[1] * h
    area = h * w
    # Se quedan las zonas grandes; gana la que contiene el enfoque o la más cercana a él.
    best, keep = None, np.zeros_like(binary)
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] < area * 0.01:
            continue
        inside = labels[min(h - 1, int(fy)), min(w - 1, int(fx))] == label
        distance = 0 if inside else math.hypot(centers[label][0] - fx, centers[label][1] - fy)
        if best is None or distance < best[0]:
            best = (distance, label)
    if best is None:
        return None
    keep[labels == best[1]] = 1
    # Zonas grandes cercanas al protagonista (p. ej. compañeros abrazados) se conservan.
    for label in range(1, count):
        if label != best[1] and stats[label, cv2.CC_STAT_AREA] >= area * 0.04:
            keep[labels == label] = 1
    soft = mask * cv2.dilate(keep, np.ones((15, 15), np.uint8)).astype(np.float32)
    share = float((soft > 0.5).mean())
    if share < 0.02 or share > 0.92:
        return None
    return cv2.GaussianBlur(soft, (0, 0), 1.2)


def clean_plate(image, mask):
    """Fondo sin el protagonista (se rellena el hueco) para poder mover las capas por separado."""
    h, w = image.shape[:2]
    scale = 640 / max(h, w)
    small = cv2.resize(image, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    hole = cv2.resize((mask > 0.15).astype(np.uint8) * 255, small.shape[1::-1], interpolation=cv2.INTER_NEAREST)
    hole = cv2.dilate(hole, np.ones((9, 9), np.uint8))
    filled = cv2.inpaint(small, hole, 7, cv2.INPAINT_TELEA)
    filled = cv2.resize(filled, (w, h), interpolation=cv2.INTER_CUBIC)
    alpha = cv2.GaussianBlur(cv2.resize(hole, (w, h)).astype(np.float32) / 255.0, (0, 0), 6)[..., None]
    return (image * (1 - alpha) + filled * alpha).astype(np.uint8)


def subject_center(mask):
    ys, xs = np.nonzero(mask > 0.5)
    h, w = mask.shape
    return (float(xs.mean()) / w, float(ys.mean()) / h) if len(xs) else (0.5, 0.5)


def blend(background, foreground, alpha):
    a = alpha[..., None]
    return (background.astype(np.float32) * (1 - a) + foreground.astype(np.float32) * a).astype(np.uint8)


# ------------------------------------------------------------------ estilos

def classic(image, style, size, t, focus):
    e = ease(t)
    fx, fy = focus
    if style == "still":
        return camera(image, size, 1.0, 0.5, 0.5)
    if style == "in":
        return camera(image, size, 1.0 + 0.22 * e, 0.5 + (fx - 0.5) * e, 0.5 + (fy - 0.5) * e, angle=0.8 * e)
    if style == "out":
        return camera(image, size, 1.22 - 0.22 * e, fx + (0.5 - fx) * e, fy + (0.5 - fy) * e, angle=0.8 * (1 - e))
    # Panorámica: recorre de lado a lado con un leve acercamiento.
    return camera(image, size, 1.16 + 0.04 * e, e, fy, angle=-0.4 + 0.8 * e)


def depth(layers, size, t):
    image, plate, mask, (cx, cy) = layers
    e = ease(t)
    back = camera(plate, size, 1.14 - 0.06 * e, cx, cy, dx=0.025 - 0.05 * e)
    back = cv2.GaussianBlur(back, (0, 0), 2.2)
    front = camera(image, size, 1.04 + 0.10 * e, cx, cy, dx=-0.012 + 0.024 * e, dy=0.006 - 0.012 * e)
    alpha = camera(mask, size, 1.04 + 0.10 * e, cx, cy, dx=-0.012 + 0.024 * e, dy=0.006 - 0.012 * e, border=cv2.BORDER_CONSTANT)
    return blend(back, front, np.clip(alpha, 0, 1))


def spotlight(layers, size, t, seconds):
    image, _plate, mask, (cx, cy) = layers
    zoom = 1.02 + 0.08 * ease(t)
    frame = camera(image, size, zoom, cx, cy)
    alpha = np.clip(camera(mask, size, zoom, cx, cy, border=cv2.BORDER_CONSTANT), 0, 1)
    # El fondo se apaga en el primer segundo; el protagonista queda en color con un contorno de luz.
    k = ease(min(1.0, t * seconds / 1.0))
    gray = cv2.cvtColor(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    dim = cv2.GaussianBlur(gray, (0, 0), 1.5 * k + 0.01).astype(np.float32) * (1 - 0.55 * k)
    background = (frame.astype(np.float32) * (1 - k) + dim * k).astype(np.uint8)
    out = blend(background, frame, alpha)
    edge = cv2.GaussianBlur(np.clip(cv2.dilate(alpha, np.ones((13, 13), np.uint8)) - alpha, 0, 1), (0, 0), 7)
    edge = np.clip(edge * 2.6, 0, 1) * k * (0.85 + 0.15 * math.sin(2 * math.pi * t * seconds / 1.6))
    light = np.zeros_like(out, np.float32)
    light[:] = LIGHT
    out = np.clip(out.astype(np.float32) + light * edge[..., None], 0, 255).astype(np.uint8)
    return out


def impact(image, size, t, seconds, focus):
    """Golpe de zoom con destello y sacudida al inicio; luego un avance lento."""
    s = t * seconds
    hit = 0.28
    if s < hit:
        zoom = 1.32 - 0.24 * ease_out_back(s / hit)
    else:
        zoom = 1.08 + 0.06 * ease((s - hit) / max(0.1, seconds - hit))
    shake = 0.018 * math.exp(-s * 7)
    dx, dy = shake * math.sin(s * 71), shake * math.cos(s * 53)
    frame = camera(image, size, zoom, focus[0], focus[1], angle=1.6 * math.exp(-s * 8) * math.sin(s * 40), dx=dx, dy=dy)
    if s < 0.35:  # aberración de color en el golpe
        shift = int(round(10 * (1 - s / 0.35)))
        if shift:
            b, g, r = cv2.split(frame)
            frame = cv2.merge([np.roll(b, -shift, axis=1), g, np.roll(r, shift, axis=1)])
    flash = 0.85 * math.exp(-s * 10)
    if flash > 0.01:
        frame = cv2.addWeighted(frame, 1 - flash, np.full_like(frame, 255), flash, 0)
    return frame


def render(source, destination, style, seconds, ffmpeg, options):
    if style not in STYLES:
        raise ValueError("Efecto desconocido: " + style)
    image = cv2.imread(str(source), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("No se pudo leer la foto")
    focus = options.get("focus") or [0.5, 0.5]
    size = output_size(image)
    layers = None
    if style in LAYERED:
        model = options.get("model")
        mask = subject_mask(image, model, focus) if model and Path(model).is_file() else None
        if mask is None:
            print("AVISO: no se distinguió un protagonista; se usa un acercamiento suave.", file=sys.stderr)
            style = "in"
        else:
            layers = (image, clean_plate(image, mask), mask, subject_center(mask))
    frames = max(1, int(round(seconds * FPS)))
    process = encoder(ffmpeg, destination, size)
    try:
        for index in range(frames):
            t = index / max(1, frames - 1)
            if style == "profundidad":
                frame = depth(layers, size, t)
            elif style == "destacado":
                frame = spotlight(layers, size, t, seconds)
            elif style == "impacto":
                frame = impact(image, size, t, seconds, focus)
            else:
                frame = classic(image, style, size, t, focus)
            if options.get("glow"):
                frame = glow(frame, t)
            process.stdin.write(np.ascontiguousarray(frame).tobytes())
        process.stdin.close()
        if process.wait() != 0:
            raise RuntimeError("FFmpeg no pudo crear el clip")
    finally:
        if process.poll() is None:
            process.kill()


if __name__ == "__main__":
    src, dst, effect, length, ff = sys.argv[1:6]
    render(src, dst, effect, float(length), ff, json.loads(sys.argv[6]) if len(sys.argv) > 6 else {})
