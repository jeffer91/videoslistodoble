'use strict';
/**
 * Videos largos directos · funciones inteligentes.
 *  - Transcripción local con Whisper (el mismo motor que ya instala Studio).
 *  - Reconocimiento de futbolistas, entrenadores, clubes, estadios y competiciones.
 *  - Propuestas editables de composición a partir de la narración.
 *  - Sugerencias de música y estilo de transición.
 *  - Búsqueda de imágenes con licencia libre en Wikimedia Commons (requiere internet).
 */
const fs = require('node:fs');
const path = require('node:path');
const Layout = require('../renderer/direct-layout.js');

// ── Diccionario deportivo (se amplía con los nombres propios del guion) ─────
const GAZETTEER = {
  jugador: ['Lionel Messi', 'Messi', 'Cristiano Ronaldo', 'Cristiano', 'Kylian Mbappé', 'Mbappé', 'Erling Haaland', 'Haaland', 'Harry Kane', 'Kane',
    'Neymar', 'Vinícius Júnior', 'Vinicius', 'Jude Bellingham', 'Bellingham', 'Mohamed Salah', 'Salah', 'Kevin De Bruyne', 'De Bruyne', 'Robert Lewandowski', 'Lewandowski',
    'Luka Modric', 'Modric', 'Karim Benzema', 'Benzema', 'Lamine Yamal', 'Pedri', 'Gavi', 'Rodri', 'Antoine Griezmann', 'Griezmann', 'Luis Suárez', 'Suárez',
    'Sergio Ramos', 'Ramos', 'Andrés Iniesta', 'Iniesta', 'Xavi', 'Zinedine Zidane', 'Zidane', 'Ronaldinho', 'Ronaldo Nazário', 'Kaká', 'Pelé', 'Diego Maradona', 'Maradona',
    'Johan Cruyff', 'Cruyff', 'Thierry Henry', 'Henry', 'Wayne Rooney', 'Rooney', 'Zlatan Ibrahimović', 'Ibrahimović', 'Gianluigi Buffon', 'Buffon', 'Iker Casillas', 'Casillas',
    'Manuel Neuer', 'Neuer', 'Thibaut Courtois', 'Courtois', 'Virgil van Dijk', 'Van Dijk', 'Son Heung-min', 'Heung-min Son', 'Bukayo Saka', 'Saka', 'Phil Foden', 'Foden',
    'Lautaro Martínez', 'Lautaro', 'Julián Álvarez', 'Enzo Fernández', 'Rodrygo', 'Federico Valverde', 'Valverde', 'Florian Wirtz', 'Wirtz', 'Jamal Musiala', 'Musiala',
    'Moisés Caicedo', 'Caicedo', 'Enner Valencia', 'Antonio Valencia', 'Piero Hincapié', 'Hincapié', 'Kendry Páez', 'Pervis Estupiñán', 'Estupiñán', 'Alexander Domínguez',
    'James Rodríguez', 'Radamel Falcao', 'Falcao', 'Luis Díaz', 'Alexis Sánchez', 'Arturo Vidal', 'Edinson Cavani', 'Cavani', 'Paolo Guerrero', 'Ángel Di María', 'Di María',
    'Sadio Mané', 'Mané', 'Riyad Mahrez', 'Victor Osimhen', 'Osimhen', 'Khvicha Kvaratskhelia', 'Kvaratskhelia', 'Bruno Fernandes', 'Rafael Leão', 'Leão', 'Raphinha', 'Dani Olmo'],
  entrenador: ['Pep Guardiola', 'Guardiola', 'Carlo Ancelotti', 'Ancelotti', 'José Mourinho', 'Mourinho', 'Jürgen Klopp', 'Klopp', 'Diego Simeone', 'Simeone', 'Xabi Alonso',
    'Luis Enrique', 'Hansi Flick', 'Flick', 'Mikel Arteta', 'Arteta', 'Lionel Scaloni', 'Scaloni', 'Marcelo Bielsa', 'Bielsa', 'Didier Deschamps', 'Deschamps',
    'Thomas Tuchel', 'Tuchel', 'Antonio Conte', 'Conte', 'Sir Alex Ferguson', 'Alex Ferguson', 'Ferguson', 'Arsène Wenger', 'Wenger', 'Unai Emery', 'Emery', 'Sebastián Beccacece',
    'Gustavo Alfaro', 'Jorge Célico', 'Vicente del Bosque', 'Mauricio Pochettino', 'Pochettino', 'Ange Postecoglou', 'Postecoglou', 'Enzo Maresca', 'Arne Slot', 'Slot'],
  club: ['Real Madrid', 'Barcelona', 'FC Barcelona', 'Barça', 'Atlético de Madrid', 'Atlético', 'Sevilla', 'Valencia CF', 'Villarreal', 'Real Sociedad', 'Athletic Club', 'Real Betis', 'Betis',
    'Manchester City', 'Manchester United', 'Liverpool', 'Arsenal', 'Chelsea', 'Tottenham', 'Tottenham Hotspur', 'Newcastle', 'Aston Villa', 'West Ham',
    'Bayern Múnich', 'Bayern Munich', 'Bayern', 'Borussia Dortmund', 'Dortmund', 'Bayer Leverkusen', 'Leverkusen', 'RB Leipzig', 'Juventus', 'Inter de Milán', 'Inter',
    'AC Milan', 'Milan', 'Napoli', 'Nápoles', 'Roma', 'Lazio', 'Atalanta', 'PSG', 'Paris Saint-Germain', 'Olympique de Marsella', 'Marsella', 'Lyon', 'Ajax', 'PSV', 'Feyenoord',
    'Benfica', 'Porto', 'Sporting', 'Celtic', 'Rangers', 'Galatasaray', 'Fenerbahçe', 'Al Nassr', 'Al Hilal', 'Inter Miami', 'LA Galaxy',
    'Boca Juniors', 'River Plate', 'Flamengo', 'Palmeiras', 'Santos', 'Corinthians', 'São Paulo', 'Fluminense', 'Peñarol', 'Nacional', 'Colo-Colo',
    'Barcelona SC', 'Emelec', 'Liga de Quito', 'LDU Quito', 'Independiente del Valle', 'Aucas', 'El Nacional', 'Deportivo Cuenca', 'América de Cali', 'Atlético Nacional', 'Millonarios',
    'Ecuador', 'Argentina', 'Brasil', 'Uruguay', 'Colombia', 'Chile', 'Perú', 'México', 'España', 'Francia', 'Inglaterra', 'Alemania', 'Italia', 'Portugal', 'Países Bajos', 'Croacia', 'Marruecos'],
  estadio: ['Santiago Bernabéu', 'Bernabéu', 'Camp Nou', 'Spotify Camp Nou', 'Metropolitano', 'Wanda Metropolitano', 'Old Trafford', 'Anfield', 'Etihad', 'Emirates', 'Stamford Bridge',
    'Wembley', 'Tottenham Hotspur Stadium', 'Allianz Arena', 'Signal Iduna Park', 'San Siro', 'Giuseppe Meazza', 'Allianz Stadium', 'Parque de los Príncipes', 'Maracaná', 'Maracana',
    'La Bombonera', 'Bombonera', 'Monumental', 'Estadio Azteca', 'Azteca', 'Estadio Centenario', 'Rodrigo Paz Delgado', 'Casa Blanca', 'Monumental Isidro Romero Carbo',
    'Banco Pichincha', 'George Capwell', 'Estadio Olímpico Atahualpa', 'Atahualpa', 'Lusail', 'Mestalla', 'Benito Villamarín', 'San Mamés', 'Da Luz', 'Estádio do Dragão'],
  competicion: ['Champions League', 'Liga de Campeones', 'Europa League', 'Conference League', 'Mundial', 'Copa del Mundo', 'Mundial de Clubes', 'Eurocopa', 'Copa América',
    'Copa Libertadores', 'Libertadores', 'Copa Sudamericana', 'Sudamericana', 'Premier League', 'LaLiga', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Liga Pro', 'LigaPro',
    'Copa del Rey', 'FA Cup', 'Supercopa', 'Balón de Oro', 'Bota de Oro', 'Eliminatorias', 'Clásico', 'El Clásico', 'Derbi']
};
const STOP = new Set(['El', 'La', 'Los', 'Las', 'Un', 'Una', 'Pero', 'Durante', 'Cuando', 'Entonces', 'Su', 'Sus', 'Ese', 'Esa', 'Este', 'Esta', 'Hoy', 'Ayer', 'Así', 'Porque',
  'Sin', 'Con', 'En', 'De', 'Del', 'Y', 'O', 'A', 'Al', 'Por', 'Para', 'Hay', 'Nadie', 'Todo', 'Todos', 'Nunca', 'Siempre', 'Aquí', 'Allí', 'Sección', 'Lo', 'Le', 'Les', 'Se', 'Mi', 'Tu', 'Ya', 'Si', 'No', 'Qué', 'Cómo']);

