'use strict';
process.env.RECORDS_PIPER ??= 'off'; // el narrador (Piper) se prueba aparte: sin descargas
/**
 * Prueba de extremo a extremo de las subsecciones en cadena (Videos largos
 * directos) en Electron con cámara y micrófono simulados:
 * guion con 1.1, 1.2, 1.3 → grabar cada una a continuación de la anterior →
 * repetir 1.2 → copiar el formato del guion al portapapeles de Windows.
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
  'SECCIÓN 01 · LA HISTORIA DE WAYNE ROONEY',
  '━━━━━━━━━━━━━━━━━━',
  '',
  '[MÚSICA: emotiva]',
  '',
  '▸ SUBSECCIÓN 1.1 · PAPÁ Y MAMÁ',
  'Su padre trabajaba en el puerto de Liverpool.',
  '',
  '▸ SUBSECCIÓN 1.2 · LOS HERMANOS',
  'Tenía dos hermanos menores que también jugaban.',
  '',
  '▸ SUBSECCIÓN 1.3 · CROXTETH',
  'Creció en el barrio obrero de Croxteth.'
].join('\n');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-parts-'));
  const switches = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-gpu'];
  if (process.platform === 'linux' && !process.env.DISPLAY) switches.push('--headless', '--ozone-platform=headless', '--no-sandbox');
  const executablePath = process.env.RECORDS_DESKTOP_EXECUTABLE;
  let app, page;
  try {
    app = await electron.launch({ executablePath, args: [...(executablePath ? [] : [path.resolve(__dirname, '..')]), ...switches], env: { ...process.env, RECORDS_TEST_ROOT: root }, timeout: 30000 });
    page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    page.setDefaultTimeout(20000);
    await page.getByRole('heading', { name: 'Estudio de videos' }).waitFor();
    await page.getByRole('button', { name: 'Videos largos directos', exact: true }).click();
    await page.getByRole('button', { name: '＋ Nuevo proyecto' }).click();
    await page.locator('#dl-new-title').fill('Wayne Rooney');
    await page.getByRole('button', { name: 'Crear proyecto' }).click();

    // «Copiar formato del guion» va directo al portapapeles de Windows y explica las subsecciones.
    await page.getByRole('button', { name: '📋 Copiar formato del guion' }).first().click();
    await page.getByText(/Formato copiado/).waitFor();
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.match(copied, /Wayne Rooney/);
    assert.match(copied, /▸ SUBSECCIÓN 1\.1 · /);
    assert.match(copied, /2\.1, 2\.2/);

    // El guion se divide en 2 secciones; la 01 tiene 3 subsecciones.
    await page.locator('#dl-paste').fill(SCRIPT);
    await page.getByRole('button', { name: 'Detectar secciones' }).click();
    await page.getByText('2 secciones detectadas').waitFor();
    await page.getByText(/3 subsecciones \(1\.1–1\.3\)/).first().waitFor();
    await page.getByRole('button', { name: 'Aplicar al proyecto' }).click();
    await page.locator('.dl-script-sec').nth(1).waitFor();

    await page.evaluate(() => window.DirectLong.call('settings.save', { id: window.DirectLong.state.project.id,
      settings: { autopilot: { enabled: false }, recording: { continuous: true, autoStop: false } } }).then(p => { window.DirectLong.state.project = p; }));
    await page.getByRole('button', { name: '2 · Grabación' }).click();
    await page.locator('.dl-sections button').nth(1).click();
    await page.locator('.dl-parts').waitFor();
    const prompterText = () => page.locator('#dl-prompter-host').innerText();
    const chain = () => page.evaluate(() => (window.DirectLong.state.project.sections[1].take?.chain || []).map(p => p.label));
    let text = await prompterText();
    assert.match(text, /puerto de Liverpool/);
    assert.ok(!/hermanos|Croxteth|SUBSECCI/.test(text), 'El teleprompter solo muestra la subsección 1.1: ' + text);
    assert.match(await page.locator('.dl-part-now').innerText(), /1\.1 · Papá y mamá/);

    await page.getByRole('button', { name: 'Activar cámara y micrófono' }).click();
    await page.waitForFunction(() => document.querySelector('#dl-camera')?.videoWidth > 0);
    const recordFor = async ms => {
      await page.getByText(/Guardando en disco/).waitFor({ timeout: 30000 });
      await page.waitForTimeout(ms);
      await page.getByRole('button', { name: '■ Detener' }).click();
      await page.locator('#dl-reviewbar').waitFor({ state: 'visible', timeout: 90000 });
    };

    // 1.1
    await page.getByRole('button', { name: '● Grabar 1.1' }).click();
    await recordFor(2600);
    await page.getByRole('button', { name: 'Guardar 1.1' }).click();
    await page.waitForFunction(() => window.DirectLong.state.project.sections[1].take?.chain?.length === 1, null, { timeout: 30000 });
    const first = await page.evaluate(() => window.DirectLong.state.project.sections[1].take);

    // 1.2 sigue la toma (preroll + fundido) y «Guardar y seguir» arranca 1.3 solo.
    await page.getByRole('button', { name: '● Grabar 1.2 (sigue la toma)' }).click();
    text = await prompterText();
    assert.match(text, /hermanos menores/);
    assert.ok(!/Liverpool|Croxteth/.test(text), 'Teleprompter en 1.2: ' + text);
    await recordFor(2600);
    await page.getByText(/1\.2 unida/).waitFor();
    await page.getByRole('button', { name: 'Guardar y seguir' }).click();
    await page.locator('#dl-countdown').getByText(/Siguiente: 1\.3 · Croxteth/).waitFor({ timeout: 30000 });
    assert.deepEqual(await chain(), ['1.1', '1.2']);
    await recordFor(2600);
    assert.match(await prompterText(), /Croxteth/);
    await page.getByRole('button', { name: 'Guardar 1.3' }).click();
    await page.waitForFunction(() => window.DirectLong.state.project.sections[1].take?.chain?.length === 3, null, { timeout: 30000 });
    const full = await page.evaluate(() => window.DirectLong.state.project.sections[1].take);
    assert.ok(full.duration > first.duration + 3, 'La toma creció con cada subsección: ' + first.duration + ' → ' + full.duration);
    await page.getByText(/3\/3 subsecc\./).first().waitFor();

    // Repetir 1.2: se conserva 1.1 y la cadena vuelve a 1.2 (1.3 queda pendiente).
    // Con la sección completa se pasa a la siguiente sin grabar; se vuelve a la 01.
    assert.equal(await page.evaluate(() => window.DirectLong.state.sectionId === window.DirectLong.state.project.sections[0].id), true);
    await page.locator('.dl-sections button').nth(1).click();
    await page.locator('.dl-parts li').nth(1).getByRole('button', { name: '↺ Repetir' }).click();
    await page.locator('#dl-splicebar').waitFor({ state: 'visible' });
    assert.match(await page.locator('#dl-splice-info').innerText(), /Grabas 1\.2 a continuación/);
    assert.match(await prompterText(), /hermanos menores/);
    await page.getByRole('button', { name: '● Grabar desde aquí' }).click();
    await recordFor(2600);
    await page.getByRole('button', { name: 'Guardar 1.2' }).click();
    await page.waitForFunction(() => window.DirectLong.state.project.sections[1].take?.chain?.length === 2, null, { timeout: 30000 });
    assert.deepEqual(await chain(), ['1.1', '1.2']);
    await page.getByRole('button', { name: '● Grabar 1.3 (sigue la toma)' }).waitFor();
    assert.equal(await page.evaluate(() => window.DirectLong.call('take.pending', { id: window.DirectLong.state.project.id }).then(l => l.length)), 0, 'Sin borradores sobrantes');
    if (process.env.DIRECT_SHOT) await page.screenshot({ path: process.env.DIRECT_SHOT });
    assert.deepEqual(errors, []);
    console.log('Subsecciones en cadena: flujo completo verificado en Electron');
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
