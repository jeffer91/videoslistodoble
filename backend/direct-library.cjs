'use strict';
/**
 * Videos largos directos · biblioteca de fotos que aprende.
 * Cada foto se guarda una vez con las personas, clubes o lugares que muestra.
 * Cuando un guion vuelve a mencionarlos, el piloto automático la reutiliza
 * antes de buscar en internet.
 */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const store = require('./store.cjs');
const Layout = require('../renderer/direct-layout.js');

function dir(root) {
  const folder = path.join(root, 'Recursos', 'Directos', 'Fotos');
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}
const indexFile = root => path.join(dir(root), 'biblioteca.json');
const key = value => Layout.normalize(String(value || '').replace(/\s+/g, ''));
const cleanTags = tags => [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(',')).map(t => String(t).trim().slice(0, 80)).filter(Boolean))].slice(0, 16);

function list(root) {
  try { return store.readJSON(indexFile(root)); } catch { return []; }
}
function save(root, items) { store.atomic(indexFile(root), items); return items; }
function resolve(root, id) {
  const item = list(root).find(x => x.id === id);
  if (!item) throw Error('Foto no encontrada en la biblioteca');
  return path.join(dir(root), item.file);
}

/** Añade una foto (ruta o buffer). Si ya existe la misma fuente, solo amplía sus etiquetas. */
async function add(root, input, { name = 'Foto', tags = [], source = null } = {}) {
  const items = list(root);
  const same = source?.pageUrl && items.find(x => x.source?.pageUrl === source.pageUrl);
  if (same) { same.tags = cleanTags([...same.tags, ...cleanTags(tags)]); save(root, items); return same; }
  const sharp = require('sharp');
  const id = randomUUID();
  const file = id + '.jpg';
  const info = await sharp(input, { limitInputPixels: 120e6 }).rotate().resize({ width: 3840, height: 3840, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#000000' }).jpeg({ quality: 92, progressive: false, mozjpeg: false }).toFile(path.join(dir(root), file));
  const item = { id, file, name: String(name).slice(0, 160), tags: cleanTags(tags), width: info.width, height: info.height, addedAt: new Date().toISOString(),
    source: source || { provider: 'propia', license: 'Foto propia del usuario', attribution: '' }, uses: 0 };
  items.push(item);
  save(root, items);
  return item;
}

function retag(root, { id, tags, name }) {
  const items = list(root);
  const item = items.find(x => x.id === id);
  if (!item) throw Error('Foto no encontrada en la biblioteca');
  if (tags !== undefined) item.tags = cleanTags(tags);
  if (name !== undefined) item.name = String(name).slice(0, 160) || item.name;
  save(root, items);
  return item;
}

function remove(root, { id }) {
  const items = list(root);
  const item = items.find(x => x.id === id);
  if (!item) return items;
  fs.rmSync(path.join(dir(root), item.file), { force: true });
  return save(root, items.filter(x => x.id !== id));
}

/** Fotos etiquetadas con un nombre (se prefieren las menos usadas y las más grandes). */
function find(root, name, exclude = []) {
  const wanted = key(name);
  if (wanted.length < 3) return [];
  return list(root).filter(x => !exclude.includes(x.id) && x.tags.some(t => { const k = key(t); return k === wanted || (k.length > 4 && (k.includes(wanted) || wanted.includes(k))); }))
    .sort((a, b) => (a.uses || 0) - (b.uses || 0) || b.width - a.width);
}

function used(root, id) {
  const items = list(root);
  const item = items.find(x => x.id === id);
  if (item) { item.uses = (item.uses || 0) + 1; save(root, items); }
}

module.exports = { list, add, retag, remove, find, resolve, used, dir };
