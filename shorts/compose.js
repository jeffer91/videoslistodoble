'use strict';
/* Dibuja cada fotograma del Short 1080×1920 con el estilo de 11 Récords. */
const ShortsCompose = (() => {
  const C = ShortsCore;
  const W = C.WIDTH, H = C.HEIGHT;
  const FRAME = { dark: '#103d2b', gold: '#d5ad4b', light: '#ffdf88' };
  const STRIP = '#2fcb6b';
  const FONT = '800 54px "DM Sans", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  function canvas(width, height) {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    return c;
  }

  function sizeOf(source) {
    if (!source) return null;
    const width = source.videoWidth || source.displayWidth || source.naturalWidth || source.width;
    const height = source.videoHeight || source.displayHeight || source.naturalHeight || source.height;
    return width && height ? { width, height } : null;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Rótulo del título, dibujado una sola vez. */
  function titlePlate(title) {
    const probe = canvas(10, 10).getContext('2d');
    probe.font = FONT;
    const lines = C.wrapLines(String(title || '').toUpperCase(), 940, s => probe.measureText(s).width, 2);
    if (!lines.length) return null;
    const lineHeight = 66, pad = 24;
    const width = Math.min(W - 40, Math.ceil(Math.max(...lines.map(l => probe.measureText(l).width))) + pad * 2);
    const height = lines.length * lineHeight + pad * 2 - 8;
    const plate = canvas(width, height);
    const ctx = plate.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    roundRect(ctx, 0, 0, width, height, 16);
    ctx.fill();
    ctx.font = FONT;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => ctx.fillText(line, width / 2, pad + i * lineHeight));
    return plate;
  }

  const CAPTION_FONT = size => '900 ' + size + 'px "Arial Black", "DM Sans", "Segoe UI", Roboto, Arial, sans-serif';
  const CAPTION = { size: 70, lineHeight: 86, maxWidth: 920, centerY: 1500, active: '#ffd552', text: '#ffffff', stroke: '#000000' };

  /** Subtítulo en mayúsculas con contorno; la palabra que se está diciendo va en dorado. */
  function drawCaption(ctx, state) {
    const { page, active, age } = state;
    ctx.save();
    ctx.font = CAPTION_FONT(CAPTION.size);
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const words = page.words.map(w => w.text.toLocaleUpperCase('es'));
    const space = ctx.measureText(' ').width;
    const widths = words.map(w => ctx.measureText(w).width);
    const lines = [];
    let line = [], width = 0;
    words.forEach((w, i) => {
      const extra = line.length ? space + widths[i] : widths[i];
      if (line.length && width + extra > CAPTION.maxWidth) { lines.push({ items: line, width }); line = []; width = 0; }
      line.push(i); width += line.length > 1 ? space + widths[i] : widths[i];
    });
    if (line.length) lines.push({ items: line, width });
    const pop = age < 0.12 ? 0.86 + 0.14 * (age / 0.12) : 1;
    const top = CAPTION.centerY - (lines.length - 1) * CAPTION.lineHeight / 2;
    ctx.translate(W / 2, CAPTION.centerY);
    ctx.scale(pop, pop);
    ctx.translate(-W / 2, -CAPTION.centerY);
    lines.forEach((l, row) => {
      const fit = Math.min(1, CAPTION.maxWidth / l.width);
      let x = W / 2 - l.width * fit / 2;
      const y = top + row * CAPTION.lineHeight;
      for (const i of l.items) {
        const isActive = i === active;
        const scale = fit * (isActive ? 1.06 : 1);
        const w = widths[i] * fit;
        ctx.save();
        ctx.translate(x + w / 2, y);
        ctx.scale(scale, scale);
        ctx.lineWidth = 12;
        ctx.strokeStyle = CAPTION.stroke;
        ctx.textAlign = 'center';
        ctx.strokeText(words[i], 0, 4);
        ctx.fillStyle = isActive ? CAPTION.active : CAPTION.text;
        ctx.fillText(words[i], 0, 4);
        ctx.restore();
        x += w + space * fit;
      }
    });
    ctx.restore();
  }

  function createComposer({ title, logo, plate, options = {}, captions = null }) {
    const titleImage = titlePlate(title);
    const small = canvas(54, 96);
    const smallCtx = small.getContext('2d');

    function background(ctx, source) {
      const size = sizeOf(source);
      if (size) {
        const crop = C.coverCrop(size.width, size.height, small.width, small.height, 0.5);
        smallCtx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, small.width, small.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(small, 0, 0, W, H);
        ctx.fillStyle = 'rgba(4,16,11,0.48)';
        ctx.fillRect(0, 0, W, H);
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#103d2b'); g.addColorStop(1, '#06140e');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }

    function presenter(ctx, source, sceneKey, zoom) {
      const r = C.presenterRect(sceneKey);
      const outer = 11, edge = 6;
      ctx.fillStyle = FRAME.dark;
      ctx.fillRect(r.x - outer, r.y - outer, r.w + outer * 2, r.h + outer * 2);
      const size = sizeOf(source);
      if (size) {
        const crop = C.coverCrop(size.width, size.height, r.w, r.h);
        const w = crop.sw / zoom, h = crop.sh / zoom;
        const sx = crop.sx + (crop.sw - w) / 2, sy = crop.sy + (crop.sh - h) * 0.4;
        ctx.drawImage(source, sx, sy, w, h, r.x, r.y, r.w, r.h);
      }
      ctx.lineWidth = edge;
      ctx.strokeStyle = FRAME.gold;
      ctx.strokeRect(r.x - outer + edge / 2, r.y - outer + edge / 2, r.w + outer * 2 - edge, r.h + outer * 2 - edge);
      ctx.lineWidth = 2;
      ctx.strokeStyle = FRAME.light;
      ctx.strokeRect(r.x - outer + edge + 1, r.y - outer + edge + 1, r.w + outer * 2 - edge * 2 - 2, r.h + outer * 2 - edge * 2 - 2);
      ctx.fillStyle = FRAME.light;
      ctx.fillRect(r.x, r.y + r.h + outer - 7, r.w, 4);
      return r;
    }

    /**
     * info: { sceneKey, segment, local, t, stamp } — stamp es el tiempo transcurrido del sello o null.
     */
    function draw(ctx, source, info) {
      ctx.save();
      background(ctx, source);
      const zoom = C.punchZoom(info.segment);
      presenter(ctx, source, info.sceneKey, zoom);
      const light = C.flash(info.segment, info.local);
      if (light > 0.01) {
        ctx.fillStyle = 'rgba(255,255,255,' + light.toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
      }
      if (titleImage) ctx.drawImage(titleImage, Math.round((W - titleImage.width) / 2), 160);
      if (captions && info.stamp === null) {
        const state = C.captionAt(captions, info.t);
        if (state) drawCaption(ctx, state);
      }
      ctx.fillStyle = STRIP;
      ctx.fillRect(0, H - 16, W, 16);
      if (logo && options.logo !== false) {
        const size = 58;
        const p = C.logoPosition(info.t, W, H, size, size);
        ctx.drawImage(logo, p.x, p.y, size, size);
      }
      if (info.stamp !== null && info.stamp !== undefined && plate) {
        const fade = Math.min(1, info.stamp / 0.2);
        ctx.fillStyle = 'rgba(0,0,0,' + (0.55 * fade).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(plate, 0, Math.round(C.stampDrop(info.stamp) * H), W, H);
      }
      ctx.restore();
    }

    return { draw };
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(Error('No se pudo cargar ' + url));
      image.src = url;
    });
  }

  return { createComposer, loadImage, canvas, sizeOf, drawCaption };
})();