const ENTRIES = Object.entries(GAZETTEER).flatMap(([type, names]) => names.map(name => ({ name, type, key: Layout.normalize(name.replace(/\s+/g, '')), words: name.split(/\s+/).map(Layout.normalize) })))
  .sort((a, b) => b.words.length - a.words.length);

/** Encuentra entidades deportivas en un texto. Devuelve nombres únicos con su tipo. */
function entities(text) {
  const found = new Map();
  const raw = String(text || '');
  const words = raw.split(/\s+/).map(w => Layout.normalize(w));
  for (const entry of ENTRIES) {
    for (let i = 0; i + entry.words.length <= words.length; i++) {
      if (entry.words.every((w, k) => words[i + k] === w)) {
        const covered = [...found.values()].some(e => (e.name.includes(entry.name) && e.name !== entry.name) || e.key === entry.key);
        if (!covered) found.set(entry.name, { name: entry.name, type: entry.type, known: true, key: entry.key });
        break;
      }
    }
  }
  // Nombres propios de dos o tres palabras que no están en el diccionario (p. ej. «Harry Kane»).
  for (const match of raw.matchAll(/(?<![.!?¿¡]\s)(?<!^)\b(\p{Lu}[\p{Ll}'’-]+(?:\s+(?:de\s+|del\s+|da\s+|van\s+)?\p{Lu}[\p{Ll}'’-]+){1,2})/gu)) {
    const name = match[1].trim();
    if (STOP.has(name.split(/\s+/)[0])) continue;
    if ([...found.keys()].some(known => known.includes(name) || name.includes(known))) continue;
    found.set(name, { name, type: 'nombre', known: false });
  }
  return [...found.values()].slice(0, 30).map(({ key, ...item }) => item);
}

