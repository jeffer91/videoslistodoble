'use strict';
/**
 * Videos largos directos · música y efectos originales.
 * Las pistas se sintetizan en el propio equipo con FFmpeg a partir de
 * fórmulas (acordes, percusión y ruido filtrado). Al ser creación propia de
 * la aplicación no dependen de licencias de terceros y pueden publicarse en
 * YouTube. El usuario también puede importar pistas con derechos de uso.
 */
const fs = require('node:fs');
const path = require('node:path');

const VERSION = 4;
const RATE = 44100;
const note = semitones => 440 * Math.pow(2, semitones / 12);
// Semitonos respecto a La 4 (A4 = 0).
const N = { C3: -21, D3: -19, E3: -17, F3: -16, G3: -14, A3: -12, Bb3: -11, B3: -10, C4: -9, D4: -7, E4: -5, F4: -4, G4: -2, A4: 0, Bb2: -23, A2: -24, G2: -26, F2: -28, D2: -31, C2: -33, E2: -29 };

const MUSIC = {
  epica: { label: 'Épica', seconds: 32 },
  emotiva: { label: 'Emotiva', seconds: 36 },
  tension: { label: 'Tensión', seconds: 32 },
  ambiental: { label: 'Ambiental deportiva', seconds: 32 }
};
const SOUNDS = {
  impacto: { label: 'Impacto', seconds: 2.6 },
  whoosh: { label: 'Transición (whoosh)', seconds: 1.4 },
  estadio: { label: 'Sonido de estadio', seconds: 4.5 },
  multitud: { label: 'Multitud que celebra', seconds: 4.5 },
  cinematico: { label: 'Efecto cinematográfico', seconds: 3.6 },
  musica: { label: 'Música deportiva breve', seconds: 3.2 },
  clic: { label: 'Clic de suscripción', seconds: 0.6 }
};

const f = x => x.toFixed(3);
const sin = (freq, phase = 't') => 'sin(' + f(2 * Math.PI * freq) + '*' + phase + ')';
/** Suma de armónicos: timbre de metal o piano según los pesos. */
const tone = (freq, weights) => weights.map((w, i) => f(w) + '*' + sin(freq * (i + 1))).join('+');
/** Selecciona un valor según el índice guardado en la variable 0. */
const choose = values => values.slice(0, -1).reduceRight((rest, value, i) => 'if(eq(ld(0),' + i + '),' + value + ',' + rest + ')', values.at(-1));

function chordPad(chords, length, weights = [1, 0.35, 0.12]) {
  // Un acorde por tramo con ataque y relajación suaves.
  const voices = [0, 1, 2, 3].map(v => choose(chords.map(c => '(' + tone(note(c[v]), weights) + ')')));
  const env = 'min(1,mod(t,' + length + ')/0.9)*min(1,(' + length + '-mod(t,' + length + '))/0.5)';
  return 'st(0,floor(mod(t,' + chords.length * length + ')/' + length + '));(' + voices.join('+') + ')*' + env + '*0.09';
}

function kick(beat, gain = 0.8) {
  return gain + '*sin(2*PI*(45+110*exp(-28*mod(t,' + beat + ')))*mod(t,' + beat + '))*exp(-7*mod(t,' + beat + '))';
}

