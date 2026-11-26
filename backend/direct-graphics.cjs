'use strict';
/**
 * Videos largos directos · gráficos originales de Once Records.
 * Fondos deportivos, marcos, rótulos, cartelas de transición y tarjetas de
 * estadísticas se dibujan como SVG y se rasterizan con sharp. Todo es diseño
 * propio: no hay imágenes de terceros que licenciar.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Layout = require('../renderer/direct-layout.js');

const VERSION = 3;
const GOLD = '#d4b15f', GOLD_LIGHT = '#f2d79f', GREEN = '#31c870', DARK = '#060c09';
const FONT = "'Arial Black','Segoe UI Black','Montserrat','Inter','Arial',sans-serif";
const FONT_TEXT = "'Segoe UI','Inter','Arial',sans-serif";
const { W, H } = Layout;
const PAN_W = 2016, PAN_H = 1134;

function cacheDir(root) {
  const dir = path.join(root, 'Recursos', 'Directos', 'Graficos');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/** Generador pseudoaleatorio estable para que cada fondo salga siempre igual. */
function random(seed) {
  let x = 0;
  for (const c of String(seed)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}

const building = new Map();
/** Genera un PNG una sola vez (también si se pide varias veces a la vez). */
function cached(root, key, build) {
  const hash = createHash('sha1').update(JSON.stringify({ VERSION, key })).digest('hex').slice(0, 20);
  const file = path.join(cacheDir(root), hash + '.png');
  if (fs.existsSync(file)) return Promise.resolve(file);
  if (building.has(file)) return building.get(file);
  const task = (async () => {
    const sharp = require('sharp');
    const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
    const value = await build(sharp);
    const pipeline = Buffer.isBuffer(value) || typeof value === 'string' ? sharp(Buffer.from(value)) : value;
    await pipeline.png({ compressionLevel: 6 }).toFile(tmp);
    fs.renameSync(tmp, file);
    return file;
  })().finally(() => building.delete(file));
  building.set(file, task);
  return task;
}

function badge(x, y, r) {
  return '<g transform="translate(' + x + ',' + y + ')"><circle r="' + r + '" fill="#0a1110" stroke="' + GOLD + '" stroke-width="' + Math.max(2, r * 0.12) + '"/>' +
    '<text y="' + (r * 0.36) + '" text-anchor="middle" font-family="' + FONT + '" font-weight="900" font-size="' + (r * 1.05) + '" fill="' + GOLD_LIGHT + '">11</text></g>';
}

// ── Fondos deportivos ────────────────────────────────────────────────────────
function backgroundSvg(style, w = PAN_W, h = PAN_H) {
  const rnd = random(style);
  const defs = [], body = [];
  defs.push('<radialGradient id="vig" cx="50%" cy="45%" r="75%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".75"/></radialGradient>');
  if (style === 'estadio') {
    defs.push('<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03080c"/><stop offset=".55" stop-color="#0b2a1c"/><stop offset="1" stop-color="#0f4a2a"/></linearGradient>',
      '<radialGradient id="flood" r="50%"><stop offset="0" stop-color="#fff9e6" stop-opacity="1"/><stop offset=".25" stop-color="#ffe9a8" stop-opacity=".55"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient>',
      '<linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4cf" stop-opacity=".32"/><stop offset="1" stop-color="#fff4cf" stop-opacity="0"/></linearGradient>',
      '<linearGradient id="pitch" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c7a3e"/><stop offset="1" stop-color="#0c3d20"/></linearGradient>');
    body.push('<rect width="' + w + '" height="' + h + '" fill="url(#sky)"/>');
    for (const fx of [0.12, 0.88]) {
      const cx = w * fx, cy = h * 0.14;
      body.push('<polygon points="' + (cx - 30) + ',' + cy + ' ' + (cx + 30) + ',' + cy + ' ' + (w * 0.5 + (fx < .5 ? 160 : -160)) + ',' + h * 0.82 + ' ' + (w * 0.5 + (fx < .5 ? -360 : 360)) + ',' + h * 0.82 + '" fill="url(#beam)"/>');
      body.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + h * 0.3 + '" fill="url(#flood)"/>');
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) body.push('<circle cx="' + (cx - 54 + i * 36) + '" cy="' + (cy - 24 + j * 24) + '" r="9" fill="#fffdf2"/>');
    }
    // Gradas con público.
    body.push('<path d="M0 ' + h * 0.52 + ' Q' + w / 2 + ' ' + h * 0.38 + ' ' + w + ' ' + h * 0.52 + ' L' + w + ' ' + h * 0.72 + ' L0 ' + h * 0.72 + 'Z" fill="#07140d"/>');
    for (let i = 0; i < 900; i++) {
      const x = rnd() * w, y = h * (0.5 + rnd() * 0.21);
      body.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (1.5 + rnd() * 2.2).toFixed(1) + '" fill="' + (rnd() > 0.85 ? GOLD : rnd() > 0.5 ? '#2c6b46' : '#1a3a28') + '" opacity=".8"/>');
    }
    body.push('<rect y="' + h * 0.72 + '" width="' + w + '" height="' + h * 0.28 + '" fill="url(#pitch)"/>');
    for (let i = 0; i < 10; i++) body.push('<rect x="' + i * w / 10 + '" y="' + h * 0.72 + '" width="' + w / 20 + '" height="' + h * 0.28 + '" fill="#ffffff" opacity=".035"/>');
    body.push('<path d="M0 ' + h * 0.8 + ' L' + w + ' ' + h * 0.8 + '" stroke="#fff" stroke-opacity=".35" stroke-width="5"/>');
  } else if (style === 'tunel') {
    defs.push('<radialGradient id="exit" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffffff"/><stop offset=".3" stop-color="#e9ffe9" stop-opacity=".9"/><stop offset="1" stop-color="#7cf0a5" stop-opacity="0"/></radialGradient>');
    body.push('<rect width="' + w + '" height="' + h + '" fill="#040806"/>');
    for (let i = 0; i < 16; i++) {
      const k = 1 - i / 16, rw = w * 1.15 * k, rh = h * 1.15 * k;
      body.push('<rect x="' + (w - rw) / 2 + '" y="' + (h - rh) / 2 + '" width="' + rw + '" height="' + rh + '" rx="' + 40 * k + '" fill="none" stroke="' + (i % 4 === 0 ? GOLD : '#1e5a37') + '" stroke-opacity="' + (0.15 + i * 0.03) + '" stroke-width="' + (10 * k + 2) + '"/>');
    }
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2;
      body.push('<line x1="' + w / 2 + '" y1="' + h / 2 + '" x2="' + (w / 2 + Math.cos(a) * w) + '" y2="' + (h / 2 + Math.sin(a) * w) + '" stroke="#2c8a55" stroke-opacity=".12" stroke-width="3"/>');
    }
    body.push('<ellipse cx="' + w / 2 + '" cy="' + h / 2 + '" rx="' + w * 0.2 + '" ry="' + h * 0.25 + '" fill="url(#exit)"/>');
  } else if (style === 'cesped') {
    body.push('<rect width="' + w + '" height="' + h + '" fill="#145c30"/>');
    for (let i = 0; i < 12; i++) body.push('<rect x="' + i * w / 12 + '" width="' + w / 24 + '" height="' + h + '" fill="#1d7a3f" opacity=".55"/>');
    const lines = 'stroke="#ffffff" stroke-opacity=".55" stroke-width="7" fill="none"';
    body.push('<rect x="70" y="70" width="' + (w - 140) + '" height="' + (h - 140) + '" ' + lines + '/>',
      '<line x1="' + w / 2 + '" y1="70" x2="' + w / 2 + '" y2="' + (h - 70) + '" ' + lines + '/>',
      '<circle cx="' + w / 2 + '" cy="' + h / 2 + '" r="160" ' + lines + '/>', '<circle cx="' + w / 2 + '" cy="' + h / 2 + '" r="10" fill="#fff" opacity=".6"/>',
      '<rect x="70" y="' + (h / 2 - 260) + '" width="260" height="520" ' + lines + '/>', '<rect x="' + (w - 330) + '" y="' + (h / 2 - 260) + '" width="260" height="520" ' + lines + '/>');
    for (let i = 0; i < 2500; i++) body.push('<rect x="' + (rnd() * w).toFixed(0) + '" y="' + (rnd() * h).toFixed(0) + '" width="2" height="' + (3 + rnd() * 5).toFixed(0) + '" fill="' + (rnd() > 0.5 ? '#0e4a26' : '#2a9050') + '" opacity=".5"/>');
  } else if (style === 'luces') {
    defs.push('<filter id="blur"><feGaussianBlur stdDeviation="22"/></filter>',
      '<linearGradient id="bgl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#020604"/><stop offset=".6" stop-color="#0b2416"/><stop offset="1" stop-color="#1b1406"/></linearGradient>');
    body.push('<rect width="' + w + '" height="' + h + '" fill="url(#bgl)"/>', '<g filter="url(#blur)">');
    for (let i = 0; i < 46; i++) body.push('<circle cx="' + (rnd() * w).toFixed(0) + '" cy="' + (rnd() * h).toFixed(0) + '" r="' + (30 + rnd() * 110).toFixed(0) + '" fill="' + [GOLD, GREEN, GOLD_LIGHT, '#1f8f55'][i % 4] + '" opacity="' + (0.12 + rnd() * 0.3).toFixed(2) + '"/>');
    body.push('</g>');
    for (let i = 0; i < 5; i++) body.push('<rect x="' + (-200 + i * 480) + '" y="-100" width="70" height="' + (h + 200) + '" fill="#fff6d8" opacity=".05" transform="rotate(22 ' + w / 2 + ' ' + h / 2 + ')"/>');
  } else {
    // «grafico» y «movimiento»: composición moderna con bandas diagonales y retícula.
    defs.push('<linearGradient id="bgg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#03110a"/><stop offset="1" stop-color="#0a2b19"/></linearGradient>',
      '<pattern id="hex" width="56" height="48" patternUnits="userSpaceOnUse"><path d="M14 0h28l14 24-14 24H14L0 24z" fill="none" stroke="#2b7a4d" stroke-opacity=".18" stroke-width="2"/></pattern>',
      '<linearGradient id="band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + GOLD + '" stop-opacity="0"/><stop offset=".5" stop-color="' + GOLD + '" stop-opacity=".85"/><stop offset="1" stop-color="' + GOLD + '" stop-opacity="0"/></linearGradient>');
    body.push('<rect width="' + w + '" height="' + h + '" fill="url(#bgg)"/>', '<rect width="' + w + '" height="' + h + '" fill="url(#hex)"/>');
    body.push('<g transform="rotate(-18 ' + w / 2 + ' ' + h / 2 + ')">');
    body.push('<rect x="-400" y="' + h * 0.18 + '" width="' + (w + 800) + '" height="26" fill="url(#band)"/>', '<rect x="-400" y="' + h * 0.78 + '" width="' + (w + 800) + '" height="12" fill="url(#band)" opacity=".6"/>',
      '<rect x="-400" y="' + h * 0.24 + '" width="' + (w + 800) + '" height="220" fill="' + GREEN + '" opacity=".08"/>');
    if (style === 'movimiento') for (let i = 0; i < 70; i++) body.push('<rect x="' + (rnd() * w * 1.4 - 200).toFixed(0) + '" y="' + (rnd() * h).toFixed(0) + '" width="' + (120 + rnd() * 420).toFixed(0) + '" height="' + (2 + rnd() * 5).toFixed(0) + '" fill="' + (rnd() > 0.7 ? GOLD_LIGHT : '#5be49a') + '" opacity="' + (0.15 + rnd() * 0.35).toFixed(2) + '"/>');
    body.push('</g>');
    // Balón estilizado.
    body.push('<g transform="translate(' + w * 0.82 + ',' + h * 0.3 + ')" opacity=".18"><circle r="190" fill="none" stroke="#fff" stroke-width="10"/><polygon points="0,-62 59,-19 37,50 -37,50 -59,-19" fill="#fff"/></g>');
  }
  body.push('<rect width="' + w + '" height="' + h + '" fill="url(#vig)"/>');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><defs>' + defs.join('') + '</defs>' + body.join('') + '</svg>';
}