const CUES = {
  cta: /\b(suscr[ií]bete|suscribirte|dale (a )?like|activa la campana|comenta|d[eé]jame en los comentarios|comp[aá]rtelo|nos vemos|hasta la pr[oó]xima|s[ií]gueme|link en la descripci[oó]n)\b/i,
  news: /\b([uú]ltima hora|oficial|confirmad[oa]|acaba de|hoy|anunci[oó]|comunicado|bomba|noticia|se hizo oficial)\b/i,
  opinion: /\b(creo que|para m[ií]|en mi opini[oó]n|sin duda|la verdad|lo cierto es|hay que decirlo|me parece|honestamente|sinceramente|es incre[ií]ble|no tengo dudas|opino)\b/i,
  stat: /(\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*(%|por ciento|goles|gol|partidos|asistencias|t[ií]tulos|temporadas|minutos|millones|años|victorias|derrotas|puntos|tantos|copas|ligas|champions|veces)\b|\br[eé]cord\b|\bestad[ií]sticas?\b|\bpromedio\b)/i,
  emotion: /\b(l[aá]grimas|lloró|emoci[oó]n|familia|sueño|infancia|despedida|homenaje|coraz[oó]n|recuerdo|muri[oó]|perdi[oó]|dolor|nostalgia)\b/i,
  tension: /\b(final|penal(ti)?|presi[oó]n|crisis|pol[eé]mica|lesi[oó]n|despido|derrota|descenso|tensi[oó]n|al l[ií]mite|ca[ií]da|fracaso|expulsi[oó]n|VAR)\b/i,
  epic: /\b(gloria|campe[oó]n|t[ií]tulo|hist[oó]ric[oa]|remontada|haza[nñ]a|leyenda|[eé]lite|conquist[oó]|trofeo|dominio|gigante|inmortal)\b/i
};

