'use strict';
/**
 * Videos largos directos · importación de guiones.
 * Convierte PDF, Word (.docx), texto y Markdown en texto editable y reconoce
 * las secciones del formato Once Records:
 *
 *   ━━━━━━━━━━━━━━━━━━
 *   SECCIÓN 01 · EL COMIENZO
 *   ━━━━━━━━━━━━━━━━━━
 *
 * Dentro de una sección puede haber subsecciones para grabar en tomas cortas:
 *
 *   ▸ SUBSECCIÓN 1.1 · LA FAMILIA
 *
 * Esas líneas se quedan en el texto de la sección (las entiende DirectLayout)
 * pero nunca se leen en el teleprompter ni salen en el video.
 * Los separadores y encabezados nunca pasan al texto narrable.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');

const MAX_INPUT = 25 * 1024 * 1024;
const MAX_TEXT = 400000;
const SEPARATOR = /^\s*(?:[━─═▬■◆•·*=_~\-–—]\s*){5,}\s*$/u;
const HEADER = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(SECCI[OÓ]N|SECCION|CAP[IÍ]TULO|PARTE|BLOQUE)\s*(?:N[ºo°.]\s*)?(\d{1,3})\b\s*(?:[·•.:|\-–—]+\s*)?(.*?)\s*(?:\*\*)?\s*$/iu;
const SUBHEADER = new RegExp(require('../renderer/direct-layout.js').SUBHEADER.source, 'iu');
const TEXT_TYPES = new Set(['.txt', '.md', '.markdown']);

function cleanText(input) {
  return String(input ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/ /g, ' ')
    .replace(/[​‎‏]/g, '').slice(0, MAX_TEXT);
}

function tidyBody(lines) {
  // Conserva los párrafos tal como llegan, solo recorta los bordes y los saltos repetidos.
  const text = lines.join('\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
  return text.replace(/^\n+|\n+$/g, '');
}

/** «EL PUNTO DE INFLEXIÓN» → «El punto de inflexión», respetando nombres propios del texto. */
function chapterTitle(title, body = '') {
  const raw = String(title || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const letters = raw.replace(/[^\p{L}]/gu, '');
  if (letters && letters !== letters.toUpperCase()) return raw;
  const proper = new Map();
  for (const word of String(body).match(/\p{Lu}[\p{Ll}]+/gu) || []) proper.set(word.toLowerCase(), word);
  const lower = raw.toLocaleLowerCase('es');
  const words = lower.split(' ').map((word, index) => {
    const bare = word.replace(/[^\p{L}]/gu, '');
    if (index > 0 && proper.has(bare) && !/^(el|la|los|las|de|del|un|una|y|en|al|su)$/.test(bare)) return word.replace(bare, proper.get(bare));
    return word;
  });
  const joined = words.join(' ');
  return joined.charAt(0).toLocaleUpperCase('es') + joined.slice(1);
}

/**
 * Divide un guion en secciones. Devuelve [{ number, title, heading, text }].
 * El texto anterior a la primera sección se conserva como «Introducción».
 */
function parseSections(input) {
  const lines = cleanText(input).split('\n');
  const sections = [];
  let current = null;
  const preamble = [];
  for (const line of lines) {
    if (SEPARATOR.test(line)) continue;
    const header = HEADER.exec(line);
    if (header) {
      if (current) sections.push(current);
      const title = header[3].replace(/[━─═*#]+/g, '').trim();
      current = { number: Number(header[2]), heading: line.trim().replace(/^#+\s*|\*\*/g, ''), title, lines: [] };
      continue;
    }
    (current ? current.lines : preamble).push(line);
  }
  if (current) sections.push(current);
  const result = sections.map(item => ({ number: item.number, heading: item.heading, title: item.title || ('Sección ' + String(item.number).padStart(2, '0')), text: tidyBody(item.lines) }));
  const intro = tidyBody(preamble);
  if (intro && result.length) result.unshift({ number: 0, heading: '', title: 'Introducción', text: intro, intro: true });
  if (!result.length && intro) result.push({ number: 1, heading: '', title: 'Sección 01', text: intro });
  return result;
}

// ── ZIP mínimo (solo lectura) para .docx ────────────────────────────────────
function readZip(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  let end = -1;
  for (let i = buffer.length - 22; i >= minimum; i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw Error('El archivo Word está dañado o no es un .docx');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw Error('Directorio del .docx inválido');
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extra = buffer.readUInt16LE(offset + 30);
    const comment = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name, { method, compressed, size, local });
    offset += 46 + nameLength + extra + comment;
  }
  return name => {
    const entry = entries.get(name);
    if (!entry) return null;
    if (entry.size > 60 * 1024 * 1024) throw Error('El documento es demasiado grande');
    const start = entry.local + 30 + buffer.readUInt16LE(entry.local + 26) + buffer.readUInt16LE(entry.local + 28);
    const data = buffer.subarray(start, start + entry.compressed);
    if (entry.method === 0) return data;
    if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 });
    throw Error('Compresión del .docx no compatible');
  };
}

function decodeXml(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec))).replace(/&amp;/g, '&');
}