/** Fondo con margen para el paneo lento (2016 × 1134). */
function background(root, style) {
  const name = Layout.BACKGROUND_NAMES[style] ? style : 'estadio';
  return cached(root, ['bg', name], () => backgroundSvg(name));
}

/** Fondo a partir de una imagen del usuario: desenfocada y oscurecida. */
function imageBackground(root, imageFile) {
  const stat = fs.statSync(imageFile);
  return cached(root, ['bgimg', imageFile, stat.size, stat.mtimeMs], sharp => sharp(imageFile).resize(PAN_W, PAN_H, { fit: 'cover' }).blur(28).modulate({ brightness: 0.55, saturation: 1.1 }));
}

/** Fondo de la cartela de transición con una foto: casi nítida y oscurecida para que el título se lea. */
function photoBackground(root, imageFile) {
  const stat = fs.statSync(imageFile);
  return cached(root, ['bgphoto', imageFile, stat.size, stat.mtimeMs], sharp => sharp(imageFile).resize(PAN_W, PAN_H, { fit: 'cover', position: 'attention' }).blur(2.5).modulate({ brightness: 0.6, saturation: 1.05 }));
}

/** Máscara blanca con esquinas redondeadas para recortar al presentador o la imagen. */
function mask(root, w, h, radius) {
  return cached(root, ['mask', w, h, radius], () => '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><rect width="' + w + '" height="' + h + '" fill="#000"/><rect width="' + w + '" height="' + h + '" rx="' + radius + '" fill="#fff"/></svg>');
}