function classify(sentence) {
  const tags = [];
  for (const [key, re] of Object.entries(CUES)) if (re.test(sentence)) tags.push(key);
  return tags;
}

/** Estadística principal de una frase («213 goles» → { value: '213', label: 'goles' }). */
function statistic(sentence) {
  const m = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*(%|por ciento|goles|gol|partidos|asistencias|t[ií]tulos|temporadas|minutos|millones|años|victorias|derrotas|puntos|tantos|copas|ligas|veces)/i.exec(sentence);
  if (!m) return null;
  const label = /%|por ciento/i.test(m[2]) ? 'por ciento' : m[2];
  return { value: m[1] + (/%/.test(m[2]) ? '%' : ''), label, context: sentence.replace(/\s+/g, ' ').trim().slice(0, 90) };
}

/** Frases con su tiempo a partir de la transcripción, o estimadas desde el guion. */
function sentences(section) {
  const words = section.transcript?.takeId === section.take?.id && section.transcript?.words?.length ? section.transcript.words : estimateWords(section);
  const list = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    list.push({ start: current[0].start, end: current.at(-1).end, text: current.map(w => w.text).join(' ') });
    current = [];
  };
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const gap = i > 0 ? word.start - words[i - 1].end : 0;
    if (current.length && (gap > 0.7 || current.length >= 28)) flush();
    current.push(word);
    if (/[.!?…;:]["”»)]*$/.test(word.text)) flush();
  }
  flush();
  return list;
}

