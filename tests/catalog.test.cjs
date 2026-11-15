'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const s=require('../backend/store.cjs'),c=require('../backend/catalog.cjs');
const tmp=name=>fs.mkdtempSync(path.join(os.tmpdir(),'11records-'+name+'-'));
function exported(root,title,tags){
 const p=s.createProject(root,{title,tags});
 p.status='exported';p.exports.push({mode:'short',file:title+'.mp4'});
 s.atomic(s.projectFile(root,p.id),p);return p;
}
test('etiquetas: admite texto con comas, quita duplicados sin importar tildes ni mayúsculas',()=>{
 const tags=c.normalizeTags({jugadores:'Lamine Yamal,  lamine yamal ,Messi,',estadios:['Bernabéu','bernabeu']});
 assert.deepEqual(tags.jugadores,['Lamine Yamal','Messi']);
 assert.deepEqual(tags.estadios,['Bernabéu']);
 assert.deepEqual(tags.clubes,[]);
 assert.throws(()=>c.normalizeTags({jugadores:[1]}),/inválidas/);
 assert.throws(()=>c.normalizeTags({jugadores:Array.from({length:13},(_,i)=>'J'+i)}),/Demasiadas/);
 assert.throws(()=>c.normalizeTags('x'),/inválidas/);
});
test('guion pegado: separa gancho, desarrollo y cierre; sin encabezados va al desarrollo',()=>{
 const parts=c.parseScript('GANCHO: Nadie lo vio venir\n\n## Desarrollo\nUno\nDos\n\n**Cierre** - Síguenos');
 assert.deepEqual(parts,{hook:'Nadie lo vio venir',body:'Uno\nDos',closing:'Síguenos'});
 assert.deepEqual(c.parseScript('Texto suelto'),{hook:'',body:'Texto suelto',closing:''});
 assert.throws(()=>c.normalizeScript({hook:'x'.repeat(8001)}),/supera/);
});
test('ficha del récord: etiquetas, guion, notas y etapa se guardan y se validan',()=>{
 const root=tmp('ficha');
 try{
  s.ensureRoot(root);
  const p=s.createProject(root,{title:'Yamal, el más joven',tags:{jugadores:'Lamine Yamal',clubes:'Barcelona'}});
  assert.equal(p.stage,'idea');
  const saved=s.saveProject(root,{id:p.id,script:{hook:'¿Sabías que…?',body:'Dato',closing:'Síguenos'},notes:'Fuente: acta oficial',
   tags:{jugadores:['Lamine Yamal'],competiciones:'Eurocopa'}});
  assert.equal(saved.script.hook,'¿Sabías que…?');
  assert.deepEqual(saved.tags.competiciones,['Eurocopa']);
  assert.deepEqual(saved.tags.clubes,[],'las etiquetas enviadas sustituyen a las anteriores');
  const listed=s.listProjects(root).find(x=>x.id===p.id);
  assert.equal(listed.stage,'guion','con guion escrito la etapa avanza sola');
  assert.equal(listed.hasScript,true);
  assert.equal(s.saveProject(root,{id:p.id,stage:'aprobado'}).stage,'aprobado');
  assert.equal(s.listProjects(root)[0].stage,'aprobado');
  assert.throws(()=>s.saveProject(root,{id:p.id,stage:'inventada'}),/Etapa/);
  assert.throws(()=>s.saveProject(root,{id:p.id,title:'   '}),/título/);
  assert.throws(()=>s.saveProject(root,{id:p.id,tags:{jugadores:{}}}),/inválidas/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('proyectos antiguos sin etiquetas ni etapa siguen abriendo y guardando',()=>{
 const root=tmp('antiguo');
 try{
  s.ensureRoot(root);
  const p=s.createProject(root,{title:'Récord antiguo'});
  const raw=s.getProject(root,p.id);delete raw.tags;delete raw.script;delete raw.stage;delete raw.notes;
  s.atomic(s.projectFile(root,p.id),raw);
  const listed=s.listProjects(root)[0];
  assert.equal(listed.stage,'idea');assert.deepEqual(listed.tags.jugadores,[]);
  const saved=s.saveProject(root,{id:p.id,title:'Récord antiguo editado'});
  assert.deepEqual(saved.script,{hook:'',body:'',closing:''});
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('búsqueda y filtros de la biblioteca',()=>{
 const a={title:'El gol más rápido',tags:{jugadores:['Lionel Messi'],estadios:['Camp Nou']},scenes:{},exports:[]};
 const b={title:'Debut histórico',tags:{jugadores:['Lamine Yamal']},scenes:{hook:{video:'v'}},exports:[]};
 assert.ok(c.matches(a,{text:'messi rapido'}));
 assert.ok(!c.matches(b,{text:'messi'}));
 assert.ok(c.matches(b,{stage:'grabado'}));
 assert.ok(!c.matches(a,{stage:'grabado'}));
 assert.ok(c.matches(a,{field:'estadios',value:'camp nou'}));
 assert.ok(!c.matches(b,{field:'estadios',value:'camp nou'}));
 assert.ok(c.matches(a,{}));
});
test('índice de etiquetas cuenta récords y Shorts exportados, sin los auxiliares',()=>{
 const index=c.tagIndex([
  {status:'exported',exports:[{}],tags:{jugadores:['Messi']}},
  {status:'editing',exports:[],tags:{jugadores:['messi','Yamal']}},
  {status:'auxiliary',exports:[],tags:{jugadores:['Messi']}}]);
 assert.deepEqual(index.jugadores,[{value:'Messi',total:2,exported:1},{value:'Yamal',total:1,exported:0}]);
});
test('compilación por categoría reúne los exportados con esa etiqueta y permite reutilizarlos',()=>{
 const root=tmp('categoria');
 try{
  s.ensureRoot(root);
  const m1=exported(root,'Messi 1',{jugadores:'Lionel Messi'});
  const m2=exported(root,'Messi 2',{jugadores:'lionel messi',clubes:'Inter Miami'});
  const y1=exported(root,'Yamal 1',{jugadores:'Lamine Yamal'});
  s.createProject(root,{title:'Messi sin exportar',tags:{jugadores:'Lionel Messi'}});
  const week=s.createWeek(root,{title:'Semana 1'});
  assert.equal(week.kind,'weekly');
  assert.deepEqual([...week.projectIds].sort(),[m1.id,m2.id,y1.id].sort());
  // Se simula la exportación de la semanal: los tres quedan marcados como usados.
  for(const id of week.projectIds){const p=s.getProject(root,id);p.usedBy.push(week.id);s.atomic(s.projectFile(root,id),p)}
  const messi=s.createWeek(root,{kind:'category',filter:{field:'jugadores',value:'LIONEL MESSI'}});
  assert.equal(messi.kind,'category');
  assert.deepEqual(messi.filter,{field:'jugadores',value:'Lionel Messi'});
  assert.equal(messi.title,'Todos los récords de Lionel Messi');
  assert.deepEqual([...messi.projectIds].sort(),[m1.id,m2.id].sort(),'incluye los ya usados en la semanal y excluye el no exportado');
  assert.equal(s.getProject(root,messi.intro.projectId).status,'auxiliary');
  assert.throws(()=>s.createWeek(root,{kind:'category',filter:{field:'jugadores',value:'Pelé'}}),/no hay Shorts/);
  assert.throws(()=>s.createWeek(root,{kind:'category',filter:{field:'inventado',value:'x'}}),/Elige una categoría/);
  assert.throws(()=>s.createWeek(root,{kind:'category',filter:{field:'jugadores',value:'  '}}),/Elige una categoría/);
  // Salir en la compilación temática no saca al récord de la siguiente semanal.
  const nuevo=exported(root,'Yamal 2',{jugadores:'Lamine Yamal'});
  {const p=s.getProject(root,nuevo.id);p.usedBy.push(messi.id);s.atomic(s.projectFile(root,nuevo.id),p)}
  const week2=s.createWeek(root,{title:'Semana 2'});
  assert.deepEqual(week2.projectIds,[nuevo.id],'solo el que no salió en una semanal');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