/** Capa superior de la composición: marcos dorados, rótulo inferior y sello. */
function foreground(root, segment, hasImage, { sectionLabel = '', sectionTitle = '', caption = '' } = {}) {
  const box = Layout.boxes(segment, hasImage);
  return cached(root, ['fg', box, sectionLabel, sectionTitle, caption], () => {
    const parts = [];
    if (box.image && box.image.radius) parts.push('<rect x="' + (box.image.x - 3) + '" y="' + (box.image.y - 3) + '" width="' + (box.image.w + 6) + '" height="' + (box.image.h + 6) + '" rx="' + (box.image.radius + 3) + '" fill="none" stroke="' + GOLD + '" stroke-opacity=".9" stroke-width="5"/>');
    if (box.layout === 'C' || box.layout === 'D') parts.push('<rect width="' + W + '" height="' + H + '" fill="url(#shade)"/>');
    if (box.presenter) {
      const p = box.presenter;
      parts.push('<rect x="' + (p.x - 4) + '" y="' + (p.y - 4) + '" width="' + (p.size + 8) + '" height="' + (p.size + 8) + '" rx="' + (box.radius + 4) + '" fill="none" stroke="' + GOLD + '" stroke-width="7"/>',
        '<rect x="' + (p.x + 18) + '" y="' + (p.y + p.size - 12) + '" width="' + Math.min(220, p.size * 0.4) + '" height="6" rx="3" fill="' + GREEN + '"/>');
    }
    if (box.lowerThird && (sectionTitle || sectionLabel)) {
      const left = box.side === 'left';
      const x = left ? 1080 : 120, width = 720;
      parts.push('<g><rect x="' + x + '" y="380" width="' + width + '" height="250" rx="18" fill="#05100a" fill-opacity=".78" stroke="' + GOLD + '" stroke-opacity=".6" stroke-width="3"/>',
        '<text x="' + (x + 42) + '" y="450" font-family="' + FONT_TEXT + '" font-weight="700" font-size="32" letter-spacing="6" fill="' + GREEN + '">' + esc(sectionLabel) + '</text>',
        textLines(sectionTitle.toUpperCase(), x + 42, 520, 58, width - 84, FONT, GOLD_LIGHT, 2), '</g>');
    }
    if (caption) parts.push('<g><rect x="120" y="' + (H - 190) + '" width="' + Math.min(1300, 120 + caption.length * 26) + '" height="78" rx="12" fill="#05100a" fill-opacity=".82"/>',
      '<rect x="120" y="' + (H - 190) + '" width="10" height="78" fill="' + GOLD + '"/>',
      '<text x="152" y="' + (H - 138) + '" font-family="' + FONT_TEXT + '" font-weight="700" font-size="40" fill="#ffffff">' + esc(caption) + '</text></g>');
    parts.push(badge(W - 92, 86, 40), '<text x="' + (W - 150) + '" y="98" text-anchor="end" font-family="' + FONT + '" font-size="26" letter-spacing="4" fill="#ffffff" fill-opacity=".85">ONCE RECORDS</text>');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient></defs>' + parts.join('') + '</svg>';
  });
}