function estimateWords(section) {
  const duration = section.take?.duration || 0;
  const raw = Layout.stripMarks(section.text).split(/\s+/).filter(Boolean);
  if (!duration || !raw.length) return [];
  const weights = raw.map(w => w.length + 2 + (/[.!?…]$/.test(w) ? 6 : /[,;:]$/.test(w) ? 3 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let at = 0;
  return raw.map((text, i) => {
    const length = duration * weights[i] / total;
    const word = { start: at, end: at + length * 0.85, text, estimated: true };
    at += length;
    return word;
  });
}

/** Imagen del proyecto asociada a alguna de las entidades. */
function imageFor(project, names, used) {
  const keys = names.map(n => Layout.normalize(n.replace(/\s+/g, '')));
  const candidates = project.images.filter(img => {
    const tags = [...(img.tags || []), img.name, img.source?.title, img.source?.query].filter(Boolean).map(t => Layout.normalize(String(t).replace(/\s+/g, '')));
    return keys.some(k => k.length > 3 && tags.some(t => t.includes(k)));
  });
  return candidates.sort((a, b) => (used.get(a.id) || 0) - (used.get(b.id) || 0))[0] || null;
}

/**
 * Propone cambios de composición para una sección. Devuelve tramos editables
 * con el motivo de cada propuesta. Nunca se aplican sin que el usuario lo pida.
 */
function propose(project, section, { statImages = {} } = {}) {
  const duration = section.take?.duration || 0;
  if (!duration) return { layouts: [], notes: ['Graba la sección para recibir propuestas'] };
  const list = sentences(section);
  const used = new Map();
  const out = [];
  let side = 'left', corner = 'br';
  const sectionImages = project.images.filter(i => section.imageIds.includes(i.id));
  let generic = 0;
  list.forEach((sentence, index) => {
    const tags = classify(sentence.text);
    const names = entities(sentence.text).map(e => e.name);
    const image = imageFor(project, names, used);
    let item = { layout: 'A', scale: 1, reason: 'Narración' };
    const stat = tags.includes('stat') && statistic(sentence.text);
    const isFirst = index === 0, isLast = index === list.length - 1;
    if (tags.includes('cta')) item = { layout: 'A', scale: 1.05, reason: 'Llamado a la acción: presentador en primer plano' };
    else if (isFirst) item = { layout: 'A', scale: 1, reason: 'Apertura de la sección' };
    else if (tags.includes('news')) item = { layout: 'A', scale: 1, reason: 'Noticia: presentador grande' };
    else if (tags.includes('opinion')) item = { layout: 'A', scale: 1.15, reason: 'Opinión importante: presentador ampliado' };
    else if (stat && statImages[stat.value + '|' + stat.label]) item = { layout: 'B', imageId: statImages[stat.value + '|' + stat.label], reason: 'Estadística: gráfico ' + stat.value + ' ' + stat.label };
    else if (image) item = { layout: names.length > 1 || sentence.end - sentence.start > 9 ? 'C' : 'B', imageId: image.id, reason: 'Menciona a ' + names[0] };
    else if (stat) item = { layout: 'E', reason: 'Estadística sin gráfico: fondo deportivo' };
    else if (sentence.end - sentence.start > 6 && sectionImages.length) {
      const pickImage = sectionImages[generic++ % sectionImages.length];
      item = { layout: generic % 2 ? 'C' : 'D', imageId: pickImage.id, reason: 'Narración descriptiva: imagen protagonista' };
    } else if (sentence.end - sentence.start > 6) item = { layout: 'E', reason: 'Narración descriptiva sobre fondo deportivo' };
    else if (isLast) item = { layout: 'A', reason: 'Cierre de la sección' };
    if (item.imageId) used.set(item.imageId, (used.get(item.imageId) || 0) + 1);
    if (item.layout === 'B' || item.layout === 'E') { item.side = side; side = side === 'left' ? 'right' : 'left'; }
    if (item.layout === 'C') { item.corner = corner; corner = corner === 'br' ? 'bl' : 'br'; }
    out.push({ ...item, start: sentence.start, end: sentence.end, source: 'auto' });
  });
  // Ajustes: cubrir toda la toma, fusionar repetidos y evitar tramos demasiado cortos o largos.
  for (let i = 0; i < out.length; i++) {
    out[i].start = i === 0 ? 0 : out[i - 1].end;
    out[i].end = i === out.length - 1 ? duration : Math.max(out[i].start, (out[i].end + (out[i + 1]?.start ?? out[i].end)) / 2);
  }
  const merged = [];
  for (const item of out) {
    const last = merged.at(-1);
    const same = last && last.layout === item.layout && last.imageId === item.imageId && last.side === item.side;
    if (last && (same || item.end - item.start < 3)) { last.end = item.end; continue; }
    merged.push({ ...item });
  }
  if (merged.length > 1 && merged.at(-1).end - merged.at(-1).start < 3) { merged.at(-2).end = merged.at(-1).end; merged.pop(); }
  const varied = [];
  for (const item of merged) {
    const length = item.end - item.start;
    if (length > 16 && (item.layout === 'A' || item.layout === 'E')) {
      const pieces = Math.ceil(length / 12);
      for (let k = 0; k < pieces; k++) {
        const start = item.start + length * k / pieces, end = item.start + length * (k + 1) / pieces;
        const alt = k % 2 ? { layout: 'E', side: k % 4 === 1 ? 'left' : 'right', scale: 1, reason: 'Variación para evitar monotonía' } : { layout: item.layout, scale: item.scale, side: item.side };
        varied.push({ ...item, ...alt, start, end });
      }
    } else varied.push(item);
  }
  const notes = [];
  if (!section.transcript || section.transcript.takeId !== section.take.id) notes.push('Propuesta estimada desde el guion. Transcribe la toma para sincronizarla con la voz.');
  return { layouts: varied.map(l => ({ ...l, start: Math.round(l.start * 30) / 30, end: Math.round(l.end * 30) / 30 })), notes, sentences: list.length };
}

/** Estadísticas detectadas en la sección (para generar sus gráficos). */
function statistics(section) {
  const found = new Map();
  for (const sentence of sentences(section)) {
    const stat = classify(sentence.text).includes('stat') && statistic(sentence.text);
    if (stat) found.set(stat.value + '|' + stat.label, stat);
  }
  if (!found.size) for (const line of Layout.stripMarks(section.text).split(/(?<=[.!?])\s+/)) {
    const stat = statistic(line);
    if (stat) found.set(stat.value + '|' + stat.label, stat);
  }
  return [...found.values()].slice(0, 8);
}

function mood(section) {
  const text = section.title + ' ' + section.text;
  const score = { tension: (text.match(new RegExp(CUES.tension, 'gi')) || []).length, emotiva: (text.match(new RegExp(CUES.emotion, 'gi')) || []).length,
    epica: (text.match(new RegExp(CUES.epic, 'gi')) || []).length };
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : 'ambiental';
}

const MOOD_STYLE = { tension: 'tunel', emotiva: 'luces', epica: 'estadio', ambiental: 'grafico' };
/** Estilo de transición coherente con el contenido, sin repetir el anterior. */
function transitionStyle(section, previous) {
  if (section.intro) return 'estadio';
  if (statistics(section).length >= 2) return previous === 'grafico' ? 'movimiento' : 'grafico';
  const style = MOOD_STYLE[mood(section)];
  if (style !== previous) return style;
  return { estadio: 'movimiento', tunel: 'luces', luces: 'cesped', grafico: 'movimiento', cesped: 'estadio', movimiento: 'estadio' }[style];
}

function resolvedStyles(project) {
  let previous = '';
  return project.sections.map(section => {
    const style = section.transition.style === 'auto' ? transitionStyle(section, previous) : section.transition.style;
    previous = style;
    return style;
  });
}

/** Títulos y divisiones temáticas sugeridos a partir de la transcripción. */
function suggestTitles(section) {
  const names = entities(section.text + ' ' + (section.transcript?.words || []).map(w => w.text).join(' '));
  const lead = names.find(n => n.known) || names[0];
  const tone = { tension: 'Bajo presión', emotiva: 'Lo que nadie vio', epica: 'El momento de la gloria', ambiental: 'La historia' }[mood(section)];
  const titles = [];
  if (lead) titles.push(tone + ' de ' + lead.name, lead.name + ': ' + tone.toLowerCase());
  const stat = statistics(section)[0];
  if (stat) titles.push(stat.value + ' ' + stat.label);
  return [...new Set(titles)].slice(0, 4);
}

// ── Transcripción con Whisper ───────────────────────────────────────────────
function whisperConfig(root) {
  const editing = require('./editing.cjs');
  const config = editing.editingSettings(root);
  const ready = Boolean(config.whisper && config.model && fs.existsSync(config.whisper) && fs.existsSync(config.model));
  return { ...config, ready };
}

async function transcribeFile(root, file, signal, media = require('./media.cjs')) {
  const config = whisperConfig(root);
  if (!config.ready) throw Error('Instala Whisper en Configuración (botón «Instalar Whisper») para transcribir en tu PC');
  const temp = media.temporary(root);
  try {
    const wave = path.join(temp, 'voz.wav');
    const output = path.join(temp, 'voz');
    await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wave], signal);
    await media.command(config.whisper, ['-m', config.model, '-f', wave, '-l', 'es', '-ojf', '-sow', '-of', output], signal);
    return require('./editing.cjs').parseWhisper(require('./store.cjs').readJSON(output + '.json'));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

let listening = null;
/**
 * Reconocimiento breve para el teleprompter por voz: recibe ~4 s de audio
 * PCM a 16 kHz (WAV en base64) y devuelve el texto. Una petición a la vez.
 */
async function listen(root, { wav }, media = require('./media.cjs')) {
  const config = whisperConfig(root);
  if (!config.ready) return { ready: false, text: '' };
  if (listening) return { ready: true, busy: true, text: '' };
  if (typeof wav !== 'string' || wav.length > 2 * 1024 * 1024) throw Error('Audio de seguimiento inválido');
  const temp = media.temporary(root);
  listening = (async () => {
    const wave = path.join(temp, 'escucha.wav');
    fs.writeFileSync(wave, Buffer.from(wav, 'base64'));
    const started = Date.now();
    const result = await media.command(config.whisper, ['-m', config.model, '-f', wave, '-l', 'es', '-nt', '-np', '-t', '4', '-bs', '1', '-bo', '1'], AbortSignal.timeout(8000));
    return { ready: true, text: result.stdout.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim(), ms: Date.now() - started };
  })();
  try { return await listening; }
  finally { listening = null; fs.rmSync(temp, { recursive: true, force: true }); }
}

/**
 * Texto de los últimos segundos antes de un punto de la toma (para colocar el
 * teleprompter al continuar una grabación). Sin Whisper devuelve ''.
 */
async function heardBefore(root, file, end, media = require('./media.cjs'), seconds = 8) {
  const config = whisperConfig(root);
  if (!config.ready) return '';
  const temp = media.temporary(root);
  try {
    const wave = path.join(temp, 'antes.wav');
    const from = Math.max(0, Number(end) - seconds);
    await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', from.toFixed(3), '-t', (Number(end) - from).toFixed(3), '-i', file,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wave]);
    const result = await media.command(config.whisper, ['-m', config.model, '-f', wave, '-l', 'es', '-nt', '-np', '-t', '4'], AbortSignal.timeout(20000));
    return result.stdout.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

// ── Imágenes con licencia libre (Wikimedia Commons) ─────────────────────────
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const AGENT = 'OnceRecordsStudio/0.12 (https://github.com/jeffer91/videoslistodoble)';

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function yearOf(meta, timestamp) {
  const raw = stripHtml(meta.DateTimeOriginal?.value) || timestamp || '';
  const m = /(19|20)\d{2}/.exec(raw);
  return m ? Number(m[0]) : null;
}

/** Puntuación: relevancia, resolución, formato cercano a 16:9 y fecha reciente. */
function scoreImage(item, rank, total) {
  const ratio = item.width / item.height;
  const aspect = Math.max(0, 1 - Math.abs(ratio - 16 / 9) / 1.2);
  const resolution = Math.min(1, item.width / 3000);
  const year = item.year || 2000;
  const recency = Math.max(0, Math.min(1, (year - 2005) / (new Date().getFullYear() - 2005)));
  const relevance = 1 - rank / Math.max(1, total);
  return relevance * 0.4 + recency * 0.25 + resolution * 0.2 + aspect * 0.15;
}

function parseCommons(data, minWidth = 1200) {
  const pages = Object.values(data?.query?.pages || {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.flatMap(page => {
    const info = page.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png|webp)$/.test(info.mime || '')) return [];
    const meta = info.extmetadata || {};
    if (String(meta.NonFree?.value || '').toLowerCase() === 'true') return [];
    const license = stripHtml(meta.LicenseShortName?.value) || 'Licencia en la página de origen';
    if (!/(cc|public domain|dominio p|pd|gfdl|attribution|no restrictions)/i.test(license)) return [];
    if (info.width < minWidth || info.height < 500) return [];
    const author = stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value) || 'Autor indicado en Wikimedia Commons';
    return [{
      provider: 'Wikimedia Commons', id: String(page.pageid), title: page.title.replace(/^File:/, ''), pageUrl: info.descriptionurl,
      url: info.url, thumb: info.thumburl || info.url, width: info.width, height: info.height, mime: info.mime,
      author: author.slice(0, 200), license, licenseUrl: meta.LicenseUrl?.value || '', restrictions: stripHtml(meta.Restrictions?.value),
      attributionRequired: String(meta.AttributionRequired?.value || 'true') !== 'false', year: yearOf(meta, info.timestamp),
      description: stripHtml(meta.ImageDescription?.value).slice(0, 240)
    }];
  });
}

async function commonsQuery(params, fetcher) {
  const url = new URL(COMMONS);
  for (const [k, v] of Object.entries({ action: 'query', format: 'json', formatversion: '1', ...params })) url.searchParams.set(k, v);
  const response = await fetcher(url, { headers: { 'User-Agent': AGENT, 'Api-User-Agent': AGENT }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error('Wikimedia Commons respondió HTTP ' + response.status);
  return response.json();
}

/** Busca imágenes reutilizables. Combina relevancia y orden por fecha de subida. */
async function searchImages(query, { fetcher = fetch, limit = 12 } = {}) {
  const q = String(query || '').replace(/[^\p{L}\p{N}\s'’.-]/gu, ' ').trim().slice(0, 120);
  if (!q) throw Error('Escribe qué imagen buscas');
  const common = { generator: 'search', gsrnamespace: '6', gsrlimit: '40', gsrsearch: q + ' filetype:bitmap', prop: 'imageinfo',
    iiprop: 'url|size|mime|timestamp|extmetadata', iiurlwidth: '640', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit|DateTimeOriginal|ImageDescription|AttributionRequired|Restrictions|NonFree' };
  const [relevant, recent] = await Promise.all([
    commonsQuery(common, fetcher),
    commonsQuery({ ...common, gsrsort: 'create_timestamp_desc' }, fetcher).catch(() => null)
  ]);
  const ranked = new Map();
  const add = (list, weight) => list.forEach((item, rank) => {
    const score = scoreImage(item, rank, list.length) * weight;
    const prev = ranked.get(item.id);
    if (!prev || prev.score < score) ranked.set(item.id, { ...item, score });
  });
  add(parseCommons(relevant), 1);
  if (recent) add(parseCommons(recent), 0.9);
  const results = [...ranked.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  return { query: q, results, source: 'Wikimedia Commons', note: 'Solo se muestran imágenes con licencia libre. Revisa la licencia y las restricciones (derechos de imagen, marcas) antes de publicar.' };
}

/** Descarga una imagen elegida (máx. 2560 px de ancho) con sus datos de licencia. */
async function downloadImage({ title }, { fetcher = fetch } = {}) {
  const data = await commonsQuery({ titles: 'File:' + String(title).replace(/^File:/, ''), prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata|timestamp', iiurlwidth: '2560' }, fetcher);
  const item = parseCommons(data, 0)[0];
  if (!item) throw Error('La imagen ya no está disponible o no tiene licencia libre');
  const target = item.width > 2560 ? item.thumb : item.url;
  const response = await fetcher(target, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error('No se pudo descargar la imagen · HTTP ' + response.status);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 40 * 1024 * 1024) throw Error('Imagen demasiado grande');
  return { buffer, item };
}

function attribution(item) {
  return (item.title ? '«' + item.title.replace(/\.[a-z]+$/i, '') + '» · ' : '') + item.author + ' · ' + item.license + ' · Wikimedia Commons';
}

module.exports = { heardBefore, entities, classify, statistic, statistics, sentences, estimateWords, propose, mood, transitionStyle, resolvedStyles, suggestTitles,
  whisperConfig, transcribeFile, listen, searchImages, downloadImage, parseCommons, attribution, GAZETTEER };