function musicExpression(mood) {
  if (mood === 'epica') {
    const chords = [[N.D3, N.A3, N.D4, N.F4], [N.Bb2, N.F3, N.Bb3, N.D4], [N.F3, N.C4, N.F4, N.A4], [N.C3, N.G3, N.C4, N.E4]];
    const brass = 'st(1,floor(mod(t,16)/4));' + choose.call(null, [0, 1, 2, 3].map(i => '(' + tone(note([N.D2, N.Bb2 - 12, N.F2, N.C2][i]), [0.6, 0.45, 0.3, 0.2, 0.12]) + ')')).replace(/ld\(0\)/g, 'ld(1)') + '*0.06';
    const toms = 'if(gt(mod(t,16),12),0.35*sin(2*PI*(90+60*exp(-25*mod(t,0.3333)))*mod(t,0.3333))*exp(-9*mod(t,0.3333)),0)';
    return '(' + chordPad(chords, 4, [1, 0.5, 0.25, 0.1]) + ')+(' + brass + ')+' + kick(0.6667, 0.55) + '+' + toms;
  }
  if (mood === 'emotiva') {
    const chords = [[N.C3, N.G3, N.C4, N.E4], [N.G2, N.D3, N.G3, N.B3], [N.A2, N.E3, N.A3, N.C4], [N.F2, N.C3, N.F3, N.A3]];
    const arp = [];
    for (const c of chords) arp.push(c.map(n => note(n + 12)));
    // Arpegio de piano en corcheas (0,375 s) sobre cada acorde de 3 s.
    const idx = 'st(2,floor(mod(t,12)/3));st(3,floor(mod(t,3)/0.375));';
    const pick = arp.map(freqs => 'if(eq(mod(ld(3),4),0),' + f(freqs[0]) + ',if(eq(mod(ld(3),4),1),' + f(freqs[1]) + ',if(eq(mod(ld(3),4),2),' + f(freqs[2]) + ',' + f(freqs[3]) + ')))');
    const freq = pick.slice(0, -1).reduceRight((rest, value, i) => 'if(eq(ld(2),' + i + '),' + value + ',' + rest + ')', pick.at(-1));
    const piano = idx + 'st(4,' + freq + ');(sin(2*PI*ld(4)*t)+0.4*sin(4*PI*ld(4)*t)+0.15*sin(6*PI*ld(4)*t))*exp(-3.2*mod(t,0.375))*0.16';
    return '(' + chordPad(chords, 3, [1, 0.2]) + ')*0.8+(' + piano + ')';
  }
  if (mood === 'tension') {
    const drone = '(' + tone(note(N.D2), [1, 0.5, 0.3]) + ')*0.09+' + sin(note(N.D3) + 1.5) + '*0.03*(0.5+0.5*sin(2*PI*0.125*t))';
    const ostinato = '(' + tone(note(N.D3), [1, 0.6, 0.3]) + ')*exp(-14*mod(t,0.25))*0.12*if(eq(mod(floor(t/0.25),4),3),0.4,1)';
    const heart = kick(1, 0.6) + '+0.45*sin(2*PI*(45+90*exp(-28*mod(t-0.28,1)))*mod(t-0.28,1))*exp(-8*mod(t-0.28,1))*gt(mod(t,1),0.28)';
    const dissonance = sin(note(N.Bb3)) + '*0.035*pow(mod(t,8)/8,2)';
    return drone + '+' + ostinato + '+' + heart + '+' + dissonance;
  }
  // Ambiental deportiva: pads abiertos, pulso suave y charles.
  const chords = [[N.C3, N.E3, N.G3, N.B3], [N.A2, N.C3, N.E3, N.G3], [N.F2, N.A2, N.C3, N.E3], [N.G2, N.B2, N.D3, N.E3]].map(c => c.map(n => n + 12));
  const hat = '(random(1)*2-1)*exp(-45*mod(t,0.375))*0.05';
  return '(' + chordPad(chords, 4, [1, 0.3, 0.1]) + ')+' + kick(0.75, 0.2) + '+' + hat;
}

