'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const s=require('../backend/store.cjs');
test('biblioteca local, copia independiente y persistencia',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'11records-test-'));
 try{
  s.ensureRoot(root);
  const project=s.createProject(root,{title:'Yamal iguala récord'});
  assert.equal(s.listProjects(root).length,1);
  const input=path.join(root,'imagen.png');fs.writeFileSync(input,'datos de prueba');
  const saved=s.importAsset(root,project.id,input);
  fs.unlinkSync(input);
  assert.equal(fs.readFileSync(s.resolveAsset(root,project.id,saved.id),'utf8'),'datos de prueba');
  const p=s.getProject(root,project.id);p.scenes.body.media.push({assetId:saved.id,speed:1.1});
  s.saveProject(root,p);
  assert.equal(s.getProject(root,project.id).scenes.body.media.length,1);
  assert.throws(()=>s.resolveAsset(root,project.id,'../../etc/passwd'));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('compilación crea intro/cierre editable y no vuelve a incluir récords usados',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'11records-week-'));
 try{
  s.ensureRoot(root);
  const p=s.createProject(root,{title:'Récord 1'});
  p.status='exported';p.exports.push({mode:'short',file:'x.mp4'});
  s.atomic(s.projectFile(root,p.id),p);
  const week=s.createWeek(root,{title:'Semana'});
  assert.deepEqual(week.projectIds,[p.id]);
  assert.ok(week.intro.projectId);
  assert.equal(week.intro.projectId,week.closing.projectId);
  assert.equal(s.getProject(root,week.intro.projectId).status,'auxiliary');
  p.usedBy.push(week.id);s.atomic(s.projectFile(root,p.id),p);
  const another=s.createWeek(root,{title:'Siguiente'});
  assert.deepEqual(another.projectIds,[]);
  assert.throws(()=>s.deleteProject(root,p.id),/utilizado/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
