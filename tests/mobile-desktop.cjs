'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const store = require('../backend/store.cjs');
const media = require('../backend/media.cjs');

const assets = new Map([
  ['/grabador/', ['index.html', 'text/html']],
  ...['remote.js', 'take-storage.js', 'mobile.js'].map(name => ['/grabador/' + name, [name, 'text/javascript']]),
  ...['mobile.css', 'frame.css'].map(name => ['/grabador/' + name, [name, 'text/css']])
]);

function webFixture() {
  return http.createServer((request, response) => {
    const asset = assets.get(request.url);
    if (!asset) return response.writeHead(404).end();
    response.writeHead(200, { 'content-type': asset[1] });
    response.end(fs.readFileSync(path.join(__dirname, '..', 'grabador', asset[0])));
  });
}

function brokerFixture() {
  const peers = new Map();
  const fixture = {
    offline: false,
    offers: 0,
    mount: context => context.routeWebSocket(/^wss:\/\/0\.peerjs\.com\/peerjs\?/, route => {
      const id = new URL(route.url()).searchParams.get('id');
      peers.set(id, route);
      route.onClose(() => { if (peers.get(id) === route) peers.delete(id); });
      route.onMessage(data => {
        const message = JSON.parse(data);
        if (message.type === 'HEARTBEAT' || fixture.offline) return;
        assert.equal(message.src, id);
        assert.match(message.payload.connectionId, /^dc_[a-f0-9]{32}$/);
        assert.equal(typeof message.payload.metadata.sealed, 'string');
        if (message.type === 'CANDIDATE') assert.equal(message.payload.candidate.candidate, '');
        else {
          assert.equal(message.payload.sdp.sdp, 'v=0\r\n');
          assert.equal(message.payload.serialization, 'json');
          assert.equal(message.payload.reliable, true);
          if (message.type === 'OFFER') fixture.offers++;
        }
        peers.get(message.dst)?.send(JSON.stringify(message));
      });
      route.send(JSON.stringify({ type: 'OPEN' }));
    })
  };
  return fixture;
}

async function checkSaved(root, projectId, scene) {
  const project = store.getProject(root, projectId);
  const id = project.scenes[scene].video;
  assert.ok(id, 'Toma asignada a ' + scene);
  const square = await media.probe(store.resolveAsset(root, projectId, id));
  assert.deepEqual([square.width, square.height, square.hasAudio], [1080, 1080, true]);
  assert.ok(square.duration >= .4);
  const original = await media.probe(store.resolveAsset(root, projectId, id + '-original'));
  assert.ok(original.hasAudio && original.width && original.height);
  assert.equal(project.assets.filter(asset => asset.id === id).length, 1);
}

async function waitForFrames(page, extra) {
  const camera = page.locator('#camera');
  const initial = await camera.evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames);
  await page.waitForFunction(target => document.querySelector('#camera').getVideoPlaybackQuality().totalVideoFrames >= target,
    initial + extra, { timeout: 16000 });
}

async function savedParts(page) {
  await page.waitForFunction(() => new Promise(resolve => {
    const request = indexedDB.open('11-records-mobile', 1);
    request.onsuccess = () => {
      const db = request.result;
      const count = db.transaction('parts').objectStore('parts').count();
      count.onsuccess = () => { db.close(); resolve(count.result > 0); };
      count.onerror = () => { db.close(); resolve(false); };
    };
    request.onerror = () => resolve(false);
  }), null, { timeout: 18000 });
}