function soundGraph(name, seconds) {
  const d = f(seconds);
  if (name === 'impacto') return { expr: '0.9*sin(2*PI*(38+130*exp(-10*t))*t)*exp(-2.6*t)+(random(1)*2-1)*exp(-22*t)*0.5', filter: 'lowpass=f=5000,aecho=0.8:0.6:70|140:0.3|0.18' };
  if (name === 'whoosh') return { expr: '(random(1)*2-1)*pow(sin(PI*t/' + d + '),3)*0.9', filter: 'highpass=f=500,lowpass=f=5200,aecho=0.7:0.5:40:0.2' };
  if (name === 'estadio') return { expr: '(random(1)*2-1)*(0.55+0.25*sin(2*PI*0.37*t)+0.2*sin(2*PI*1.3*t))*min(1,t/0.8)*min(1,(' + d + '-t)/1.2)', filter: 'lowpass=f=1600,highpass=f=120,equalizer=f=700:t=q:w=1:g=5,aecho=0.8:0.7:90|160:0.3|0.25' };
  if (name === 'multitud') return { expr: '((random(1)*2-1)*0.6+if(lt(random(2),0.025),(random(3)*2-1)*2,0))*min(1,t/0.4)*min(1,(' + d + '-t)/1.4)*(0.7+0.3*sin(2*PI*0.5*t))', filter: 'bandpass=f=1500:width_type=o:w=2.4,aecho=0.8:0.7:60|130:0.35|0.25' };
  if (name === 'cinematico') return { expr: 'if(lt(t,2.2),sin(2*PI*(110+380*pow(t/2.2,2))*t)*pow(t/2.2,2)*0.35+(random(1)*2-1)*pow(t/2.2,3)*0.25,0.95*sin(2*PI*(36+120*exp(-9*(t-2.2)))*(t-2.2))*exp(-2.4*(t-2.2)))', filter: 'lowpass=f=7000,aecho=0.8:0.6:80|170:0.35|0.2' };
  if (name === 'clic') return { expr: '(sin(2*PI*1800*t)*0.6+sin(2*PI*2600*t)*0.3)*exp(-38*t)+(random(1)*2-1)*exp(-120*t)*0.4', filter: 'highpass=f=300,aecho=0.6:0.4:30:0.2' };
  // Música deportiva breve: golpe de metales con timbal.
  const stab = [N.D3, N.A3, N.D4, N.F4].map(n => '(' + tone(note(n), [1, 0.6, 0.4, 0.25, 0.15]) + ')').join('+');
  return { expr: '(' + stab + ')*exp(-2.2*t)*0.09*min(1,t/0.02)+0.8*sin(2*PI*(42+110*exp(-12*t))*t)*exp(-3*t)', filter: 'lowpass=f=8000,aecho=0.8:0.6:60|120:0.3|0.2' };
}

function libraryDir(root) {
  const dir = path.join(root, 'Recursos', 'Directos', 'Audio');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileFor(root, kind, name) {
  const table = kind === 'music' ? MUSIC : SOUNDS;
  if (!Object.hasOwn(table, name)) throw Error('Pista desconocida');
  return path.join(libraryDir(root), kind + '-' + name + '-v' + VERSION + '.m4a');
}

const pending = new Map();
/** Devuelve la ruta de una pista generada; la crea la primera vez. */
function ensure(root, kind, name, media = require('./media.cjs')) {
  const table = kind === 'music' ? MUSIC : SOUNDS;
  const file = fileFor(root, kind, name);
  if (fs.existsSync(file)) return Promise.resolve(file);
  if (pending.has(file)) return pending.get(file);
  const seconds = table[name].seconds;
  const graph = kind === 'music' ? { expr: musicExpression(name), filter: 'highpass=f=55,aecho=0.8:0.75:70|140|260:0.25|0.18|0.1,lowpass=f=9500' } : soundGraph(name, seconds);
  const partial = file.replace(/\.m4a$/, '.parcial.m4a');
  const task = media.command(media.toolPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    "aevalsrc=exprs='" + graph.expr + "':s=" + RATE + ':d=' + seconds,
    '-af', graph.filter + ',loudnorm=I=' + (kind === 'music' ? -20 : -16) + ':TP=-2:LRA=11,highpass=f=25,aresample=48000,' + (kind === 'music' ? 'afade=t=in:d=0.02,afade=t=out:st=' + (seconds - 0.05) + ':d=0.05' : 'afade=t=out:st=' + Math.max(0, seconds - 0.25) + ':d=0.25'),
    '-ac', '2', '-c:a', 'aac', '-b:a', '192k', partial]).then(() => { fs.renameSync(partial, file); return file; })
    .finally(() => pending.delete(file));
  pending.set(file, task);
  return task;
}

function catalog() {
  return {
    music: Object.entries(MUSIC).map(([id, v]) => ({ id, label: v.label, seconds: v.seconds, license: 'Original de la aplicación · uso libre en YouTube' })),
    sounds: Object.entries(SOUNDS).map(([id, v]) => ({ id, label: v.label, seconds: v.seconds, license: 'Original de la aplicación · uso libre en YouTube' }))
  };
}

module.exports = { ensure, fileFor, catalog, musicExpression, soundGraph, MUSIC, SOUNDS, libraryDir };