/** Ajusta un texto a varias líneas con un ancho máximo aproximado. */
function textLines(value, x, y, size, width, font, color, max = 3, anchor = 'start') {
  const words = String(value || '').split(/\s+/).filter(Boolean);
  const perLine = Math.max(6, Math.floor(width / (size * 0.62)));
  const lines = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last && (last + ' ' + word).length <= perLine) lines[lines.length - 1] = last + ' ' + word;
    else lines.push(word);
  }
  const shown = lines.slice(0, max);
  if (lines.length > max) shown[max - 1] = shown[max - 1].replace(/\s*\S*$/, '') + '…';
  return shown.map((line, i) => '<text x="' + x + '" y="' + (y + i * size * 1.12) + '" text-anchor="' + anchor + '" font-family="' + font + '" font-weight="900" font-size="' + size + '" fill="' + color + '">' + esc(line) + '</text>').join('');
}

/** Cartela de la transición: número, título y subrayado; con transparencia. */
function titleCard(root, { label, title }) {
  return cached(root, ['title', label, title], () => {
    const size = title.length > 34 ? 92 : title.length > 22 ? 112 : 136;
    const upper = String(title).toUpperCase();
    const count = Math.min(2, Math.ceil(upper.length / Math.max(6, Math.floor(1640 / (size * 0.62)))) || 1);
    const top = 600 - (count - 1) * size * 0.4;
    const lines = textLines(upper, W / 2, top, size, 1640, FONT, '#ffffff', 2, 'middle');
    const underline = top + (count - 1) * size * 1.12 + 62;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><defs><filter id="glow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="6" result="b"/><feColorMatrix in="b" type="matrix" values="0 0 0 0 .83 0 0 0 0 .69 0 0 0 0 .37 0 0 0 .55 0" result="c"/><feMerge><feMergeNode in="c"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
      '<rect x="0" y="' + (top - size - 210) + '" width="' + W + '" height="' + (underline - top + size + 270) + '" fill="#000" fill-opacity=".42"/>' +
      badge(W / 2, top - size - 120, 50) +
      '<text x="' + W / 2 + '" y="' + (top - size - 18) + '" text-anchor="middle" font-family="' + FONT_TEXT + '" font-weight="800" font-size="40" letter-spacing="14" fill="' + GREEN + '">' + esc(String(label).toUpperCase()) + '</text>' +
      '<g filter="url(#glow)">' + lines + '</g>' +
      '<rect x="' + (W / 2 - 180) + '" y="' + underline + '" width="360" height="10" rx="5" fill="' + GOLD + '"/></svg>';
  });
}