async function runMobile(desktop, root, projectId) {
  const server = webFixture();
  const broker = brokerFixture();
  let browser, phone;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    await broker.mount(desktop.context());
    browser = await chromium.launch({
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-gpu',
        '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required']
    });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await broker.mount(context);
    await context.grantPermissions(['camera', 'microphone'], { origin });
    await context.addInitScript(() => {
      const Native = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Native {
        createDataChannel(...args) {
          return window.fixtureChannel = super.createDataChannel(...args);
        }
      };
    });
    phone = await context.newPage();
    phone.setDefaultTimeout(22000);
    const errors = [];
    phone.on('pageerror', error => errors.push(error.message));

    const controls = desktop.locator('details[data-tool="recording"]');
    const open = async scene => {
      await desktop.locator('button[data-action="scene"][data-id="' + scene + '"]').click();
      if (await controls.getAttribute('open') === null) await controls.locator('summary').click();
      await controls.getByRole('button', { name: 'Grabar con celular' }).click();
    };
    await open('body');
    await desktop.waitForFunction(() => document.querySelector('#mobile-link')?.value.includes('/grabador/#'));
    const personal = new URL(await desktop.locator('#mobile-link').inputValue());
    assert.equal(personal.origin + personal.pathname, 'https://jeffer91.github.io/videoslistodoble/grabador/');
    assert.match(personal.hash, /^#[a-f0-9]{64}$/);
    await phone.goto(origin + '/grabador/' + personal.hash);
    await phone.getByText('Conectado a 11 Récords Studio', { exact: true }).waitFor();
    assert.ok(await phone.locator('.mobile-guide').isVisible());
    await phone.getByRole('button', { name: 'Activar cámara y micrófono' }).click();
    await desktop.getByText('Celular conectado · cámara y micrófono listos').waitFor();
    await desktop.waitForFunction(() => document.querySelector('#mobile-preview').videoWidth > 0);
    await desktop.locator('#mobile-test').click();
    await desktop.locator('#mobile-test-audio').waitFor();
    await desktop.waitForFunction(() => document.querySelector('#mobile-test-audio').readyState >= 1);

    await desktop.locator('#mobile-start').click();
    await phone.getByText('Grabando. Mantén esta página abierta.', { exact: true }).waitFor();
    await waitForFrames(phone, 42);
    await savedParts(phone);
    await desktop.locator('#mobile-pause').click();
    await phone.getByText('Grabación en pausa.', { exact: true }).waitFor();
    await desktop.getByRole('button', { name: 'Reanudar', exact: true }).click();
    await phone.getByText('Grabando. Mantén esta página abierta.', { exact: true }).waitFor();
    await waitForFrames(phone, 42);
    await desktop.locator('#mobile-stop').click();
    await phone.getByText('Toma guardada en Windows.', { exact: true }).waitFor({ timeout: 35000 });
    await checkSaved(root, projectId, 'body');

    await desktop.locator('#mobile-close').click();
    await open('closing');
    assert.equal(await desktop.locator('#mobile-link').inputValue(), personal.toString());
    await desktop.locator('#mobile-start').click();
    await phone.getByText('Grabando. Mantén esta página abierta.', { exact: true }).waitFor();
    await waitForFrames(phone, 75);
    await savedParts(phone);
    broker.offline = true;
    await phone.evaluate(() => window.fixtureChannel.close());
    await phone.getByText(/Windows desconectado/).waitFor();
    await waitForFrames(phone, 42);
    await phone.getByRole('button', { name: 'Detener grabación' }).click();
    await phone.getByRole('button', { name: 'Descargar copia' }).waitFor();
    assert.equal(store.getProject(root, projectId).scenes.closing.video, null);
    await phone.reload();
    await phone.getByText('Hay una toma guardada en este celular.', { exact: true }).waitFor();
    broker.offline = false;
    await phone.getByText('Toma guardada en Windows.', { exact: true }).waitFor({ timeout: 42000 });
    await desktop.getByText('Toma guardada en el proyecto y en Cierre.', { exact: true }).waitFor();
    await checkSaved(root, projectId, 'closing');
    assert.ok(broker.offers >= 2);
    assert.deepEqual(errors, []);
    await desktop.locator('#mobile-close').click();
    console.log('Grabadora móvil verificada con WebRTC, cámara y micrófono simulados, pausa y transferencia recuperada tras recargar.');
  } catch (error) {
    if (phone && !phone.isClosed()) {
      const mobile = await phone.locator('#connection,#status').allTextContents().catch(() => []);
      const pc = await desktop.locator('#mobile-connection,#mobile-status,#mobile-test-status').allTextContents().catch(() => []);
      console.error('Estado de prueba móvil:', { mobile, pc, offers: broker.offers });
      const pending = path.join(root, 'Temporales', 'Celular');
      for (const id of fs.existsSync(pending) ? fs.readdirSync(pending) : []) {
        const draft = store.readJSON(path.join(pending, id, 'toma.json'));
        const original = path.join(pending, id, 'original.' + draft.format);
        if (fs.existsSync(original)) {
          const format = await media.probe(original).catch(probeError => probeError.message);
          console.error('Captura móvil en disco:', { bytes: draft.offset, expected: draft.size, format });
        }
      }
    }
    throw error;
  } finally {
    await browser?.close();
    server.close();
  }
}

module.exports = { runMobile };
