'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const store = require('../backend/store.cjs');
const media = require('../backend/media.cjs');
const { runMobile } = require('./mobile-desktop.cjs');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-desktop-'));
  const executablePath = process.env.RECORDS_DESKTOP_EXECUTABLE;
  const switches = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-gpu', '--disable-features=WebRtcHideLocalIpsWithMdns'];
  if (process.platform === 'linux' && !process.env.DISPLAY) switches.push('--headless', '--ozone-platform=headless', '--no-sandbox');
  let app, page;
  try {
    app = await electron.launch({
      executablePath,
      args: [...(executablePath ? [] : [path.resolve(__dirname, '..')]), ...switches],
      env: { ...process.env, RECORDS_TEST_ROOT: root },
      timeout: 25000
    });
    page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.getByRole('heading', { name: 'Calendario de producción' }).waitFor();
    await page.getByRole('button', { name: 'Ideas', exact: true }).click();
    await page.locator('#idea-title').fill('El récord de Quito');
    await page.locator('#idea-source').fill('Fixture de acta oficial');
    await page.getByRole('button', { name: 'Guardar idea' }).click();
    await page.getByRole('button', { name: 'Aprobar', exact: true }).click();
    await page.getByRole('heading', { name: 'Ficha del récord' }).waitFor();
    await page.locator('#card-script-hook').fill('El momento que marcó la historia de este estadio.');
    await page.locator('#card-script-hook').press('Tab');
    await page.getByRole('button', { name: 'Grabar y editar' }).click();
    const recordingPanel = page.locator('details[data-tool="recording"]');
    await recordingPanel.waitFor();
    if (await recordingPanel.getAttribute('open') === null) await recordingPanel.locator('summary').click();
    await recordingPanel.getByRole('button', { name: 'Grabar ahora' }).click();
    await page.locator('#microphone-meter').waitFor();
    await page.waitForFunction(() => document.querySelector('#camera-preview')?.videoWidth > 0);
    await page.getByRole('button', { name: 'Iniciar grabación' }).click();
    await page.getByText('Guardando en disco', { exact: true }).waitFor({ timeout: 25000 });
    await page.getByRole('button', { name: 'Pausar', exact: true }).click();
    await page.getByRole('button', { name: 'Reanudar', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#record-clock')?.textContent !== '0:00');
    const drafts = await page.evaluate(() => window.studio.call('studio:flow', { action: 'take.list' }));
    assert.ok(drafts.data?.some(draft => draft.bytes >= 100), 'La captura produjo fragmentos válidos');
    await page.getByRole('button', { name: 'Detener', exact: true }).click();
    await page.getByRole('button', { name: 'Guardar toma' }).waitFor();
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page.getByRole('button', { name: 'Recuperar toma', exact: true }).click();
    await page.getByRole('button', { name: 'Usar toma', exact: true }).click();
    await page.getByText('Toma conservada con su audio y encuadre cuadrado').waitFor();
    const p = store.getProject(root, store.listProjects(root)[0].id);
    const info = await media.probe(store.resolveAsset(root, p.id, p.scenes.hook.video));
    assert.deepEqual([info.width, info.height, info.hasAudio], [1080, 1080, true]);
    assert.ok(info.duration >= .5);
    await runMobile(page, root, p.id);
    await page.getByRole('button', { name: 'Ficha y guion' }).click();
    await page.getByRole('heading', { name: 'Ficha del récord' }).waitFor();
    assert.match(await page.locator('#card-script-hook').inputValue(), /historia/);
    await page.getByRole('button', { name: 'Transcripción y plan' }).click();
    await page.getByRole('heading', { name: 'Transcripción y plan de edición' }).waitFor();
    await page.locator('#plan-voice').selectOption('podcast');
    await page.getByRole('button', { name: 'Guardar ajustes de edición' }).click();
    await page.getByText('Origen del plan · Manual').waitFor();
    await page.waitForFunction(() => window.studio.call('projects:list').then(result =>
      result.data.some(item => item.stage === 'planificado')));
    await page.getByRole('button', { name: 'Configuración' }).click();
    await page.getByRole('heading', { name: 'Respaldo de la biblioteca' }).waitFor();
    await page.getByRole('button', { name: 'Publicación', exact: true }).click();
    await page.getByRole('heading', { name: 'Cola' }).waitFor();
    await page.getByRole('button', { name: 'Estadísticas', exact: true }).click();
    await page.getByRole('heading', { name: 'Rendimiento por video' }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Electron verificado: inicio, ideas, ficha, grabación 1080² con audio, pausa, recuperación, edición y pantallas de publicación.');
  } catch (error) {
    if (page && !page.isClosed()) {
      const state = await page.evaluate(() => ({
        heading: document.querySelector('h1')?.textContent,
        toast: document.querySelector('#toast')?.textContent,
        camera: document.querySelector('#camera-preview')?.videoWidth
      })).catch(() => null);
      if (state) console.error('Pantalla al fallar:', JSON.stringify(state));
      const pending = path.join(root, 'Temporales', 'Tomas');
      if (fs.existsSync(pending)) for (const dir of fs.readdirSync(pending)) {
        const info = path.join(pending, dir, 'toma.json');
        if (fs.existsSync(info)) {
          const { bytes, chunks } = store.readJSON(info);
          console.error('Toma en disco:', bytes, 'bytes y', chunks, 'fragmentos');
        }
      }
    }
    throw error;
  } finally {
    await app?.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