/** Franja de luz que cruza la cartela. */
function sweep(root) {
  return cached(root, ['sweep'], () => '<svg xmlns="http://www.w3.org/2000/svg" width="700" height="' + H + '"><defs><linearGradient id="s" x1="0" x2="1"><stop offset="0" stop-color="#fff6d8" stop-opacity="0"/><stop offset=".5" stop-color="#fff6d8" stop-opacity=".55"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/></linearGradient></defs><polygon points="260,0 700,0 440,' + H + ' 0,' + H + '" fill="url(#s)"/></svg>');
}

/** Tarjeta gráfica de estadística (número grande y concepto) para el modo inteligente. */
function statCard(root, { value, label, context = '' }) {
  return cached(root, ['stat', value, label, context], () => {
    const w = 1600, h = 900;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06140c"/><stop offset="1" stop-color="#0f3a22"/></linearGradient>' +
      '<pattern id="hex" width="56" height="48" patternUnits="userSpaceOnUse"><path d="M14 0h28l14 24-14 24H14L0 24z" fill="none" stroke="#2b7a4d" stroke-opacity=".25" stroke-width="2"/></pattern></defs>' +
      '<rect width="' + w + '" height="' + h + '" fill="url(#g)"/><rect width="' + w + '" height="' + h + '" fill="url(#hex)"/>' +
      '<rect x="0" y="0" width="22" height="' + h + '" fill="' + GOLD + '"/>' +
      '<text x="' + w / 2 + '" y="470" text-anchor="middle" font-family="' + FONT + '" font-weight="900" font-size="' + (String(value).length > 6 ? 220 : 300) + '" fill="' + GOLD_LIGHT + '">' + esc(value) + '</text>' +
      '<text x="' + w / 2 + '" y="600" text-anchor="middle" font-family="' + FONT_TEXT + '" font-weight="800" font-size="72" letter-spacing="8" fill="#ffffff">' + esc(String(label).toUpperCase()) + '</text>' +
      (context ? textLines(context, w / 2, 720, 44, 1400, FONT_TEXT, '#a9d9b9', 2, 'middle') : '') +
      badge(w - 90, 90, 44) + '</svg>';
  });
}