function docxText(buffer) {
  const xml = readZip(buffer)('word/document.xml');
  if (!xml) throw Error('El .docx no contiene un documento de Word');
  const body = xml.toString('utf8');
  const paragraphs = body.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) || [];
  return paragraphs.map(paragraph => {
    let out = '';
    for (const token of paragraph.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br[^>]*\/>|<w:cr\/>/g) || []) {
      if (token.startsWith('<w:tab')) out += '\t';
      else if (token.startsWith('<w:br') || token.startsWith('<w:cr')) out += '\n';
      else out += decodeXml(token.replace(/^<w:t[^>]*>|<\/w:t>$/g, ''));
    }
    return out;
  }).join('\n');
}

let pdfjs;
async function pdfText(buffer) {
  if (!pdfjs) {
    let entry = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    // En el instalador, pdf.js se desempaqueta fuera de app.asar para cargarlo como módulo ES.
    const unpacked = entry.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    if (unpacked !== entry && fs.existsSync(unpacked)) entry = unpacked;
    pdfjs = await import(pathToFileURL(entry).href);
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let line = '', lastY = null;
      const lines = [];
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform ? Math.round(item.transform[5]) : lastY;
        const size = Math.abs(item.transform?.[3] || item.height || 10) || 10;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
          if (line) { lines.push(line); line = ''; }
          // Un salto vertical grande indica un párrafo nuevo.
          if (Math.abs(y - lastY) > size * 1.9 && lines.length && lines.at(-1) !== '') lines.push('');
        }
        line += item.str;
        if (item.hasEOL) { lines.push(line); line = ''; }
        lastY = y;
      }
      if (line) lines.push(line);
      pages.push(lines.join('\n'));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  // Une los párrafos que el PDF partió en varias líneas, sin tocar encabezados ni separadores.
  const merged = [];
  for (const line of pages.join('\n\n').split('\n')) {
    const previous = merged.at(-1);
    const joinable = previous && previous.trim() && line.trim() && !SEPARATOR.test(line) && !HEADER.test(line) && !SUBHEADER.test(line) &&
      !SEPARATOR.test(previous) && !HEADER.test(previous) && !SUBHEADER.test(previous) && !/[.!?:…»"”]\s*$/.test(previous) && /^\s*[\p{Ll}0-9,(]/u.test(line);
    if (joinable) merged[merged.length - 1] = previous.replace(/-\s*$/, '') + (previous.endsWith('-') ? '' : ' ') + line.trim();
    else merged.push(line);
  }
  return merged.join('\n');
}

async function readScriptFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw Error('Selecciona un archivo');
  if (stat.size > MAX_INPUT) throw Error('El guion supera los 25 MB');
  const ext = path.extname(file).toLowerCase();
  const buffer = fs.readFileSync(file);
  let text;
  if (TEXT_TYPES.has(ext)) text = buffer.toString('utf8');
  else if (ext === '.docx') text = docxText(buffer);
  else if (ext === '.pdf') text = await pdfText(buffer);
  else throw Error('Formato no admitido. Usa PDF, Word (.docx), .txt o .md');
  text = cleanText(text);
  if (!text.trim()) throw Error(ext === '.pdf' ? 'El PDF no contiene texto seleccionable (¿es una imagen escaneada?)' : 'El archivo no contiene texto');
  return { text, format: ext.slice(1), name: path.basename(file) };
}

module.exports = { parseSections, readScriptFile, docxText, pdfText, readZip, chapterTitle, cleanText, SEPARATOR, HEADER };
