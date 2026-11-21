'use strict';
/**
 * Prueba de extremo a extremo del apartado «Videos largos directos» en Electron
 * con cámara y micrófono simulados: guion → grabación con teleprompter →
 * propuesta de composición → exportación → vuelta a los apartados existentes.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const SCRIPT = [
  'Bienvenidos a Once Records.',
  '',
  '━━━━━━━━━━━━━━━━━━',
  'SECCIÓN 01 · EL COMIENZO',
  '━━━━━━━━━━━━━━━━━━',
  '',
  'Durante años, [IMAGEN: Harry Kane Tottenham] Harry Kane fue el gran goleador del Tottenham. Marcó 280 goles con el club.',
  '',
  '━━━━━━━━━━━━━━━━━━',
  'SECCIÓN 02 · EL ASCENSO',
  '━━━━━━━━━━━━━━━━━━',
  '',
  'Su camino hacia la élite no fue sencillo. Creo que nadie lo vio venir. Suscríbete al canal.'
].join('\n');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-desktop-'));
  const switches = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-gpu'];
  if (process.platform === 'linux' && !process.env.DISPLAY) switches.push('--headless', '--ozone-platform=headless', '--no-sandbox');
  const executablePath = process.env.RECORDS_DESKTOP_EXECUTABLE;
  let app, page;
  try {
    app = await electron.launch({ executablePath, args: [...(executablePath ? [] : [path.resolve(__dirname, '..')]), ...switches], env: { ...process.env, RECORDS_TEST_ROOT: root }, timeout: 30000 });
    page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(20000);
    await page.getByRole('heading', { name: 'Estudio de videos' }).waitFor();

    // Apartado 3 independiente.
    await page.getByRole('button', { name: 'Videos largos directos', exact: true }).click();
    await page.getByRole('heading', { name: 'Videos largos directos' }).waitFor();
    assert.equal(await page.locator('#view').isHidden(), true, 'La vista de los otros apartados queda oculta, no modificada');
    await page.getByRole('button', { name: '＋ Nuevo proyecto' }).click();
    await page.locator('#dl-new-title').fill('Harry Kane: la historia');
    await page.getByRole('button', { name: 'Crear proyecto' }).click();

    // Guion pegado con el formato de Once Records.
    await page.locator('#dl-paste').fill(SCRIPT);
    await page.getByRole('button', { name: 'Detectar secciones' }).click();
    await page.getByText('3 secciones detectadas').waitFor();
    await page.getByRole('button', { name: 'Aplicar al proyecto' }).click();
    await page.locator('.dl-script-sec').nth(2).waitFor();
    const titles = await page.locator('.dl-title-input').evaluateAll(list => list.map(i => i.value));
    assert.deepEqual(titles, ['Introducción', 'El comienzo', 'El ascenso']);
    const texts = await page.locator('.dl-script-sec textarea').evaluateAll(list => list.map(i => i.value).join('\n'));
    assert.ok(!texts.includes('━') && !texts.includes('SECCIÓN 0'), 'Separadores y encabezados fuera del texto narrable');

    // Grabación seguida: al detener, la toma se guarda y tras 3 s empieza la siguiente sección.
    // (El piloto automático se prueba en tests/direct-auto.test.cjs; aquí se desactiva para no exportar dos veces.)
    await page.evaluate(() => window.DirectLong.call('settings.save', { id: window.DirectLong.state.project.id,
      settings: { autopilot: { enabled: false }, recording: { continuous: true, autoStop: false } } }).then(p => { window.DirectLong.state.project = p; }));
    await page.getByRole('button', { name: '2 · Grabación' }).click();
    await page.getByText('Piloto automático desactivado').waitFor();
    await page.locator('#dl-prompter-host .dl-prompter-text').waitFor();
    const prompt = await page.locator('#dl-prompter-host').innerText();
    assert.ok(!prompt.includes('━') && !prompt.includes('SECCIÓN') && !prompt.includes('IMAGEN'), 'El teleprompter solo muestra texto narrable');
    await page.getByRole('button', { name: 'Activar cámara y micrófono' }).click();
    await page.waitForFunction(() => document.querySelector('#dl-camera')?.videoWidth > 0);
    await page.getByRole('button', { name: '● Iniciar grabación' }).click();
    for (let index = 0; index < 3; index++) {
      await page.getByText(/Guardando en disco/).waitFor({ timeout: 25000 });
      await page.waitForTimeout(2600);
      await page.getByRole('button', { name: '■ Detener' }).click();
      await page.waitForFunction(n => window.DirectLong.state.project.sections.filter(s => s.take).length === n, index + 1, { timeout: 30000 });
      if (index < 2) await page.locator('#dl-countdown').waitFor();
    }
    const state = await page.evaluate(() => window.DirectLong.state.project.sections.map(s => ({ take: Boolean(s.take), duration: s.take?.duration })));
    assert.ok(state.every(s => s.take && s.duration > 1), 'Las tres secciones tienen su toma');

    // El teleprompter nunca entra en la grabación: la mitad superior de la toma no está oscurecida.
    const projectId = await page.evaluate(() => window.DirectLong.state.project.id);
    const project = JSON.parse(fs.readFileSync(path.join(root, 'Directos', projectId, 'proyecto.json'), 'utf8'));
    const media = require('../backend/media.cjs');
    const takeFile = path.join(root, 'Directos', projectId, ...project.sections[1].take.original.split('/'));
    const frame = path.join(root, 'frame.png');
    await media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', takeFile, '-frames:v', '1', frame]);
    const sharp = require('sharp');
    const { width, height } = await sharp(frame).metadata();
    assert.equal(width, 1080); assert.equal(height, 1080);
    const top = await sharp(frame).extract({ left: 0, top: 0, width: 1080, height: 400 }).stats();
    const bottom = await sharp(frame).extract({ left: 0, top: 680, width: 1080, height: 400 }).stats();
    const lum = s => s.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3;
    assert.ok(lum(top) > lum(bottom) * 0.6, 'La zona del teleprompter no aparece en la toma (' + lum(top).toFixed(1) + ' / ' + lum(bottom).toFixed(1) + ')');

    // Edición con propuesta inteligente.
    await page.getByRole('button', { name: '3 · Edición' }).click();
    await page.locator('#ed-canvas').waitFor();
    await page.locator('.dl-sections button').nth(1).click();
    await page.getByRole('button', { name: 'Proponer composición' }).click();
    await page.getByRole('button', { name: 'Aplicar propuesta' }).click();
    await page.waitForFunction(() => window.DirectLong.state.project.sections[1].layouts.length > 0);
    await page.waitForTimeout(800);

    // Exportación rápida y verificación del MP4.
    await page.getByRole('button', { name: '6 · Exportar y publicar' }).click();
    await page.getByRole('button', { name: 'Vista previa rápida (960 × 540)' }).click();
    await page.getByText(/Vista previa lista/).waitFor({ timeout: 240000 });
    const exported = JSON.parse(fs.readFileSync(path.join(root, 'Directos', projectId, 'proyecto.json'), 'utf8')).exports.at(-1);
    const info = await media.probe(path.join(root, 'Directos', projectId, ...exported.file.split('/')));
    assert.equal(info.width, 960);
    assert.ok(info.hasAudio && info.duration > 8, 'MP4 con audio y las tres secciones');
    assert.equal(exported.chapters.length, 3);

    // Los apartados existentes siguen funcionando.
    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await page.getByRole('heading', { name: 'Estudio de videos' }).waitFor();
    assert.equal(await page.locator('#direct-view').isHidden(), true);
    await page.getByRole('button', { name: '▣   Videos largos' }).click().catch(() => page.locator('[data-action="weeks"]').click());
    await page.locator('#view h1').first().waitFor();
    assert.deepEqual(errors, []);
    console.log('Videos largos directos: flujo completo verificado en Electron');
  } catch (error) {
    if (process.env.DIRECT_DEBUG && page) {
      await page.screenshot({ path: process.env.DIRECT_DEBUG }).catch(() => {});
      console.error('Aviso visible:', await page.locator('#toast').innerText().catch(() => ''));
    }
    throw error;
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exit(1); });
