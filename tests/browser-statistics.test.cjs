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
