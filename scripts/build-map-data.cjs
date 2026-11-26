'use strict';
/*
 * Genera shorts/vendor/paises.json (contornos de países con nombres en español) para la marca [MAPA: …].
 * Datos: Natural Earth 1:110m (dominio público) vía world-atlas; nombres: i18n-iso-countries (MIT).
 * Uso (una vez, en una carpeta temporal):
 *   npm i world-atlas@2 topojson-client@3 i18n-iso-countries@7
 *   MAP_MODULES=<carpeta>/node_modules node scripts/build-map-data.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const modules = path.resolve(process.env.MAP_MODULES || 'node_modules');
const need = name => require(path.join(modules, name));
const topo = need('topojson-client');
const countries = need('i18n-iso-countries');
const world = JSON.parse(fs.readFileSync(path.join(modules, 'world-atlas', 'countries-110m.json'), 'utf8'));

// Nombres alternativos habituales en el fútbol.
const EXTRA = {
  '840': ['eeuu', 'ee uu', 'usa', 'estados unidos de america'], '826': ['reino unido', 'gran bretana'],
  '724': ['espana'], '076': ['brasil'], '484': ['mexico'], '410': ['corea', 'corea del sur'], '408': ['corea del norte'],
  '643': ['rusia'], '528': ['holanda', 'paises bajos'], '380': ['italia'], '250': ['francia'], '276': ['alemania'],
  '032': ['argentina'], '218': ['ecuador'], '170': ['colombia'], '604': ['peru'], '152': ['chile'], '858': ['uruguay'],
  '600': ['paraguay'], '068': ['bolivia'], '862': ['venezuela'], '392': ['japon'], '156': ['china'], '634': ['catar', 'qatar'],
  '682': ['arabia saudi', 'arabia saudita'], '784': ['emiratos', 'emiratos arabes'], '504': ['marruecos'], '818': ['egipto'],
  '566': ['nigeria'], '686': ['senegal'], '288': ['ghana'], '384': ['costa de marfil'], '120': ['camerun'], '710': ['sudafrica'],
  '036': ['australia'], '124': ['canada'], '188': ['costa rica'], '591': ['panama'], '340': ['honduras'], '620': ['portugal'],
  '056': ['belgica'], '191': ['croacia'], '688': ['serbia'], '756': ['suiza'], '208': ['dinamarca'], '752': ['suecia'],
  '578': ['noruega'], '616': ['polonia'], '804': ['ucrania'], '792': ['turquia'], '300': ['grecia'], '372': ['irlanda'],
  '364': ['iran'], '368': ['irak'], '400': ['jordania'], '860': ['uzbekistan'], '360': ['indonesia'], '608': ['filipinas']
};
const fold = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const r1 = n => Math.round(n * 10) / 10;

const features = topo.feature(world, world.objects.countries).features;
const out = [];
for (const f of features) {
  if (!f.geometry) continue;
  const id = String(f.id).padStart(3, '0');
  const alpha2 = countries.numericToAlpha2(id);
  const es = (alpha2 && countries.getName(alpha2, 'es')) || f.properties.name;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = [];
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const poly of polys) for (const ring of poly) {
    const flat = [];
    let px = null, py = null;
    for (const [x, y] of ring) {
      const rx = r1(x), ry = r1(y);
      if (rx === px && ry === py) continue;
      flat.push(rx, ry); px = rx; py = ry;
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx); minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
    }
    if (flat.length >= 6) rings.push(flat);
  }
  const names = new Set([fold(es), fold(f.properties.name), ...(EXTRA[id] || [])]);
  if (alpha2) for (const n of [countries.getName(alpha2, 'es', { select: 'all' }) || []].flat()) names.add(fold(n));
  out.push({ n: es, a: [...names].filter(Boolean), b: [minX, minY, maxX, maxY], r: rings });
}
out.sort((a, b) => a.n.localeCompare(b.n, 'es'));
const target = path.join(__dirname, '..', 'shorts', 'vendor', 'paises.json');
fs.writeFileSync(target, JSON.stringify({ fuente: 'Natural Earth 1:110m (dominio público) · nombres i18n-iso-countries', paises: out }));
console.log(out.length + ' países → ' + target + ' (' + Math.round(fs.statSync(target).size / 1024) + ' KB)');
