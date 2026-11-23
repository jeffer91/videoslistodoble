'use strict';
const fs=require('node:fs'), vm=require('node:vm'), test=require('node:test'), assert=require('node:assert/strict');
const code=fs.readFileSync(require.resolve('../browser-stats/read.js'),'utf8');
for(const [network,href,id] of [
  ['youtube','https://studio.youtube.com/video/0123456789a/edit','0123456789a'],
  ['tiktok','https://www.tiktok.com/tiktokstudio/analytics/post/9234567890123456789','9234567890123456789'],
  ['instagram','https://www.instagram.com/reel/Ab-123/','Ab-123'],
  ['facebook','https://www.facebook.com/reel/1234','1234'],
]){
  test('lector visible de '+network+' reconoce el enlace y conserva ceros y cifras abreviadas',()=>{
    const anchor={href,innerText:'Récord',getClientRects:()=>[1],closest:()=>row};
    const row={innerText:'Visualizaciones\n1,2 mil\nComentarios\n0',closest:()=>null,querySelector:()=>null,
      querySelectorAll:s=>s==='a[href]'?[anchor]:[]};
    const document={documentElement:{lang:'es'},querySelector:()=>null,querySelectorAll:()=>[anchor]};
    const read=vm.runInNewContext(code,{document,URL,location:new URL('https://www.'+network+'.com/')});
    const result=read(network);
    assert.equal(result[0].externalId,id);
    assert.equal(result[0].metrics.views,1200);
    assert.equal(result[0].metrics.comments,0);
    assert.equal(result[0].metrics.likes,undefined);
  });
}

const {normalizeFacebookGroupUrl}=require('../backend/browser-statistics.cjs');

test('Facebook: el grupo acepta barra final, dominio móvil y parámetros normales',()=>{
  assert.equal(normalizeFacebookGroupUrl('https://www.facebook.com/groups/11contra11/'),
    'https://www.facebook.com/groups/11contra11');
  assert.equal(normalizeFacebookGroupUrl('https://m.facebook.com/groups/123456789/?ref=share#top'),
    'https://www.facebook.com/groups/123456789');
  assert.equal(normalizeFacebookGroupUrl(''), '');
});

test('Facebook: el lector rechaza URL ajena o ruta de publicación, no las ignora',()=>{
  for(const url of [
    'https://facebook.com.ejemplo.com/groups/123',
    'https://www.facebook.com/groups/123/posts/456',
    'http://www.facebook.com/groups/123',
    'https://www.facebook.com/pages/123'
  ])assert.throws(()=>normalizeFacebookGroupUrl(url),/enlace HTTPS directo/);
  assert.throws(()=>normalizeFacebookGroupUrl('esto no es una URL'),/no es una URL válida/);
});
