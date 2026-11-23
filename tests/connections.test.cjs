'use strict';
/** Conexiones oficiales: autorización de TikTok (PKCE local), páginas de Facebook y cierre ordenado del navegador. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const clients = require('../backend/network-clients.cjs');
const { closeGracefully } = require('../backend/browser-statistics.cjs');

function withFetch(handler, run) {
  const original = global.fetch;
  global.fetch = async (url, options = {}) => handler(new URL(String(url)), options);
  return run().finally(() => { global.fetch = original; });
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('TikTok: autoriza en el navegador con PKCE y devuelve accesos renovables', async () => {
  let link, tokenBody;
  await withFetch(async (url, options) => {
    assert.equal(url.href, 'https://open.tiktokapis.com/v2/oauth/token/');
    tokenBody = new URLSearchParams(options.body);
    return json({ access_token: 'act.1', refresh_token: 'rft.1', expires_in: 7200, refresh_expires_in: 15552000, open_id: 'o', scope: 'user.info.basic,video.list' });
  }, async () => {
    const secrets = await clients.tiktokOAuth({ clientKey: 'aw1234567890', clientSecret: 'secreto', stats: true }, async destination => {
      link = new URL(destination);
      // Simula que TikTok redirige al servidor local tras aceptar.
      const back = new URL(link.searchParams.get('redirect_uri'));
      back.searchParams.set('code', 'codigo');
      back.searchParams.set('state', link.searchParams.get('state'));
      setTimeout(() => http.get(back), 20);
    });
    assert.equal(link.origin + link.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
    assert.match(link.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback\/$/);
    assert.equal(link.searchParams.get('scope'), 'user.info.basic,video.list,user.info.stats');
    assert.equal(link.searchParams.get('code_challenge_method'), 'S256');
    // TikTok exige el desafío en hexadecimal para apps de escritorio.
    assert.equal(link.searchParams.get('code_challenge'), createHash('sha256').update(tokenBody.get('code_verifier')).digest('hex'));
    assert.equal(tokenBody.get('redirect_uri'), link.searchParams.get('redirect_uri'));
    assert.equal(tokenBody.get('code'), 'codigo');
    assert.equal(secrets.accessToken, 'act.1');
    assert.equal(secrets.refreshToken, 'rft.1');
    assert.equal(secrets.clientId, 'aw1234567890');
    assert.ok(Date.parse(secrets.expiresAt) > Date.now() + 7000 * 1000);
  });
  await assert.rejects(clients.tiktokOAuth({ clientKey: '', clientSecret: 'x' }, async () => {}), /Client key/);
});

test('TikTok: la renovación guarda el nuevo token de renovación', async () => {
  await withFetch(async (url, options) => {
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('refresh_token'), 'rft.viejo');
    assert.equal(body.get('client_key'), 'aw1234567890');
    return json({ access_token: 'act.2', refresh_token: 'rft.nuevo', expires_in: 7200 });
  }, async () => {
    const updated = await clients.refresh('tiktok', { accessToken: 'act.1', refreshToken: 'rft.viejo', clientId: 'aw1234567890', clientSecret: 's' });
    assert.equal(updated.accessToken, 'act.2');
    assert.equal(updated.refreshToken, 'rft.nuevo');
  });
});

test('Facebook: amplía el token de usuario y lista las páginas con su acceso permanente', async () => {
  const seen = [];
  await withFetch(async url => {
    seen.push(url.pathname);
    if (url.pathname.endsWith('/oauth/access_token')) {
      assert.equal(url.searchParams.get('grant_type'), 'fb_exchange_token');
      assert.equal(url.searchParams.get('fb_exchange_token'), 'corto');
      return json({ access_token: 'largo', expires_in: 5184000 });
    }
    if (url.pathname.endsWith('/me/accounts')) {
      assert.equal(url.searchParams.get('access_token'), null);
      return json({ data: [{ id: '123', name: 'Once Records', access_token: 'pagina', tasks: ['ANALYZE', 'CREATE_CONTENT'] }] });
    }
    throw Error('URL inesperada ' + url);
  }, async () => {
    const pages = await clients.facebookPages({ appId: '987654321', appSecret: 's', userToken: 'corto' });
    assert.deepEqual(pages.map(p => [p.id, p.name, p.accessToken]), [['123', 'Once Records', 'pagina']]);
  });
  assert.deepEqual(seen.map(p => p.split('/').slice(2).join('/')), ['oauth/access_token', 'me/accounts']);
  await assert.rejects(clients.facebookPages({ appId: 'abc', appSecret: 's', userToken: 't' }), /App ID/);
});

test('Instagram Unified Login: valida el token EAA mediante Graph de Meta', async () => {
  await withFetch(async (url, options) => {
    assert.equal(url.origin, 'https://graph.facebook.com');
    assert.equal(url.pathname, '/v24.0/17841400000000000');
    assert.equal(url.searchParams.get('fields'), 'id,username,followers_count,account_type');
    assert.equal(options.headers.Authorization, 'Bearer EAA-prueba');
    return json({ id: '17841400000000000', username: '11records11', followers_count: 100, account_type: 'CREATOR' });
  }, async () => {
    const identity = await clients.verifyAccount('instagram', {
      provider: 'instagram-unified', profileId: '17841400000000000', accessToken: 'EAA-prueba'
    });
    assert.equal(identity.id, '17841400000000000');
    assert.equal(identity.label, '@11records11');
    assert.equal(identity.followers, 100);
  });
});

test('Instagram: no confunde un token EAA con Instagram Login IGAA', async () => {
  await assert.rejects(
    clients.verifyAccount('instagram', { provider: 'instagram-login', accessToken: 'EAA-prueba' }),
    /Unified Login/
  );
});

test('el navegador del lector se cierra de forma ordenada', async () => {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{require("fs").writeFileSync(process.argv[1],"ok");process.exit(0)});setInterval(()=>{},1000)', require('node:path').join(require('node:os').tmpdir(), 'cierre-' + process.pid)]);
  await new Promise(r => setTimeout(r, 300));
  const closed = new Promise(r => child.once('exit', r));
  closeGracefully(child.pid, 3000);
  await closed;
  if (process.platform !== 'win32') assert.equal(require('node:fs').readFileSync(require('node:path').join(require('node:os').tmpdir(), 'cierre-' + process.pid), 'utf8'), 'ok');
});
