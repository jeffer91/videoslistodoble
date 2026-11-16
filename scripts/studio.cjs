'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');
const store = require('../backend/store.cjs');
const editing = require('../backend/editing.cjs');
const production = require('../backend/production.cjs');
const delivery = require('../backend/delivery.cjs');
const review = require('../backend/review.cjs');
const { createPublishing } = require('../backend/publishing.cjs');

const { values, positionals } = parseArgs({
  allowPositionals: true, options: { root: { type: 'string' }, help: { type: 'boolean' } }
});
const [action, first, second, third] = positionals;
const root = path.resolve(values.root || process.env.RECORDS_TEST_ROOT ||
  (process.platform === 'win32' ? 'D:\\11-Records-Studio' : path.join(os.homedir(), '11-Records-Studio')));
const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
const signal = controller.signal;
const send = event => {
  if (event.type === 'status') process.stderr.write((Number.isFinite(event.percent) ? event.percent + '% ' : '') + event.message + '\n');
};

function fromFile(file) {
  if (!file) throw Error('Indica el archivo de entrada');
  if (fs.statSync(file).size > 2 * 1024 * 1024) throw Error('El archivo de entrada supera 2 MB');
  const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return path.extname(file).toLowerCase() === '.txt' ? content : JSON.parse(content);
}

function target(kind, id, file) {
  return { kind, id, file: file || path.basename(delivery.outputs(root, kind, id).at(-1) || '') };
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function prepareHyperFrame(id, file) {
  store.getProject(root, id);
  const data = fromFile(file);
  const title = String(data?.title || '').trim().slice(0, 62);
  const detail = String(data?.detail || '').trim().slice(0, 85);
  if (!title) throw Error('El gráfico necesita un título');
  const duration = Number(data.duration ?? 3);
  if (!(duration >= 1 && duration <= 12)) throw Error('El gráfico debe durar entre 1 y 12 segundos');
  const wide = data.format === 'wide';
  const width = wide ? 1920 : 1080;
  const height = wide ? 1080 : 1920;
  const directory = fs.mkdtempSync(path.join(path.dirname(editing.exportHandoff(root, id)), 'grafico-'));
  fs.copyFileSync(require.resolve('gsap/dist/gsap.min.js'), path.join(directory, 'gsap.min.js'));
  const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Gráfico de 11 Récords</title>' +
    '<style>*{box-sizing:border-box}body{margin:0;background:transparent}.root{position:relative;overflow:hidden}' +
    '.card{position:absolute;inset:18% 12% auto;padding:34px 42px;border-left:12px solid #ffd267;' +
    'border-radius:17px;color:#fff;background:#11231a;font-family:Arial,sans-serif;overflow-wrap:anywhere}' +
    'h1{font-size:54px;margin:0;color:#ffd267}p{font-size:30px;margin:12px 0 0}</style></head><body>' +
    '<main id="grafico" class="root" data-composition-id="grafico" data-width="' + width + '" data-height="' + height +
    '" data-start="0" data-duration="' + duration + '" style="width:' + width + 'px;height:' + height + 'px">' +
    '<section class="clip card" data-start="0" data-duration="' + duration + '" data-track-index="1"><h1>' + escapeHtml(title) +
    '</h1>' + (detail ? '<p>' + escapeHtml(detail) + '</p>' : '') + '</section></main><script src="gsap.min.js"></script>' +
    '<script>window.__timelines=window.__timelines||{};const timeline=gsap.timeline({paused:true});' +
    'timeline.fromTo(".card",{opacity:0,x:-58},{opacity:1,x:0,duration:.31,ease:"power2.out"},0)' +
    '.to(".card",{opacity:0,x:34,duration:.31,ease:"power2.in"},' + (duration - .31) + ');' +
    'window.__timelines.grafico=timeline;</script></body></html>';
  fs.writeFileSync(path.join(directory, 'index.html'), html, 'utf8');
  return { directory, renderer: 'hyperframes render --format webm --output grafico.webm' };
}

const actions = {
  list: () => ({ projects: store.listProjects(root), compilations: store.listWeeks(root), ideas: production.listIdeas(root) }),
  ideas: () => production.addIdeas(root, fromFile(first)),
  script: () => editing.importScript(root, first, fromFile(second)),
  plan: () => editing.applyPlan(root, first, fromFile(second)),
  transcribe: () => editing.transcribe(root, first, signal, send),
  handoff: () => ({ file: editing.exportHandoff(root, first) }),
  status: () => review.inspect(root, first, second),
  render: async () => {
    const montage = await review.inspect(root, first, second);
    return review.exportApproved(root, first, second, montage.hash, signal, send);
  },
  preview: async () => {
    const montage = await review.inspect(root, first, second);
    return review.exportApproved(root, first, second, montage.hash, signal, send, { preview: true });
  },
  quality: () => delivery.checkOutput(root, target(first, second, third), signal),
  covers: () => delivery.thumbnails(root, target(first, second, third), {}, signal),
  square: () => production.squareClip(root, { projectId: first, assetId: second }, signal),
  backup: () => production.runBackup(root),
  metrics: () => ({ file: createPublishing(root, null).exportStats() }),
  hyperframe: () => prepareHyperFrame(first, second)
};

async function start() {
  if (!action || values.help) {
    process.stdout.write('11 Récords Studio · npm run studio -- [--root carpeta] comando\n' +
      'list | ideas archivo | script id archivo | plan id archivo | transcribe id | handoff id\n' +
      'status tipo id | render tipo id | preview tipo id | quality tipo id [archivo] | covers tipo id [archivo]\n' +
      'square id recurso | backup | metrics | hyperframe id archivo\n' +
      'tipo: short o week. Confirma las escenas en la app antes de exportar.\n');
    return;
  }
  if (!Object.hasOwn(actions, action)) throw Error('Comando desconocido. Usa --help.');
  store.ensureRoot(root);
  const result = await actions[action]();
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

start().catch(error => {
  process.stderr.write(error.message + '\n');
  process.exitCode = signal.aborted ? 130 : 1;
});
