'use strict';
/* Dibujo de los efectos del Short sobre el lienzo 1080×1920 (pantalla dividida, tarjetas, insignias…). */
const ShortsFx = (() => {
  const C = ShortsCore;
  const FX = ShortsEffects;
  const W = C.WIDTH, H = C.HEIGHT;
  const PANEL_H = 900;
  const GOLD = '#d5ad4b', GOLD_LIGHT = '#ffd552', GREEN = '#2fcb6b', DARK = '#06140e';
  const SANS = '"DM Sans", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const font = (weight, size) => weight + ' ' + size + 'px ' + SANS;
  const easeOut = p => 1 - Math.pow(1 - C.clamp(p, 0, 1), 3);
  const easeInOut = p => { p = C.clamp(p, 0, 1); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function sizeOf(source) {
    if (!source) return null;
    const width = source.videoWidth || source.displayWidth || source.naturalWidth || source.width;
    const height = source.videoHeight || source.displayHeight || source.naturalHeight || source.height;
    return width && height ? { width, height } : null;
  }

  /** Dibuja una imagen en modo «cover» dentro de un rectángulo, con zoom y foco vertical. */
  function cover(ctx, source, x, y, w, h, zoom = 1, focusY = 0.4) {
    const size = sizeOf(source);
    if (!size) return false;
    const crop = C.coverCrop(size.width, size.height, w, h, focusY);
    const cw = crop.sw / zoom, ch = crop.sh / zoom;
    ctx.drawImage(source, crop.sx + (crop.sw - cw) / 2, crop.sy + (crop.sh - ch) * focusY, cw, ch, x, y, w, h);
    return true;
  }

  function fitText(ctx, text, maxWidth, weight, size, min = 28) {
    let s = size;
    ctx.font = font(weight, s);
    while (s > min && ctx.measureText(text).width > maxWidth) { s -= 2; ctx.font = font(weight, s); }
    return s;
  }

  function shadowText(ctx, text, x, y, color = '#fff') {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
    ctx.fillStyle = color; ctx.fillText(text, x, y);
    ctx.restore();
  }

  /* ---------- Titular ---------- */

  /** Titular en caja blanca con texto negro (dibujado una sola vez). */
  function headlinePlate(text, style = 'caja') {
    const label = String(text || '').trim();
    if (!label) return null;
    const probe = document.createElement('canvas').getContext('2d');
    const dark = style === 'oscuro';
    const words = dark ? label.toUpperCase() : label;
    const size = dark ? 54 : 66;
    probe.font = font(dark ? 800 : 900, size);
    const lines = C.wrapLines(words, 900, s => probe.measureText(s).width, 2);
    const lineHeight = Math.round(size * 1.16), pad = dark ? 24 : 30;
    const width = Math.min(W - 60, Math.ceil(Math.max(...lines.map(l => probe.measureText(l).width))) + pad * 2);
    const height = lines.length * lineHeight + pad * 2 - (dark ? 8 : 12);
    const c = document.createElement('canvas');
    c.width = width + 20; c.height = height + 20;
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
    ctx.fillStyle = dark ? 'rgba(0,0,0,0.65)' : '#ffffff';
    roundRect(ctx, 10, 10, width, height, dark ? 16 : 26);
    ctx.fill();
    ctx.restore();
    ctx.font = font(dark ? 800 : 900, size);
    ctx.fillStyle = dark ? '#ffffff' : '#111111';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    lines.forEach((line, i) => ctx.fillText(line, 10 + width / 2, 10 + pad + i * lineHeight - (dark ? 0 : 4)));
    return c;
  }

  /* ---------- Paneles de la mitad superior ---------- */

  function panelBackground(ctx, tone = 'green') {
    const g = ctx.createLinearGradient(0, 0, W, PANEL_H);
    if (tone === 'night') { g.addColorStop(0, '#071a2b'); g.addColorStop(1, '#0b2f22'); }
    else { g.addColorStop(0, '#06140c'); g.addColorStop(1, '#0f3a22'); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, PANEL_H);
    ctx.save();
    ctx.strokeStyle = 'rgba(47,203,107,0.12)'; ctx.lineWidth = 2;
    for (let y = 0; y < PANEL_H; y += 48) for (let x = (y / 48) % 2 ? 28 : 0; x < W; x += 56) {
      ctx.beginPath();
      ctx.moveTo(x + 14, y); ctx.lineTo(x + 42, y); ctx.lineTo(x + 56, y + 24); ctx.lineTo(x + 42, y + 48); ctx.lineTo(x + 14, y + 48); ctx.lineTo(x, y + 24); ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  function credit(ctx, photo) {
    if (!photo?.credit) return;
    ctx.save();
    ctx.font = font(600, 20);
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    const text = photo.credit.length > 80 ? photo.credit.slice(0, 79) + '…' : photo.credit;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(W - w - 30, PANEL_H - 40, w + 20, 32);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(text, W - 20, PANEL_H - 14);
    ctx.restore();
  }

  function panelImage(ctx, e, t, assets, grade) {
    const photo = assets.photo(e.value);
    if (!photo) return panelText(ctx, e.value);
    const k = (t - e.start) / Math.max(0.5, e.end - e.start);
    if (grade) ctx.filter = grade;
    cover(ctx, photo.image, 0, 0, W, PANEL_H, 1 + 0.08 * k, 0.4);
    if (grade) ctx.filter = 'none';
    const g = ctx.createLinearGradient(0, PANEL_H * 0.7, 0, PANEL_H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, PANEL_H);
    credit(ctx, photo);
  }

  function panelText(ctx, text) {
    panelBackground(ctx);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const size = fitText(ctx, String(text).toUpperCase(), 940, 900, 96, 40);
    ctx.font = font(900, size);
    shadowText(ctx, String(text).toUpperCase(), W / 2, PANEL_H * 0.45, '#ffffff');
  }

  /** Contador animado: la cifra sube hasta su valor y golpea. */
  function panelCounter(ctx, e, t) {
    panelBackground(ctx);
    const n = FX.parseNumber(e.value);
    const age = t - e.start;
    const p = easeOut(age / 0.95);
    const shown = n.number === null ? n.text : n.prefix.trim() + FX.formatNumber(n.number * p, age >= 0.95 ? n.decimals : Math.min(n.decimals, 1), n.separator);
    const label = n.number === null ? '' : n.suffix.trim();
    const pulse = age >= 0.95 ? FX.popScale(age - 0.95, 1.18) : 1;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const size = fitText(ctx, shown, 900, 900, 300, 120);
    ctx.translate(W / 2, PANEL_H * 0.42);
    ctx.scale(pulse, pulse);
    ctx.font = font(900, size);
    ctx.shadowColor = 'rgba(213,173,75,0.55)'; ctx.shadowBlur = 40;
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillText(shown, 0, 0);
    ctx.restore();
    if (label) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const s = fitText(ctx, label.toUpperCase(), 900, 800, 76, 36);
      ctx.font = font(800, s);
      ctx.save(); ctx.globalAlpha = C.clamp((age - 0.25) / 0.3, 0, 1);
      shadowText(ctx, label.toUpperCase(), W / 2, PANEL_H * 0.42 + 200);
      ctx.restore();
    }
    ctx.fillStyle = GOLD; ctx.fillRect(0, 0, 18, PANEL_H);
  }

  /** Ficha de jugador: foto y datos (club, país, edad…). */
  function panelPlayer(ctx, e, t, assets, grade) {
    panelBackground(ctx);
    const [name = '', ...rows] = FX.parts(e.value);
    const photo = assets.photo(name);
    const age = t - e.start;
    const slide = (1 - easeOut(age / 0.4)) * 120;
    const px = 50, py = 110, pw = 420, ph = 600;
    ctx.save();
    roundRect(ctx, px - slide, py, pw, ph, 28); ctx.clip();
    if (photo) { if (grade) ctx.filter = grade; cover(ctx, photo.image, px - slide, py, pw, ph, 1, 0.25); ctx.filter = 'none'; }
    else { ctx.fillStyle = '#123d29'; ctx.fillRect(px - slide, py, pw, ph); ctx.fillStyle = GOLD; ctx.font = font(900, 200); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name.slice(0, 1).toUpperCase(), px - slide + pw / 2, py + ph / 2); }
    ctx.restore();
    ctx.lineWidth = 6; ctx.strokeStyle = GOLD; roundRect(ctx, px - slide, py, pw, ph, 28); ctx.stroke();
    const x = 520 + slide;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = GREEN; ctx.font = font(800, 30); ctx.fillText('FICHA', x, 170);
    const nameSize = fitText(ctx, name.toUpperCase(), 520, 900, 72, 36);
    const lines = C.wrapLines(name.toUpperCase(), 520, s => { ctx.font = font(900, nameSize); return ctx.measureText(s).width; }, 2);
    ctx.font = font(900, nameSize);
    lines.forEach((l, i) => shadowText(ctx, l, x, 250 + i * nameSize * 1.05));
    let y = 250 + lines.length * nameSize * 1.05 + 30;
    rows.slice(0, 4).forEach((row, i) => {
      const a = C.clamp((age - 0.25 - i * 0.12) / 0.25, 0, 1);
      ctx.save(); ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; roundRect(ctx, x, y - 52, 500, 72, 14); ctx.fill();
      ctx.fillStyle = GOLD; ctx.fillRect(x, y - 52, 8, 72);
      ctx.fillStyle = '#ffffff'; ctx.font = font(800, fitText(ctx, row, 460, 800, 40, 24));
      ctx.fillText(row, x + 28, y - 4);
      ctx.restore();
      y += 92;
    });
    if (photo) credit(ctx, photo);
  }

  /** Comparación VS: dos fotos con su cifra y el círculo «VS». */
  function panelVersus(ctx, e, t, assets, grade) {
    const sides = FX.parts(e.value).slice(0, 2).map(FX.splitStat);
    while (sides.length < 2) sides.push({ name: '', stat: '' });
    const age = t - e.start;
    sides.forEach((side, i) => {
      const x = i ? W / 2 : 0, slide = (1 - easeOut(age / 0.35)) * (i ? 1 : -1) * 300;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, 0, W / 2, PANEL_H); ctx.clip();
      const photo = assets.photo(side.name);
      if (photo) { if (grade) ctx.filter = grade; cover(ctx, photo.image, x + slide, 0, W / 2, PANEL_H, 1, 0.25); ctx.filter = 'none'; }
      else { ctx.fillStyle = i ? '#0f2f4a' : '#123d29'; ctx.fillRect(x, 0, W / 2, PANEL_H); }
      const g = ctx.createLinearGradient(0, PANEL_H * 0.45, 0, PANEL_H);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = g; ctx.fillRect(x, 0, W / 2, PANEL_H);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const cx = x + W / 4;
      if (side.stat) {
        const s = fitText(ctx, side.stat.toUpperCase(), 470, 900, 72, 32);
        ctx.font = font(900, s); shadowText(ctx, side.stat.toUpperCase(), cx, PANEL_H - 150, GOLD_LIGHT);
      }
      const ns = fitText(ctx, side.name.toUpperCase(), 470, 900, 54, 28);
      ctx.font = font(900, ns); shadowText(ctx, side.name.toUpperCase(), cx, PANEL_H - 80);
      ctx.restore();
    });
    ctx.fillStyle = GOLD; ctx.fillRect(W / 2 - 4, 0, 8, PANEL_H);
    const pop = FX.popScale(age - 0.2, 0.2);
    if (age > 0.2) {
      ctx.save(); ctx.translate(W / 2, PANEL_H * 0.42); ctx.scale(pop, pop);
      ctx.beginPath(); ctx.arc(0, 0, 92, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
      ctx.lineWidth = 10; ctx.strokeStyle = GOLD; ctx.stroke();
      ctx.fillStyle = GOLD_LIGHT; ctx.font = font(900, 84); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('VS', 0, 4);
      ctx.restore();
    }
  }

  /** Marcador tipo transmisión. */
  function panelScore(ctx, e, t) {
    panelBackground(ctx, 'night');
    const s = FX.parseScore(e.value);
    const age = t - e.start;
    const y = PANEL_H * 0.38, h = 170;
    const drop = (1 - easeOut(age / 0.4)) * -260;
    ctx.save(); ctx.translate(0, drop);
    // Luces de estadio.
    for (const lx of [160, W - 160]) {
      const g = ctx.createRadialGradient(lx, 60, 10, lx, 60, 420);
      g.addColorStop(0, 'rgba(255,248,214,0.55)'); g.addColorStop(1, 'rgba(255,248,214,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, PANEL_H);
    }
    const team = (name, x, w, align) => {
      ctx.fillStyle = '#0b0f0d'; roundRect(ctx, x, y, w, h, 20); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.textAlign = align; ctx.textBaseline = 'middle';
      const size = fitText(ctx, name.toUpperCase(), w - 50, 900, 64, 28);
      ctx.font = font(900, size);
      ctx.fillText(name.toUpperCase(), align === 'left' ? x + 30 : x + w - 30, y + h / 2 + 3);
    };
    team(s.home, 40, 360, 'left');
    team(s.away, W - 400, 360, 'right');
    ctx.fillStyle = GOLD; roundRect(ctx, 420, y - 20, 240, h + 40, 24); ctx.fill();
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = font(900, 110);
    ctx.fillText(s.homeScore && s.awayScore ? s.homeScore + '-' + s.awayScore : 'VS', W / 2, y + h / 2 + 6);
    if (s.note) {
      ctx.globalAlpha = C.clamp((age - 0.3) / 0.3, 0, 1);
      const ns = fitText(ctx, s.note.toUpperCase(), 900, 800, 48, 26);
      ctx.font = font(800, ns); shadowText(ctx, s.note.toUpperCase(), W / 2, y + h + 110, GOLD_LIGHT);
    }
    ctx.restore();
  }

  /* ---------- Mapa ---------- */

  const mapCache = new WeakMap();
  function mapPaths(data) {
    let entry = mapCache.get(data);
    if (!entry) {
      entry = data.paises.map(p => {
        const path = new Path2D();
        for (const ring of p.r) { path.moveTo(ring[0], -ring[1]); for (let i = 2; i < ring.length; i += 2) path.lineTo(ring[i], -ring[i + 1]); path.closePath(); }
        return { ...p, path };
      });
      mapCache.set(data, entry);
    }
    return entry;
  }

  function findCountry(data, name) {
    const q = FX.fold(name).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const list = mapPaths(data);
    return list.find(p => p.a.includes(q)) || list.find(p => p.a.some(a => a.startsWith(q) || q.startsWith(a))) || null;
  }

  /** Mapa que se acerca del mundo al país, lo ilumina y clava un marcador. */
  function panelMap(ctx, e, t, assets) {
    panelBackground(ctx, 'night');
    const data = assets.map;
    const country = data && findCountry(data, e.value);
    if (!country) return panelText(ctx, e.value);
    const list = mapPaths(data);
    const age = t - e.start;
    const k = easeInOut((age - 0.15) / 1.2);
    const [x0, y0, x1, y1] = country.b;
    const spanX = Math.max(14, (x1 - x0) * 2.2), spanY = Math.max(10, (y1 - y0) * 2.2);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const world = { cx: 10, cy: 15, sx: 360, sy: 150 };
    const view = { cx: world.cx + (cx - world.cx) * k, cy: world.cy + (cy - world.cy) * k, sx: world.sx + (spanX - world.sx) * k, sy: world.sy + (spanY - world.sy) * k };
    const lat = view.cy * Math.PI / 180, stretch = Math.max(0.35, Math.cos(lat));
    const scale = Math.min(W / (view.sx * stretch), PANEL_H / view.sy);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, PANEL_H); ctx.clip();
    ctx.translate(W / 2, PANEL_H / 2);
    ctx.scale(scale * stretch, scale);
    ctx.translate(-view.cx, view.cy);
    ctx.lineJoin = 'round';
    for (const p of list) {
      if (p === country) continue;
      ctx.fillStyle = '#1d4d35'; ctx.fill(p.path);
      ctx.lineWidth = 1.2 / scale; ctx.strokeStyle = 'rgba(6,20,14,0.9)'; ctx.stroke(p.path);
    }
    const glow = C.clamp((age - 1.1) / 0.4, 0, 1);
    ctx.fillStyle = glow > 0 ? 'rgb(' + Math.round(29 + (213 - 29) * glow) + ',' + Math.round(77 + (173 - 77) * glow) + ',' + Math.round(53 + (75 - 53) * glow) + ')' : '#1d4d35';
    ctx.fill(country.path);
    ctx.lineWidth = 3 / scale; ctx.strokeStyle = GOLD_LIGHT; ctx.stroke(country.path);
    ctx.restore();
    if (age > 1.2) {
      const drop = FX.popScale(age - 1.2, 0.3);
      const px = W / 2, py = PANEL_H / 2;
      ctx.save(); ctx.translate(px, py); ctx.scale(drop, drop);
      ctx.fillStyle = '#e53935';
      ctx.beginPath(); ctx.arc(0, -70, 34, Math.PI, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -70, 34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -70, 13, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = C.clamp((age - 1.35) / 0.3, 0, 1);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const s = fitText(ctx, country.n.toUpperCase(), 900, 900, 76, 36);
      ctx.font = font(900, s); shadowText(ctx, country.n.toUpperCase(), W / 2, PANEL_H - 90);
      ctx.globalAlpha = 1;
    }
  }

  /** Panel superior según el tipo, con entrada deslizante. Devuelve true si dibujó. */
  function drawPanel(ctx, e, t, assets, grade) {
    const age = t - e.start, left = e.end - t;
    const offset = -(1 - easeOut(age / 0.28)) * PANEL_H * 0.35 - (1 - easeOut(left / 0.2)) * PANEL_H * 0.2;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, PANEL_H); ctx.clip();
    ctx.fillStyle = DARK; ctx.fillRect(0, 0, W, PANEL_H);
    ctx.translate(0, offset);
    if (e.type === 'imagen') panelImage(ctx, e, t, assets, grade);
    else if (e.type === 'dato') panelCounter(ctx, e, t);
    else if (e.type === 'jugador') panelPlayer(ctx, e, t, assets, grade);
    else if (e.type === 'vs') panelVersus(ctx, e, t, assets, grade);
    else if (e.type === 'marcador') panelScore(ctx, e, t);
    else if (e.type === 'mapa') panelMap(ctx, e, t, assets);
    ctx.restore();
    ctx.fillStyle = GOLD; ctx.fillRect(0, PANEL_H - 3, W, 6);
  }

  /* ---------- Capas sobre el presentador ---------- */

  /** Visor de cámara: píldora REC con punto que parpadea y cuatro esquinas. */
  function drawRec(ctx, e, t, rect, pillY) {
    const a = FX.presence(e, t, 0.2, 0.2);
    if (!a) return;
    ctx.save(); ctx.globalAlpha = a;
    const inset = 40, len = 120, x0 = rect.x + inset, y0 = Math.max(rect.y + inset, pillY + 110), x1 = rect.x + rect.w - inset, y1 = Math.min(rect.y + rect.h - inset, 1640);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 8; ctx.lineCap = 'square';
    for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + dy * len); ctx.lineTo(x, y); ctx.lineTo(x + dx * len, y); ctx.stroke();
    }
    pill(ctx, 60, pillY, 'REC', null, Math.sin((t - e.start) * Math.PI * 2) > -0.3);
    ctx.restore();
  }

  function pill(ctx, x, y, text, number, dot) {
    ctx.font = font(800, 50);
    const w = ctx.measureText(text).width + (number ? 160 : 150), h = 96;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(20,20,20,0.88)'; roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
    ctx.restore();
    if (number) {
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x + 50, y + h / 2, 34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.font = font(900, 46); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(number), x + 50, y + h / 2 + 2);
    } else if (dot !== undefined) {
      ctx.fillStyle = dot ? '#e53935' : 'rgba(229,57,53,0.25)'; ctx.beginPath(); ctx.arc(x + 54, y + h / 2, 17, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#ffffff'; ctx.font = font(800, 50); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + (number ? 110 : 98), y + h / 2 + 2);
  }

  /** Insignia de paso numerado «① Gancho visual». */
  function drawStep(ctx, e, t, pillY) {
    const age = t - e.start;
    const a = FX.presence(e, t, 0.15, 0.2);
    if (!a) return;
    ctx.save(); ctx.globalAlpha = a;
    ctx.translate(-(1 - easeOut(age / 0.3)) * 500, 0);
    pill(ctx, 60, pillY, String(e.value || 'Paso ' + e.number).slice(0, 34), e.number);
    ctx.restore();
  }

  /** Texto con dos pesos: línea fina y línea gruesa más grande. */
  function drawTwoWeight(ctx, e, t, centerY) {
    const [thin = '', bold = ''] = FX.parts(e.value);
    const a = FX.presence(e, t, 0.12, 0.2);
    if (!a) return;
    const age = t - e.start;
    ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ts = fitText(ctx, thin, 940, 400, 72, 34);
    ctx.font = font(400, ts);
    ctx.save(); ctx.translate(W / 2, centerY - 62); const p1 = FX.popScale(age, 0.85); ctx.scale(p1, p1); shadowText(ctx, thin, 0, 0); ctx.restore();
    if (bold && age > 0.1) {
      const bs = fitText(ctx, bold, 980, 900, 112, 44);
      ctx.font = font(900, bs);
      ctx.save(); ctx.translate(W / 2, centerY + 40); const p2 = FX.popScale(age - 0.1, 0.7); ctx.scale(p2, p2); shadowText(ctx, bold, 0, 0); ctx.restore();
    }
    ctx.restore();
  }

  /** Flecha y círculo que señalan un punto, con una etiqueta. */
  function drawArrow(ctx, e, t, target) {
    const a = FX.presence(e, t, 0.1, 0.2);
    if (!a) return;
    const age = t - e.start;
    ctx.save(); ctx.globalAlpha = a;
    const r = 120, circle = C.clamp(age / 0.35, 0, 1);
    ctx.lineWidth = 12; ctx.strokeStyle = '#ff3b30'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(target.x, target.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * circle); ctx.stroke();
    const from = { x: Math.max(120, target.x - 300), y: target.y + 300 };
    const to = { x: target.x - r * 0.75, y: target.y + r * 0.75 };
    const p = C.clamp((age - 0.2) / 0.3, 0, 1);
    if (p > 0) {
      const ex = from.x + (to.x - from.x) * p, ey = from.y + (to.y - from.y) * p;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.quadraticCurveTo(from.x - 40, (from.y + ey) / 2, ex, ey); ctx.stroke();
      if (p >= 1) {
        const ang = Math.atan2(to.y - (from.y + to.y) / 2, to.x - (from.x - 40));
        ctx.beginPath(); ctx.moveTo(to.x, to.y);
        ctx.lineTo(to.x - 46 * Math.cos(ang - 0.45), to.y - 46 * Math.sin(ang - 0.45));
        ctx.moveTo(to.x, to.y); ctx.lineTo(to.x - 46 * Math.cos(ang + 0.45), to.y - 46 * Math.sin(ang + 0.45)); ctx.stroke();
      }
    }
    if (e.value && age > 0.35) {
      const s = FX.popScale(age - 0.35);
      ctx.font = font(900, 48);
      const w = ctx.measureText(e.value).width + 44;
      ctx.save(); ctx.translate(from.x, from.y + 60); ctx.scale(s, s);
      ctx.fillStyle = '#ffffff'; roundRect(ctx, -w / 2, -38, w, 76, 18); ctx.fill();
      ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(e.value, 0, 2);
      ctx.restore();
    }
    ctx.restore();
  }

  /** Barra de progreso fina arriba. */
  function drawProgress(ctx, t, duration) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, 12);
    ctx.fillStyle = GOLD_LIGHT; ctx.fillRect(0, 0, W * C.clamp(t / Math.max(0.1, duration), 0, 1), 12);
  }

  /* ---------- Subtítulos «limpios» ---------- */

  const CLEAN = { size: 88, lineHeight: 100, maxWidth: 920, key: GOLD_LIGHT };
  const tidyWord = w => String(w).replace(/[,;:.]+$/, '');

  /** 1–3 palabras sin caja, blanco con sombra suave; las palabras clave en dorado. */
  function drawCaptionClean(ctx, state, centerY) {
    const { page, age } = state;
    const words = page.words.map(w => tidyWord(w.text)).filter(Boolean);
    if (!words.length) return;
    ctx.save();
    ctx.font = font(900, CLEAN.size);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    const space = ctx.measureText(' ').width * 0.85;
    const widths = words.map(w => ctx.measureText(w).width);
    const lines = [];
    let line = [], width = 0;
    words.forEach((w, i) => {
      const extra = line.length ? space + widths[i] : widths[i];
      if (line.length && width + extra > CLEAN.maxWidth) { lines.push({ items: line, width }); line = []; width = 0; }
      width += line.length ? space + widths[i] : widths[i]; line.push(i);
    });
    if (line.length) lines.push({ items: line, width });
    const scale = FX.popScale(age, 0.82);
    ctx.translate(W / 2, centerY); ctx.scale(scale, scale); ctx.translate(-W / 2, -centerY);
    const top = centerY - (lines.length - 1) * CLEAN.lineHeight / 2;
    lines.forEach((l, row) => {
      const fit = Math.min(1, CLEAN.maxWidth / l.width);
      let x = W / 2 - l.width * fit / 2;
      const y = top + row * CLEAN.lineHeight;
      for (const i of l.items) {
        ctx.save();
        ctx.translate(x, y); ctx.scale(fit, fit);
        ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 5;
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(words[i], 0, 0);
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = page.words[i]?.key ? CLEAN.key : '#ffffff';
        ctx.fillText(words[i], 0, 0);
        ctx.restore();
        x += (widths[i] + space) * fit;
      }
    });
    ctx.restore();
  }

  /** Corrección de color uniforme (si el navegador admite filtros en el lienzo). */
  function gradeFilter(ctx, enabled) {
    return enabled && 'filter' in ctx ? 'contrast(1.08) saturate(1.15) brightness(1.03)' : '';
  }

  return { PANEL_H, headlinePlate, drawPanel, drawRec, drawStep, drawTwoWeight, drawArrow, drawProgress, drawCaptionClean, cover, gradeFilter, findCountry, roundRect };
})();