const BELL = '<path d="M0 -26c-11 0-19 9-19 20v13l-7 9h52l-7-9V-6c0-11-8-20-19-20z" fill="currentColor"/><circle cy="20" r="6" fill="currentColor"/>';
const THUMB = '<path d="M-22 -2h10v28h-10zM-8 -2l12-24c6 0 9 4 8 10l-3 12h17c6 0 9 5 8 10l-5 18c-1 5-5 7-9 7h-28z" fill="currentColor"/>';
const BUBBLE = '<path d="M-26 -20h52a8 8 0 0 1 8 8v26a8 8 0 0 1-8 8h-30l-16 13v-13h-6a8 8 0 0 1-8-8v-26a8 8 0 0 1 8-8z" fill="currentColor"/>';

/** Tarjeta animable de llamado a la acción (estado normal o «pulsado»). */
function ctaCard(root, { type, pressed = false, text = '' }) {
  return cached(root, ['cta', type, pressed, text], () => {
    const w = 470, h = type === 'comentar' ? 250 : 136;
    let body;
    if (type === 'comentar') {
      body = '<rect x="3" y="3" width="' + (w - 6) + '" height="' + (h - 6) + '" rx="22" fill="#06120b" fill-opacity=".9" stroke="' + GOLD + '" stroke-width="4"/>' +
        '<g transform="translate(62,70)" color="' + GREEN + '">' + BUBBLE + '</g>' +
        '<text x="112" y="82" font-family="' + FONT + '" font-size="36" letter-spacing="3" fill="' + GOLD_LIGHT + '">COMENTA</text>' +
        textLines(text || '¿Qué opinas? Te leo en los comentarios', 36, 148, 30, w - 72, FONT_TEXT, '#ffffff', 3);
    } else if (type === 'like') {
      body = '<rect x="3" y="3" width="' + (w - 6) + '" height="' + (h - 6) + '" rx="' + (h / 2 - 3) + '" fill="' + (pressed ? '#2b2410' : '#06120b') + '" fill-opacity=".92" stroke="' + GOLD + '" stroke-width="4"/>' +
        '<g transform="translate(78,' + (h / 2 - 4) + ') scale(1.15)" color="' + (pressed ? GOLD_LIGHT : '#ffffff') + '">' + THUMB + '</g>' +
        '<text x="140" y="' + (h / 2 + 16) + '" font-family="' + FONT + '" font-size="44" fill="' + (pressed ? GOLD_LIGHT : '#ffffff') + '">' + (pressed ? '¡GRACIAS!' : 'DALE LIKE') + '</text>';
    } else {
      body = '<rect x="3" y="3" width="' + (w - 6) + '" height="' + (h - 6) + '" rx="' + (h / 2 - 3) + '" fill="' + (pressed ? '#3a4440' : '#c0263a') + '" stroke="' + (pressed ? '#9aa7a0' : '#ffd7dc') + '" stroke-width="3"/>' +
        '<text x="36" y="' + (h / 2 + 13) + '" font-family="' + FONT + '" font-size="37" fill="#ffffff">' + (pressed ? 'SUSCRITO ✓' : 'SUSCRÍBETE') + '</text>' +
        '<g transform="translate(' + (w - 72) + ',' + (h / 2 + 2) + ')"><circle r="46" fill="' + (pressed ? GOLD : '#ffffff') + '"/><g transform="scale(1.05)" color="' + (pressed ? '#1b1407' : '#c0263a') + '">' + BELL + '</g>' +
        (pressed ? '<path d="M-58 -22q-8 22 0 44M58 -22q8 22 0 44" stroke="' + GOLD_LIGHT + '" stroke-width="5" fill="none" stroke-linecap="round"/>' : '') + '</g>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' + body + '</svg>';
  });
}

/** Pantalla final con espacio libre para los elementos de YouTube (video recomendado y suscripción). */
function endscreen(root, { title }) {
  return cached(root, ['endscreen', title], () => {
    const box = (x, y, bw, bh) => '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" rx="18" fill="#000" fill-opacity=".35" stroke="' + GOLD + '" stroke-opacity=".35" stroke-width="3"/>';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><rect width="' + W + '" height="' + H + '" fill="#000" fill-opacity=".35"/>' +
      badge(170, 170, 58) + '<text x="252" y="140" font-family="' + FONT_TEXT + '" font-weight="800" font-size="28" letter-spacing="10" fill="' + GREEN + '">ONCE RECORDS</text>' +
      '<text x="250" y="222" font-family="' + FONT + '" font-size="60" fill="#ffffff">GRACIAS POR VER</text>' +
      textLines(String(title || '').toUpperCase(), 120, 330, 40, 760, FONT_TEXT, GOLD_LIGHT, 2) +
      box(1030, 250, 760, 428) + box(1030, 720, 370, 208) + '<circle cx="380" cy="760" r="150" fill="#000" fill-opacity=".35" stroke="' + GOLD + '" stroke-opacity=".35" stroke-width="3"/>' +
      '<text x="380" y="955" text-anchor="middle" font-family="' + FONT_TEXT + '" font-weight="800" font-size="34" fill="#ffffff">Suscríbete</text></svg>';
  });
}

module.exports = { ctaCard, endscreen, background, imageBackground, photoBackground, mask, foreground, titleCard, sweep, statCard, backgroundSvg, PAN_W, PAN_H, cacheDir };
