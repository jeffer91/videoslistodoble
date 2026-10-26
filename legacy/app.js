const $=id=>document.getElementById(id),canvas=$('stage'),ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height;
let step=0,approved=[false,false,false];let exportAbort=false,exportSession=0;let trimPreviewTimer=null,renderEpoch=0;const sceneMeta=Array.from({length:3},()=>({title:'',number:'',name:'',layout:'auto',position:'left',scale:'65'}));let trims=[{start:0,end:0},{start:0,end:0},{start:0,end:0}],photoCrop=[false,false,false];let clips=[],pictures=[],scenePictures=[[],[],[]],urls=[],segmenter=null,mask=null,ready=false,playing=false,recorder=null,audioCtx=null,activeVideo=null,raf=0;
function status(s,p){$('status').textContent=s;if(p!==undefined)$('progress').value=p}
function cleanup(){playing=false;renderEpoch++;cancelAnimationFrame(raf);if(trimPreviewTimer){clearInterval(trimPreviewTimer);trimPreviewTimer=null}if(activeVideo){activeVideo.pause();activeVideo=null}if(audioCtx){audioCtx.close().catch(()=>{});audioCtx=null}}
function drawCover(image,x,y,w,h){const iw=image.videoWidth||image.naturalWidth,ih=image.videoHeight||image.naturalHeight;if(!iw||!ih)return;const k=Math.max(w/iw,h/ih),sw=w/k,sh=h/k,sx=(iw-sw)/2,sy=(ih-sh)/2;ctx.drawImage(image,sx,sy,sw,sh,x,y,w,h)}
function backdrop(t){const mode=$('fallback').value,colors=mode==='purple'?['#081b0b','#247b36']:mode==='dark'?['#090d0a','#182c1d']:['#06160b','#16833a'];const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,colors[0]);g.addColorStop(1,colors[1]);ctx.fillStyle=g;ctx.fillRect(0,0,W,H);for(let i=0;i<8;i++){ctx.strokeStyle='rgba(255,255,255,.09)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(W/2,H/2,90+i*70+t*3,0,Math.PI*2);ctx.stroke()}}
const sceneStyles=['historic','numbers','legends'];let activeStyle='historic';const personCanvas=document.createElement('canvas'),personCtx=personCanvas.getContext('2d');
function selectedStyle(){return activeStyle}
function ellipse(x,y,rx,ry,color){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill()}
function ball(x,y,r,rotation=0){ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.fillStyle='#f5f5f0';ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#252a26';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#202622';const poly=(cx,cy,rad,n=5)=>{ctx.beginPath();for(let i=0;i<n;i++){const a=-Math.PI/2+i*2*Math.PI/n;i?ctx.lineTo(cx+rad*Math.cos(a),cy+rad*Math.sin(a)):ctx.moveTo(cx+rad*Math.cos(a),cy+rad*Math.sin(a))}ctx.closePath();ctx.fill()};poly(0,0,r*.34);for(let i=0;i<5;i++){const a=i*2*Math.PI/5-Math.PI/2;poly(Math.cos(a)*r*.77,Math.sin(a)*r*.77,r*.19);ctx.beginPath();ctx.moveTo(Math.cos(a)*r*.32,Math.sin(a)*r*.32);ctx.lineTo(Math.cos(a)*r*.58,Math.sin(a)*r*.58);ctx.stroke()}ctx.restore()}
function labelText(text,x,y,size=32,color='#fff',align='left'){ctx.textAlign=align;ctx.fillStyle=color;ctx.font='900 '+size+'px system-ui';ctx.fillText(text,x,y)}
function recordData(scene){const d=sceneMeta[scene]||sceneMeta[0];return{title:d.title.slice(0,90),number:d.number.slice(0,16),name:d.name.slice(0,44)}}
function saveSceneMeta(){if(step>2)return;const d=sceneMeta[step];for(const k of ['title','number','name'])d[k]=$('record'+k[0].toUpperCase()+k.slice(1)).value.trim();d.layout=$('layoutMode').value;d.position=$('position').value;d.scale=$('scale').value}
function restoreSceneMeta(){const d=sceneMeta[step];for(const k of ['title','number','name'])$('record'+k[0].toUpperCase()+k.slice(1)).value=d[k];$('layoutMode').value=d.layout;$('position').value=d.position;$('scale').value=d.scale}
function footballBackground(t,mode,scene){const g=ctx.createLinearGradient(0,0,0,H);if(mode==='historic'){g.addColorStop(0,'#020a0b');g.addColorStop(.52,'#122c25');g.addColorStop(1,'#164d2b')}else if(mode==='numbers'){g.addColorStop(0,'#070c0b');g.addColorStop(.6,'#111b16');g.addColorStop(1,'#07100d')}else{g.addColorStop(0,'#10100e');g.addColorStop(.6,'#262016');g.addColorStop(1,'#0c1410')}ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
if(mode==='historic'){ctx.fillStyle='#0b1b14';ctx.fillRect(0,260,W,330);for(let r=0;r<9;r++)for(let c=0;c<36;c++){ctx.fillStyle=(r+c)%7===0?'rgba(255,235,160,.35)':'rgba(180,226,192,.12)';ctx.fillRect(c*16,285+r*27,5,3)}for(const x of [80,460]){const light=ctx.createRadialGradient(x,180,2,x,180,260);light.addColorStop(0,'rgba(255,247,199,.45)');light.addColorStop(1,'rgba(255,247,199,0)');ctx.fillStyle=light;ctx.fillRect(0,0,W,550)}ctx.fillStyle='#1d6434';ctx.beginPath();ctx.moveTo(0,H);ctx.lineTo(W,H);ctx.lineTo(410,650);ctx.lineTo(130,650);ctx.fill();ctx.strokeStyle='rgba(235,250,223,.3)';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(130,650);ctx.lineTo(410,650);ctx.moveTo(0,835);ctx.lineTo(W,835);ctx.stroke();labelText('HISTORIA DEL FÚTBOL',270,170,25,'#e2c88a','center');labelText('RÉCORD MUNDIAL',270,245,39,'#fff','center')}
else if(mode==='numbers'){ctx.fillStyle='#0b2519';ctx.fillRect(30,145,480,470);ctx.strokeStyle='#27b65d';ctx.lineWidth=5;ctx.strokeRect(30,145,480,470);ctx.fillStyle='#b82732';ctx.fillRect(30,145,480,12);labelText('EL DATO IMPOSIBLE',270,210,30,'#e6f7e8','center');for(let i=0;i<9;i++){ctx.fillStyle=i%3?'#155d36':'#c82b35';ctx.fillRect(45+i*51,530-(Math.sin(i*1.4+t*.6)+1)*55,27,130)}ctx.fillStyle='#07110d';ctx.fillRect(0,635,W,325);labelText('11 RÉCORDS',270,695,35,'#30c96b','center')}
else{for(let i=0;i<6;i++){const x=85+i*75;const glow=ctx.createRadialGradient(x,170,0,x,170,100);glow.addColorStop(0,'rgba(255,221,140,.22)');glow.addColorStop(1,'rgba(255,221,140,0)');ctx.fillStyle=glow;ctx.fillRect(x-100,70,200,200)}ctx.fillStyle='#1b2118';ctx.fillRect(225,275,255,310);ctx.strokeStyle='#b9a06a';ctx.lineWidth=7;ctx.strokeRect(225,275,255,310);ctx.fillStyle='#b9a06a';ctx.beginPath();ctx.moveTo(315,345);ctx.lineTo(375,345);ctx.lineTo(397,415);ctx.lineTo(375,460);ctx.lineTo(315,460);ctx.lineTo(293,415);ctx.closePath();ctx.fill();ctx.fillRect(325,460,40,45);ctx.fillRect(285,505,120,14);labelText('SALÓN DE LEYENDAS',270,175,29,'#eddbb3','center');ctx.fillStyle='#0c120d';ctx.fillRect(0,735,W,225)}
const d=recordData(scene);if(d.number){ctx.save();ctx.shadowColor=mode==='legends'?'#d9a847':'#16b956';ctx.shadowBlur=18;labelText(d.number,mode==='numbers'?270:mode==='historic'?340:mode==='legends'?350:270,mode==='numbers'?365:mode==='historic'?345:355,mode==='numbers'?145:95,mode==='legends'?'#e9cc83':'#f9fff6','center');ctx.restore()}if(d.name){labelText(d.name.toUpperCase(),mode==='historic'?365:270,mode==='numbers'?445:mode==='historic'?415:425,Math.max(18,Math.min(31,780/d.name.length)),'#f3f8ee','center')}}
// 11 Récords: proportional, orientation-independent layout engine (540 x 960).
// All important content is kept inside a conservative shared safe region.
const SAFE={left:58,top:140,right:445,bottom:645};
function imageInfo(image){const w=image.naturalWidth||image.videoWidth||1,h=image.naturalHeight||image.videoHeight||1;return{w,h,ratio:w/h}}
function fitRect(image,box){const {w,h}=imageInfo(image),k=Math.min(box.w/w,box.h/h),rw=w*k,rh=h*k;return{x:box.x+(box.w-rw)/2,y:box.y+(box.h-rh)/2,w:rw,h:rh}}
function drawContained(image,box){const r=fitRect(image,box);ctx.drawImage(image,r.x,r.y,r.w,r.h);return r}
function drawPhoto(image,box,scene){if(photoCrop[scene]){ctx.save();ctx.beginPath();ctx.rect(box.x,box.y,box.w,box.h);ctx.clip();drawCover(image,box.x,box.y,box.w,box.h);ctx.restore();return box}return drawContained(image,box)}
// Content-aware composition: face detector where available, otherwise image-detail heuristic.
// Full source image is always visible; important subjects are never cropped by default.
const imageProfiles=new WeakMap();
async function analyzePhoto(img){const {w,h,ratio}=imageInfo(img);const profile={ratio,faces:[],detailX:.5,kind:ratio>2.1?'panorama':ratio>1.25?'landscape':ratio<.7?'portrait':'square'};
try{if('FaceDetector'in window){const fd=new FaceDetector({fastMode:true,maxDetectedFaces:12});const faces=await fd.detect(img);profile.faces=faces.map(f=>({x:(f.boundingBox.x+f.boundingBox.width/2)/w,y:(f.boundingBox.y+f.boundingBox.height/2)/h}));if(profile.faces.length>1)profile.kind='group';else if(profile.faces.length===1)profile.kind='portrait-face';}}catch(e){console.warn('Detección de rostros no disponible',e)}
try{const c=document.createElement('canvas');c.width=72;c.height=72;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(img,0,0,72,72);const d=x.getImageData(0,0,72,72).data;let left=0,right=0;for(let y=4;y<68;y+=2)for(let xx=4;xx<68;xx+=2){const p=(y*72+xx)*4,q=(y*72+xx+2)*4;const v=Math.abs(d[p]-d[q])+Math.abs(d[p+1]-d[q+1])+Math.abs(d[p+2]-d[q+2]);if(xx<36)left+=v;else right+=v}profile.detailX=left+right?right/(left+right):.5}catch(e){}
imageProfiles.set(img,profile);return profile}
function profileFor(img){return imageProfiles.get(img)||{ratio:imageInfo(img).ratio,faces:[],detailX:.5,kind:'unknown'}}
function intersects(a,b){return Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y))}
// Photo layouts preserve the three original visual themes.
const sceneLayouts=['auto','auto','auto'];
function layoutFor(video,img,mode,scene=0){
const R={x:SAFE.left,y:SAFE.top,w:SAFE.right-SAFE.left,h:SAFE.bottom-SAFE.top};
const ratio=img?imageInfo(img).ratio:1,wide=ratio>1.28,tall=ratio<.76;
const choices=img?[
{id:'editorial',photo:{x:66,y:218,w:370,h:wide?225:278},speaker:{x:66,y:468,w:205,h:173},tag:{x:278,y:530,w:156,h:98}},
{id:'overlay',photo:{x:65,y:212,w:372,h:340},speaker:{x:65,y:365,w:192,h:270},tag:{x:267,y:555,w:167,h:77}},
{id:'split',photo:{x:238,y:215,w:195,h:325},speaker:{x:65,y:285,w:165,h:300},tag:{x:235,y:555,w:197,h:78}},
{id:'right',photo:{x:65,y:215,w:235,h:320},speaker:{x:295,y:305,w:140,h:265},tag:{x:65,y:548,w:218,h:84}},
{id:'cinema',photo:{x:65,y:217,w:370,h:wide?240:300},speaker:{x:275,y:425,w:158,h:205},tag:{x:67,y:550,w:194,h:81}}
]:[{id:'solo',photo:null,speaker:{x:82,y:300,w:255,h:330},tag:{x:275,y:545,w:155,h:84}}];
const requested=sceneMeta[scene]?.layout||'auto';
let best=choices[0];
if(requested!=='auto'){best=choices.find(c=>c.id===requested)||best}
else if(img){
const profile=profileFor(img);
if(mode==='numbers')best=choices[2];
else if(mode==='legends')best=choices[4];
else if(tall)best=choices[2];
else if(profile.faces.length>1)best=choices[0];
else if(wide)best=choices[1];
else best=choices[0];
}
if(scene===2)best={...best,speaker:{x:105,y:280,w:325,h:340},tag:{x:160,y:590,w:220,h:65}};const box=best.speaker,factor=Math.max(.65,Math.min(1.45,Number(sceneMeta[scene]?.scale||65)/65));
return{photo:best.photo,person:{x:box.x,y:box.y,w:Math.min(box.w*factor,R.w),h:Math.min(box.h*factor,R.h)},tag:best.tag,profile:img?profileFor(img):null,id:best.id}}
function composition(video,scene,mode,img){return layoutFor(video,img||null,mode,scene)}
function roundedPanel(x,y,w,h,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,12);ctx.fill()}
function drawRecordTag(scene,layout,mode){const d=recordData(scene),r=layout.tag;
if(!d.number&&!d.name)return;
roundedPanel(r.x,r.y,r.w,r.h,'rgba(4,17,11,.92)');
ctx.save();ctx.beginPath();ctx.rect(r.x+8,r.y+5,r.w-16,r.h-10);ctx.clip();
if(d.number){let sz=Math.min(43,Math.floor((r.w-18)/Math.max(1,d.number.length*.64)));labelText(d.number,r.x+r.w/2,r.y+Math.min(48,r.h*.58),sz,mode==='legends'?'#efd19a':'#f5fff7','center')}
if(d.name){let sz=Math.min(19,Math.floor((r.w-16)/Math.max(1,d.name.length*.6)));labelText(d.name.toUpperCase(),r.x+r.w/2,r.y+r.h-13,sz,'#b9e6c5','center')}
ctx.restore()}
function alphaBounds(maskImage){if(!maskImage||!maskImage.width)return null;const w=maskImage.width,h=maskImage.height;
const scan=document.createElement('canvas');scan.width=96;scan.height=96;const c=scan.getContext('2d',{willReadFrequently:true});c.drawImage(maskImage,0,0,96,96);const d=c.getImageData(0,0,96,96).data;let minX=96,minY=96,maxX=0,maxY=0,n=0;
for(let y=0;y<96;y+=2)for(let x=0;x<96;x+=2){const i=(y*96+x)*4;if(d[i+3]>100&&Math.max(d[i],d[i+1],d[i+2])>80){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);n++}}
if(n<40)return null;return{x:Math.max(0,minX/96-.03),y:Math.max(0,minY/96-.03),w:Math.min(1,(maxX-minX)/96+.06),h:Math.min(1,(maxY-minY)/96+.06)}}
function drawPresenter(video,scene,mode,layout){
const p=layout.person;
if(!mask||!mask.width){const r=fitRect(video,p);ctx.save();ctx.fillStyle='rgba(8,26,15,.9)';ctx.fillRect(p.x-2,p.y-2,p.w+4,p.h+4);ctx.drawImage(video,r.x,r.y,r.w,r.h);ctx.restore();return}
const mw=mask.width,mh=mask.height;
if(personCanvas.width!==mw||personCanvas.height!==mh){personCanvas.width=mw;personCanvas.height=mh}
personCtx.clearRect(0,0,mw,mh);personCtx.globalCompositeOperation='source-over';
personCtx.drawImage(mask,0,0,mw,mh);personCtx.globalCompositeOperation='source-in';
personCtx.drawImage(video,0,0,mw,mh);personCtx.globalCompositeOperation='source-over';
const bounds=alphaBounds(mask)||{x:0,y:0,w:1,h:1};
const sx=bounds.x*mw,sy=bounds.y*mh,sw=bounds.w*mw,sh=bounds.h*mh;
const k=Math.min(p.w/sw,p.h/sh),dw=sw*k,dh=sh*k;
const position=sceneMeta[scene]?.position||'left';
let x=p.x+(p.w-dw)/2;if(position==='right')x=p.x+p.w-dw;else if(position==='left')x=p.x;
const y=p.y+p.h-dh;
ctx.save();ctx.shadowColor='rgba(0,0,0,.7)';ctx.shadowBlur=14;
ctx.drawImage(personCanvas,sx,sy,sw,sh,x,y,dw,dh);ctx.restore()}
// Rich football ranking broadcast backgrounds; decorations fill the entire canvas,
// while all meaningful words and statistics remain inside the safe rectangle.
function glow(x,y,r,color){const g=ctx.createRadialGradient(x,y,1,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2)}
function stadiumLines(t,gold=false){
ctx.save();ctx.fillStyle='rgba(0,0,0,.28)';ctx.fillRect(0,300,W,390);
for(let row=0;row<11;row++)for(let col=0;col<36;col++){
const a=(Math.sin(col*11.9+row*6.7)*.5+.5)*.28;
ctx.fillStyle=gold?'rgba(250,190,88,'+a+')':'rgba(161,241,197,'+a+')';
ctx.fillRect(col*16+(row%2)*7,312+row*31,3,3)}
ctx.strokeStyle=gold?'rgba(245,191,92,.25)':'rgba(146,234,169,.23)';ctx.lineWidth=3;
ctx.beginPath();ctx.moveTo(0,750);ctx.lineTo(W,750);ctx.moveTo(110,680);ctx.lineTo(0,950);ctx.moveTo(430,680);ctx.lineTo(W,950);ctx.moveTo(110,680);ctx.lineTo(430,680);ctx.stroke();
glow(65,145,230,gold?'rgba(250,198,95,.32)':'rgba(225,255,223,.35)');
glow(478,148,240,gold?'rgba(250,198,95,.3)':'rgba(225,255,223,.32)');ctx.restore()}
function trophy(x,y,s,color){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(-25,-40);ctx.lineTo(25,-40);ctx.lineTo(19,5);ctx.quadraticCurveTo(0,31,-19,5);ctx.closePath();ctx.fill();ctx.beginPath();ctx.arc(-26,-20,22,Math.PI/2,Math.PI*1.5,true);ctx.arc(26,-20,22,Math.PI*1.5,Math.PI/2,true);ctx.stroke();ctx.fillRect(-5,20,10,26);ctx.fillRect(-27,46,54,8);ctx.restore()}
function podium(x,y,scale,color){ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.fillStyle=color;const p=[[-96,0,62,60],[-31,-30,62,90],[34,16,62,44]];p.forEach((r,i)=>{ctx.globalAlpha=.32+(i===1?.25:0);ctx.fillRect(...r)});ctx.globalAlpha=.75;ctx.font='900 31px system-ui';ctx.textAlign='center';/* Decorative podium: never imply unsupported rankings. */ctx.restore()}
function rankingDecor(t,mode){ctx.save();const g=ctx.createLinearGradient(0,0,W,H);
if(mode==='historic'){g.addColorStop(0,'#02130d');g.addColorStop(.5,'#123e28');g.addColorStop(1,'#04140d')}
else if(mode==='numbers'){g.addColorStop(0,'#12090e');g.addColorStop(.5,'#2a0c16');g.addColorStop(1,'#090e16')}
else{g.addColorStop(0,'#140e09');g.addColorStop(.5,'#38240f');g.addColorStop(1,'#0d0a07')}
ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
if(mode==='historic'){stadiumLines(t);glow(270,825,210,'rgba(37,181,77,.25)');ball(475,775,86,t*.12);trophy(90,815,1.1,'rgba(240,197,92,.45)');podium(310,858,.72,'#7ad89a')}
else if(mode==='numbers'){stadiumLines(t);ctx.fillStyle='rgba(225,39,58,.22)';for(let i=0;i<8;i++){ctx.fillRect(12+i*70,740-(i%4)*17,24,205+(i%4)*17)}ctx.strokeStyle='rgba(255,77,88,.35)';ctx.lineWidth=4;for(let i=0;i<6;i++){ctx.beginPath();ctx.moveTo(0,690+i*45);ctx.lineTo(W,690+i*45);ctx.stroke()}ball(468,815,75,t*.08);podium(175,845,.75,'#ef4d5e');trophy(390,775,.9,'rgba(245,220,220,.5)')}
else{stadiumLines(t,true);glow(265,800,280,'rgba(247,171,50,.32)');trophy(438,770,1.65,'rgba(255,203,93,.65)');podium(175,835,1.05,'#f2c36b');ball(65,780,65,t*.07)}
ctx.globalAlpha=.2;ctx.strokeStyle=mode==='legends'?'#f7c86b':mode==='numbers'?'#ff485c':'#59e18b';ctx.lineWidth=3;ctx.strokeRect(16,15,W-32,H-30);
ctx.globalAlpha=1;ctx.fillStyle='rgba(0,0,0,.2)';ctx.fillRect(0,0,W,110);ctx.fillRect(0,680,W,280);
ctx.restore()}
function drawHeadline(scene,mode){const d=recordData(scene);const title=d.title||'';
ctx.save();const accent=mode==='legends'?'#f2d28d':mode==='numbers'?'#ff6676':'#8aefab';
labelText('11 RÉCORDS',SAFE.left+8,SAFE.top+21,20,accent);
ctx.fillStyle=accent;ctx.fillRect(SAFE.left+8,SAFE.top+30,112,3);
if(title){const words=title.toUpperCase().split(/\s+/),lines=[];let line='';
ctx.font='900 25px system-ui';
for(const word of words){const next=line?line+' '+word:word;if(ctx.measureText(next).width>365&&line){lines.push(line);line=word}else line=next}if(line)lines.push(line);
const selected=lines.slice(0,2);const fontSize=selected.some(v=>v.length>31)?19:24;
selected.forEach((v,i)=>labelText(v,SAFE.left+8,SAFE.top+49+i*22,fontSize,'#ffffff'))}
else labelText(mode==='historic'?'RÉCORD HISTÓRICO':mode==='numbers'?'RANKING EN CIFRAS':'LEYENDAS Y RÉCORDS',SAFE.left+8,SAFE.top+54,23,'#ffffff');
ctx.restore()}
// Development scene only: full-frame photographs, time-based slideshow, soft crossfades.
// The hook and the closing question retain their approved designs.
function drawDevelopment(video,t,mode){
const photos=scenePictures[1]||[],duration=Math.max(1,trims[1].end-trims[1].start||20);
rankingDecor(t,mode);
if(!photos.length){drawHeadline(1,mode);drawPresenter(video,1,mode,{person:{x:SAFE.left+7,y:400,w:175,h:235}});return}
const frame={x:28,y:142,w:475,h:610};
function paint(photo,opacity){
ctx.save();ctx.globalAlpha=opacity;
const bg=ctx.createLinearGradient(0,frame.y,0,frame.y+frame.h);
bg.addColorStop(0,'rgba(6,15,11,.95)');bg.addColorStop(1,'rgba(6,15,11,.85)');
ctx.fillStyle=bg;ctx.fillRect(frame.x,frame.y,frame.w,frame.h);
// Blurred extension fills leftover space without cropping the actual photograph.
ctx.save();ctx.beginPath();ctx.rect(frame.x,frame.y,frame.w,frame.h);ctx.clip();
ctx.filter='blur(26px) brightness(.42)';drawCover(photo,frame.x-35,frame.y-35,frame.w+70,frame.h+70);ctx.filter='none';
drawPhoto(photo,frame,1);ctx.restore();ctx.restore()}
const span=duration/photos.length,segment=Math.min(photos.length-1,Math.floor(Math.max(0,t)/span));
const local=t-segment*span,fade=Math.min(.85,span*.28);
paint(photos[segment],1);
if(segment<photos.length-1&&local>span-fade){const alpha=Math.max(0,Math.min(1,(local-(span-fade))/fade));ctx.save();ctx.translate(W/2,H/2);ctx.scale(1+(.06*(1-alpha)),1+(.06*(1-alpha)));ctx.translate(-W/2,-H/2);paint(photos[segment+1],alpha);ctx.restore();ctx.save();ctx.globalAlpha=Math.sin(alpha*Math.PI)*.17;ctx.fillStyle='#fff4ca';ctx.fillRect(frame.x,frame.y,frame.w,frame.h);ctx.restore()}
// Small presenter overlay, outside the most important central part of the photograph.
const right=sceneMeta[1].position==='right',box={x:right?SAFE.right-140:SAFE.left+3,y:525,w:137,h:120};
ctx.save();ctx.fillStyle='rgba(5,17,11,.7)';ctx.beginPath();ctx.roundRect(box.x-5,box.y-5,box.w+10,box.h+10,12);ctx.fill();ctx.restore();
drawPresenter(video,1,mode,{person:box});
const accent=mode==='legends'?'#f2d28d':mode==='numbers'?'#ff6676':'#8aefab';
ctx.fillStyle='rgba(4,15,10,.87)';ctx.fillRect(0,0,W,125);
labelText('11 RÉCORDS  •  DESARROLLO',SAFE.left+6,SAFE.top-37,19,accent);
const d=recordData(1);
if(d.title){ctx.save();ctx.font='900 21px system-ui';const words=d.title.toUpperCase().split(/\s+/);let line='',lines=[];for(const word of words){const next=line?line+' '+word:word;if(ctx.measureText(next).width>385&&line){lines.push(line);line=word}else line=next}if(line)lines.push(line);lines.slice(0,2).forEach((l,i)=>labelText(l,SAFE.left+6,SAFE.top-8+i*23,20,'#fff'));ctx.restore()}
ctx.fillStyle='rgba(3,12,8,.75)';ctx.fillRect(200,625,233,28);
labelText((segment+1)+' / '+photos.length,425,645,16,'#fff','right');
ctx.fillStyle='#141e16';ctx.fillRect(0,H-23,W,23);ctx.fillStyle='#18b852';ctx.fillRect(0,H-23,W*.82,7);ctx.fillStyle='#e32834';ctx.fillRect(W*.82,H-23,W*.18,7)}
function drawScene(video,scene,t,mode=sceneStyles[scene]||selectedStyle()){
ctx.clearRect(0,0,W,H);if(scene===1){drawDevelopment(video,t,mode);return}
const imgs=scenePictures[scene]||[],img=scene===2?null:imgs.length?imgs[0]:null;
rankingDecor(t,mode);
if(scene!==2)drawHeadline(scene,mode);else{labelText('11 RÉCORDS',SAFE.left+8,SAFE.top+21,20,mode==='legends'?'#e9c77b':'#a9eac1')}
const layout=composition(video,scene,mode,img);
if(img){const slot=layout.photo;roundedPanel(slot.x-5,slot.y-5,slot.w+10,slot.h+10,mode==='legends'?'#51402a':'#10271b');ctx.save();ctx.strokeStyle=mode==='legends'?'#c9aa70':mode==='numbers'?'#d94b55':'#4dbb75';ctx.lineWidth=3;ctx.strokeRect(slot.x-5,slot.y-5,slot.w+10,slot.h+10);ctx.save();if(scene===0){const z=1+Math.min(.045,Math.max(0,t)/(Math.max(1,trims[0].end-trims[0].start))*.045);ctx.beginPath();ctx.rect(slot.x,slot.y,slot.w,slot.h);ctx.clip();ctx.translate(slot.x+slot.w/2,slot.y+slot.h/2);ctx.scale(z,z);ctx.translate(-(slot.x+slot.w/2),-(slot.y+slot.h/2))}drawPhoto(img,slot,scene);ctx.restore();ctx.restore()}
if(scene!==2)drawRecordTag(scene,layout,mode);
if(scene===2){labelText('¿  ? ',270,260,68,mode==='legends'?'#e9c77b':'#a9eac1','center');labelText('SÍGUENOS',270,660,30,mode==='legends'?'#e9c77b':'#a9eac1','center')}
drawPresenter(video,scene,mode,layout);
ctx.fillStyle='#121d15';ctx.fillRect(0,H-23,W,23);ctx.fillStyle='#18b852';ctx.fillRect(0,H-23,W*.82,7);ctx.fillStyle='#e32834';ctx.fillRect(W*.82,H-23,W*.18,7)}
async function loadMedia(file){return new Promise((resolve,reject)=>{if(!file||!file.type.startsWith('video/'))return reject(Error('Selecciona un archivo de video válido.'));if(file.size>700*1024*1024)return reject(Error('El video supera 700 MB. Utiliza un archivo más pequeño.'));const url=URL.createObjectURL(file);urls.push(url);const v=document.createElement('video');v.src=url;v.preload='auto';v.playsInline=true;v.muted=true;v.onloadedmetadata=()=>{if(!Number.isFinite(v.duration)||v.duration<=0)reject(Error('No se pudo leer la duración del video.'));else resolve(v)};v.onerror=()=>reject(Error('No se pudo leer '+file.name));setTimeout(()=>reject(Error('No se pudo cargar el video.')),20000)})}
async function initSegmenter(){if(!window.SelfieSegmentation)throw Error('No se pudo descargar el modelo de recorte. Comprueba tu conexión.');segmenter=new SelfieSegmentation({locateFile:file=>'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/'+file});segmenter.setOptions({modelSelection:0,selfieMode:false});segmenter.onResults(r=>{mask=r.segmentationMask});}
function updateSafe(){const layer=$('safeOverlay');if(layer)layer.hidden=!$('showSafe').checked}function screen(name){for(const id of ['uploadScreen','styleScreen','reviewScreen','finalScreen'])$(id).hidden=id!==name;window.scrollTo(0,0)}
const labels=['Gancho','Desarrollo','Cierre'];
window.addEventListener('beforeunload',e=>{if(clips.some(Boolean)&&!approved.every(Boolean)){e.preventDefault();e.returnValue=''}});
function renderPhotoManager(){const el=$('photoManager');if(!el)return;el.innerHTML='';scenePictures[1].forEach((im,i)=>{const row=document.createElement('div');row.className='photoRow';const thumb=document.createElement('img');thumb.src=im.src;thumb.alt='Foto '+(i+1);const name=document.createElement('span');name.textContent='Foto '+(i+1);row.append(thumb,name);for(const [label,delta] of [['↑',-1],['↓',1]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=i+delta<0||i+delta>=scenePictures[1].length;b.onclick=()=>{const a=scenePictures[1];[a[i],a[i+delta]]=[a[i+delta],a[i]];renderPhotoManager()};row.append(b)}const del=document.createElement('button');del.type='button';del.textContent='×';del.onclick=()=>{scenePictures[1].splice(i,1);renderPhotoManager()};row.append(del);el.append(row)})}let loaded=[false,false,false];
let preparationToken=0,segmentBusy=false,segmentationUnavailable=false;
function bounded(promise,ms,label){return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error(label)),ms))])}
async function firstFrame(v){if(v.readyState>=2&&v.videoWidth)return;v.load();await bounded(new Promise((resolve,reject)=>{const done=()=>{v.removeEventListener('loadeddata',done);v.removeEventListener('canplay',done);v.removeEventListener('error',fail);resolve()};const fail=()=>{v.removeEventListener('loadeddata',done);v.removeEventListener('canplay',done);v.removeEventListener('error',fail);reject(Error('No se puede decodificar el video'))};v.addEventListener('loadeddata',done);v.addEventListener('canplay',done);v.addEventListener('error',fail);if(v.readyState>=2&&v.videoWidth)done()}),9000,'El video no entregó su primer fotograma')}
async function trySegmentation(v,timeout=7000){if(segmentationUnavailable||!segmenter)return false;try{await bounded(segmenter.send({image:v}),timeout,'El recorte tardó demasiado');return !!mask}catch(e){segmentationUnavailable=true;console.warn('Recorte deshabilitado para esta sesión:',e);return false}}
async function prepareScene(){const token=++preparationToken;cleanup();ready=false;mask=null;$('play').disabled=true;$('approve').disabled=true;sceneStyles[step]=activeStyle;const scene=step,v=clips[scene];status('Cargando vista previa...',10);try{await firstFrame(v);if(token!==preparationToken)return;v.currentTime=trims[scene].start;drawScene(v,scene,0,sceneStyles[scene]);ready=true;$('play').disabled=false;$('approve').disabled=false;status('Vista previa lista. Preparando eliminación de fondo...',55);if(!segmenter&&!segmentationUnavailable){try{await bounded(initSegmenter(),7000,'Modelo no disponible')}catch(e){segmentationUnavailable=true;console.warn(e)}}if(token!==preparationToken)return;const ok=await trySegmentation(v,6500);if(token!==preparationToken)return;drawScene(v,scene,0,sceneStyles[scene]);status(ok?'Recorte listo. Puedes revisar.':'Video disponible sin recorte. Puedes revisar o intentar de nuevo.',100)}catch(e){if(token!==preparationToken)return;status('No se pudo mostrar el video: '+e.message,0);$('play').disabled=true;$('approve').disabled=true}}
async function receiveFile(i){const file=$(['hook','body','cta'][i]).files[0];if(!file)return;ready=false;try{clips[i]=await loadMedia(file);trims[i]={start:0,end:Math.min(180,clips[i].duration)};approved[i]=false;loaded[i]=true;step=i;showStage('style')}catch(e){alert(e.message)}}
function showStage(stage){preparationToken++;if($('trimVideo')){$('trimVideo').pause();$('trimVideo').hidden=true}cleanup();$('steps').querySelectorAll('.stepDot').forEach((el,i)=>{el.classList.toggle('active',i<=step);el.title=i<3?(approved[i]?'Aprobado: ':'Pendiente: ')+labels[i]:'Video final'});ready=false;mask=null;if(stage==='upload'){screen('uploadScreen');$('stepTitle').textContent=(step+1)+'. '+labels[step];for(let i=0;i<3;i++)$(['hookBox','bodyBox','ctaBox'][i]).hidden=i!==step;$('backUpload').hidden=step===0}else if(stage==='style'){$('styleStepLabel').textContent=labels[step];const chosen=activeStyle;restoreSceneMeta();$('trimStart').value=String(trims[step].start);$('trimEnd').value=String(trims[step].end);$('trimStart').max=String(clips[step]?.duration||180);$('trimEnd').max=String(clips[step]?.duration||180);$('cropPhoto').checked=photoCrop[step];$('photoManager').hidden=step!==1;renderPhotoManager();document.querySelectorAll('input[name="style"]').forEach(el=>el.checked=el.value===chosen);$('imagesBox').hidden=step===2;$('images').value='';$('developmentHint').hidden=step!==1;screen('styleScreen')}else if(stage==='review'){$('reviewStepLabel').textContent=labels[step];$('backFull').hidden=true;$('approve').hidden=false;screen('reviewScreen');updateSafe();prepareScene()}else{screen('finalScreen');ready=true}}
for(let i=0;i<3;i++)$(['hook','body','cta'][i]).addEventListener('change',()=>receiveFile(i));
$('backUpload').onclick=()=>{if(step>0){step--;showStage('review')}};
$('backStyle').onclick=()=>showStage('upload');
$('trimStart').oninput=$('trimEnd').oninput=()=>{const start=Number($('trimStart').value),end=Number($('trimEnd').value);$('trimDuration').textContent=Number.isFinite(start)&&Number.isFinite(end)&&end>start?'Fragmento: '+(end-start).toFixed(1)+' segundos':'Revisa los tiempos de inicio y final'};
$('trimPreview').onclick=async()=>{try{const v=clips[step],start=Number($('trimStart').value),end=Number($('trimEnd').value);if(!(end>start&&start>=0&&end<=v.duration))throw Error('Selecciona un fragmento válido');const preview=$('trimVideo');if(trimPreviewTimer){clearInterval(trimPreviewTimer);trimPreviewTimer=null}preview.pause();if(preview.src!==v.src)preview.src=v.src;preview.hidden=false;await seekVideo(preview,start);preview.muted=false;await preview.play();trimPreviewTimer=setInterval(()=>{if(preview.paused||preview.ended||preview.currentTime>=end-.06){preview.pause();clearInterval(trimPreviewTimer);trimPreviewTimer=null}},60);}catch(e){status('Error al previsualizar recorte: '+e.message)}};
$('nextStyle').onclick=async()=>{try{saveSceneMeta();const start=Number($('trimStart').value),end=Number($('trimEnd').value);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>clips[step].duration+.1||end-start<1||end-start>180)throw Error('El recorte debe durar entre 1 y 180 segundos.');trims[step]={start,end};photoCrop[step]=$('cropPhoto').checked;const files=[...$('images').files];if(files.some(f=>!f.type.startsWith('image/')||f.size>25*1024*1024))throw Error('Las fotos deben ser imágenes válidas de máximo 25 MB.');if(step===1&&files.length+scenePictures[step].length>10)throw Error('Para el desarrollo puedes subir hasta 10 fotografías.');if(step===0&&files.length>1)throw Error('En el gancho se utiliza una sola fotografía.');if(step===1&&files.length+scenePictures[step].length===0)throw Error('El desarrollo necesita al menos una fotografía.');if(step===0&&files.length===0&&scenePictures[0].length===0)throw Error('El gancho necesita una fotografía.');if(files.length){scenePictures[step]=(step===1?scenePictures[step]:[]).concat(await Promise.all(files.map(file=>new Promise((resolve,reject)=>{const img=new Image(),u=URL.createObjectURL(file);urls.push(u);img.onload=()=>resolve(img);img.onerror=()=>reject(Error('No se pudo abrir '+file.name));img.src=u}))));await Promise.all(scenePictures[step].map(analyzePhoto));}if(step===0){activeStyle=document.querySelector('input[name="style"]:checked')?.value||activeStyle;sceneStyles.fill(activeStyle)}approved[step]=false;showStage('review')}catch(e){alert('No se pudieron procesar las imágenes: '+e.message);$('nextStyle').disabled=false}};
$('backReview').onclick=()=>showStage('style');
$('prepare').onclick=prepareScene;$('showSafe').onchange=updateSafe;$('scale').oninput=()=>{saveSceneMeta();if(ready&&!playing&&step<3)drawScene(clips[step],step,0,sceneStyles[step])};$('layoutMode').onchange=()=>{saveSceneMeta();if(ready&&!playing&&step<3)drawScene(clips[step],step,0,sceneStyles[step])};$('position').onchange=()=>{saveSceneMeta();if(ready&&!playing&&step<3)drawScene(clips[step],step,0,sceneStyles[step])};
$('approve').onclick=()=>{if(!ready)return;approved[step]=true;if(step===2){step=3;showStage('final')}else{step++;showStage('upload')}};
$('back').onclick=()=>{step=2;showStage('review')};
$('backFull').onclick=()=>{step=3;showStage('final')};
$('finalPlay').onclick=()=>{step=3;ready=true;screen('reviewScreen');$('reviewStepLabel').textContent='Video completo';$('backFull').hidden=false;$('approve').hidden=true;$('approve').disabled=true;run(false)};
function seekVideo(video,time){return new Promise((resolve,reject)=>{if(!Number.isFinite(time))return reject(Error('Tiempo inválido'));const finish=()=>{video.removeEventListener('seeked',finish);video.removeEventListener('error',fail);clearTimeout(timer);resolve()};const fail=()=>{video.removeEventListener('seeked',finish);video.removeEventListener('error',fail);clearTimeout(timer);reject(Error('No se pudo ubicar el fotograma'))};const timer=setTimeout(fail,9000);video.addEventListener('seeked',finish,{once:true});video.addEventListener('error',fail,{once:true});try{if(Math.abs(video.currentTime-time)<.025&&video.readyState>=2){finish();return}video.currentTime=time}catch(e){fail()}})}
function waitEnd(video,endTime=video.duration){return new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;video.removeEventListener('ended',finish);resolve()};video.addEventListener('ended',finish);if(!playing)finish();const check=()=>{if(!playing)finish();else if(video.ended||video.currentTime>=endTime-.06)finish();else setTimeout(check,80)};check()})}
async function run(exporting){
if(!ready||playing)return;
playing=true;$('play').disabled=true;$('export').disabled=true;$('stop').disabled=false;mask=null;
let chunks=[],stream=null,mixed=null,sessionVideos=[],captureCanvas=null,captureTimer=null,localRecorder=null;
const scenes=exporting||step===3?[0,1,2]:[step];
const total=scenes.reduce((s,i)=>s+Math.max(.1,trims[i].end-trims[i].start),0);
let elapsed=0,exportType='',ext='webm';
try{
if(exporting){
 if(!approved.every(Boolean))throw Error('Aprueba las tres escenas antes de exportar.');
 if(!window.MediaRecorder||!canvas.captureStream)throw Error('Este navegador no permite grabar el resultado.');
 const types=['video/mp4;codecs="avc1.42E01E,mp4a.40.2"','video/mp4','video/webm;codecs=vp8,opus','video/webm'];
 exportType=types.find(t=>MediaRecorder.isTypeSupported(t));
 if(!exportType)throw Error('No hay codificador de video compatible en este navegador.');
 ext=exportType.startsWith('video/mp4')?'mp4':'webm';
 captureCanvas=document.createElement('canvas');captureCanvas.width=1080;captureCanvas.height=1920;
 const c=captureCanvas.getContext('2d',{alpha:false});
 c.drawImage(canvas,0,0,1080,1920);
 stream=captureCanvas.captureStream(30);
 captureTimer=setInterval(()=>{try{c.drawImage(canvas,0,0,1080,1920)}catch(e){}},1000/30);
 audioCtx=new (window.AudioContext||window.webkitAudioContext)();
 await audioCtx.resume();
 const dest=audioCtx.createMediaStreamDestination();
 // Fresh media elements per export avoid the one-source-per-element WebAudio limitation.
 sessionVideos=await Promise.all(clips.map(async original=>{
  const v=document.createElement('video');v.src=original.src;v.preload='auto';v.playsInline=true;v.muted=false;v.volume=1;
  await bounded(new Promise((resolve,reject)=>{v.onloadedmetadata=resolve;v.onerror=()=>reject(Error('No se pudo preparar el audio del video'))}),15000,'No se pudo preparar la exportación');
  const source=audioCtx.createMediaElementSource(v);
  const gain=audioCtx.createGain();gain.gain.value=0;
  source.connect(gain);gain.connect(dest);v._recordGain=gain;
  return v;
 }));
 mixed=new MediaStream([...stream.getVideoTracks(),...dest.stream.getAudioTracks()]);
 localRecorder=new MediaRecorder(mixed,{mimeType:exportType,videoBitsPerSecond:6500000});
 recorder=localRecorder;
 localRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
 localRecorder.onerror=e=>{console.error('Error MediaRecorder',e)};
 localRecorder.start(1000);
}
for(const scene of scenes){
 if(!playing)break;
 const v=exporting?sessionVideos[scene]:clips[scene];
 mask=null;v.pause();await seekVideo(v,trims[scene].start);activeVideo=v;
 v.muted=false;
 if(exporting&&v._recordGain)v._recordGain.gain.value=1;
 await bounded(v.play(),12000,'El navegador bloqueó la reproducción del video');
 let processing=false;const epoch=++renderEpoch;
 const render=async()=>{
  if(!playing||epoch!==renderEpoch||v.paused||v.ended)return;
  const t=Math.max(0,v.currentTime-trims[scene].start);
  drawScene(v,scene,t,sceneStyles[scene]);
  if(!processing&&segmenter&&!segmentationUnavailable){processing=true;try{await trySegmentation(v,2500)}finally{processing=false}}
  if(!playing||epoch!==renderEpoch)return;
  status((exporting?'Exportando':'Reproduciendo')+' · '+labels[scene],Math.min(99,Math.round((elapsed+t)/total*100)));
  raf=requestAnimationFrame(render);
 };
 raf=requestAnimationFrame(render);
 await waitEnd(v,trims[scene].end);
 v.pause();renderEpoch++;if(v._recordGain)v._recordGain.gain.value=0;cancelAnimationFrame(raf);
 elapsed+=trims[scene].end-trims[scene].start;
}
if(exporting&&localRecorder&&localRecorder.state!=='inactive'){
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('La exportación tardó demasiado en finalizar')),20000);localRecorder.onstop=()=>{clearTimeout(timer);resolve()};localRecorder.stop()});
 if(!chunks.length)throw Error('El codificador no generó datos.');
 const blob=new Blob(chunks,{type:exportType}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='11-records-studio.'+ext;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 status('Video descargado en '+ext.toUpperCase()+'.',100);
}else status(playing?'Vista previa finalizada.':'Proceso detenido.',playing?100:0);
}catch(e){status('Error: '+e.message,0);console.error(e)}
finally{
 if(captureTimer)clearInterval(captureTimer);
 if(localRecorder&&localRecorder.state!=='inactive'){try{localRecorder.stop()}catch(e){}}
 if(mixed)mixed.getTracks().forEach(t=>t.stop());
 if(stream)stream.getTracks().forEach(t=>t.stop());
 sessionVideos.forEach(v=>{v.pause();v.removeAttribute('src');v.load()});
 cleanup();
 $('play').disabled=!ready;$('export').disabled=false;$('stop').disabled=true;recorder=null;
}
}
$('play').onclick=()=>run(false);$('export').onclick=()=>{step=3;ready=true;run(true)};$('stop').onclick=()=>{playing=false;if(activeVideo)activeVideo.pause();status('Deteniendo...',0)};showStage('upload');
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));
