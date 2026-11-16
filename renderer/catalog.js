'use strict';
// Catálogo de récords: etiquetas, guion, etapa de producción y filtros.
// Compartido por la interfaz y por el proceso principal (mismo patrón que visual-director.js).
(function(root,factory){
 const catalog=factory();
 if(typeof module==='object'&&module.exports)module.exports=catalog;
 if(root&&typeof window!=='undefined')root.Catalog=catalog;
})(typeof window!=='undefined'?window:null,function(){

const TAG_FIELDS=['jugadores','clubes','selecciones','estadios','competiciones','tipos'];
const TAG_LABELS={jugadores:'Jugador',clubes:'Club',selecciones:'Selección',estadios:'Estadio',competiciones:'Competición',tipos:'Tipo de récord'};
const STAGES=['idea','guion','grabado','transcrito','planificado','editado','aprobado','publicado'];
const STAGE_LABELS={idea:'Idea',guion:'Guion listo',grabado:'Grabado',transcrito:'Transcrito',planificado:'Planificado',editado:'Editado',aprobado:'Aprobado',publicado:'Publicado'};
const SCRIPT_PARTS=['hook','body','closing'];
const MAX_TAGS=12,MAX_TAG_LENGTH=60,MAX_SCRIPT=8000,MAX_NOTES=4000;

// Comparación sin tildes ni mayúsculas: "Lamine Yamal" y "lamine yamal" son la misma etiqueta.
function fold(text){
 return String(text??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}
function cleanTag(text){
 return String(text??'').replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,MAX_TAG_LENGTH);
}
function emptyTags(){return Object.fromEntries(TAG_FIELDS.map(f=>[f,[]]))}
function emptyScript(){return {hook:'',body:'',closing:''}}

// Acepta listas o texto separado por comas; elimina vacíos y duplicados.
function normalizeTags(input){
 const out=emptyTags();
 if(input===undefined||input===null)return out;
 if(typeof input!=='object'||Array.isArray(input))throw Error('Etiquetas inválidas');
 for(const field of TAG_FIELDS){
  const raw=input[field];
  if(raw===undefined||raw===null)continue;
  const list=Array.isArray(raw)?raw:typeof raw==='string'?raw.split(','):null;
  if(!list)throw Error('Etiquetas inválidas en '+TAG_LABELS[field]);
  const seen=new Set();
  for(const item of list){
   if(typeof item!=='string')throw Error('Etiquetas inválidas en '+TAG_LABELS[field]);
   const tag=cleanTag(item),key=fold(tag);
   if(!key||seen.has(key))continue;
   seen.add(key);out[field].push(tag);
  }
  if(out[field].length>MAX_TAGS)throw Error('Demasiadas etiquetas en '+TAG_LABELS[field]+' (máximo '+MAX_TAGS+')');
 }
 return out;
}
function normalizeScript(input){
 const out=emptyScript();
 if(input===undefined||input===null)return out;
 if(typeof input!=='object'||Array.isArray(input))throw Error('Guion inválido');
 for(const part of SCRIPT_PARTS){
  const text=input[part];
  if(text===undefined||text===null)continue;
  if(typeof text!=='string')throw Error('Guion inválido');
  if(text.length>MAX_SCRIPT)throw Error('El guion de una escena supera '+MAX_SCRIPT+' caracteres');
  out[part]=text.replace(/\r\n?/g,'\n');
 }
 return out;
}
function normalizeStage(stage){
 if(!STAGES.includes(stage))throw Error('Etapa de producción inválida');
 return stage;
}
function normalizeDate(value){
 const text=String(value??'');
 if(!text)return '';
 const date=new Date(text);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(+date)||date.toISOString().slice(0,10)!==text)throw Error('Fecha inválida');
 return text;
}
function normalizeNotes(text){
 if(text===undefined||text===null)return '';
 if(typeof text!=='string'||text.length>MAX_NOTES)throw Error('Notas inválidas o demasiado largas');
 return text.replace(/\r\n?/g,'\n');
}
function hasScript(project){
 const script=project?.script||{};
 return SCRIPT_PARTS.some(part=>String(script[part]||'').trim().length>0);
}
// La etapa efectiva es la más avanzada entre la que marcaste a mano y la que demuestra el contenido:
// si el récord ya tiene video grabado o Short exportado, avanza solo aunque nadie la haya cambiado.
function deriveStage(project){
 let content='idea';
 if(project?.status==='exported'||(project?.exports||[]).length)content='editado';
 else if(project?.editingPlan&&Object.values(project?.scenes||{}).some(scene=>scene?.video))content='planificado';
 else if(Object.entries(project?.transcripts||{}).some(([key,transcript])=>transcript.assetId===project.scenes?.[key]?.video))content='transcrito';
 else if(Object.values(project?.scenes||{}).some(scene=>scene&&scene.video))content='grabado';
 else if(hasScript(project))content='guion';
 const stored=STAGES.includes(project?.stage)?project.stage:'idea';
 return STAGES.indexOf(stored)>STAGES.indexOf(content)?stored:content;
}
function tagsOf(project){
 try{return normalizeTags(project?.tags)}catch(_){return emptyTags()}
}
function hasTag(project,field,value){
 if(!TAG_FIELDS.includes(field))return false;
 const wanted=fold(value);
 return Boolean(wanted)&&tagsOf(project)[field].some(tag=>fold(tag)===wanted);
}
// query: {text, stage, field, value}. Todos los criterios son opcionales y se combinan.
function matches(project,query={}){
 if(query.stage&&deriveStage(project)!==query.stage)return false;
 const date=project?.plannedDate||(project?.createdAt||'').slice(0,10);
 if((query.from&&date<query.from)||(query.to&&date>query.to))return false;
 if(query.field&&query.value&&!hasTag(project,query.field,query.value))return false;
 const text=fold(query.text);
 if(text){
  const tags=tagsOf(project);
  const haystack=fold([project?.title,...TAG_FIELDS.flatMap(f=>tags[f])].join(' '));
  if(!text.split(' ').every(word=>haystack.includes(word)))return false;
 }
 return true;
}
// Índice de etiquetas: cuántos récords hay de cada una y cuántos ya tienen Short exportado.
function tagIndex(projects){
 const index=Object.fromEntries(TAG_FIELDS.map(f=>[f,[]]));
 for(const field of TAG_FIELDS){
  const byKey=new Map();
  for(const project of projects||[]){
   if(project?.status==='auxiliary')continue;
   const exported=project?.status==='exported'||(project?.exports||[]).length>0;
   for(const tag of tagsOf(project)[field]){
    const key=fold(tag);
    const entry=byKey.get(key)||{value:tag,total:0,exported:0};
    entry.total++;if(exported)entry.exported++;
    byKey.set(key,entry);
   }
  }
  index[field]=[...byKey.values()].sort((a,b)=>b.total-a.total||a.value.localeCompare(b.value,'es'));
 }
 return index;
}

// Convierte un guion pegado como texto en sus tres partes.
// Reconoce encabezados GANCHO / DESARROLLO (o CUERPO) / CIERRE (o CTA), con o sin ":" y con o sin "#".
function parseScript(text){
 if(typeof text!=='string')throw Error('Guion inválido');
 const out=emptyScript();
 const heads=[['hook',/^(?:#+\s*)?(?:\d+[.)]\s*)?(?:\*\*)?\s*(gancho|hook)\b\s*(?:\*\*)?\s*[:\-–—]?\s*/i],
  ['body',/^(?:#+\s*)?(?:\d+[.)]\s*)?(?:\*\*)?\s*(desarrollo|cuerpo|contenido)\b\s*(?:\*\*)?\s*[:\-–—]?\s*/i],
  ['closing',/^(?:#+\s*)?(?:\d+[.)]\s*)?(?:\*\*)?\s*(cierre|cta|final|despedida)\b\s*(?:\*\*)?\s*[:\-–—]?\s*/i]];
 let current=null,found=false;const buckets={hook:[],body:[],closing:[]};
 for(const line of text.replace(/\r\n?/g,'\n').split('\n')){
  const head=heads.find(([,re])=>re.test(line.trim()));
  if(head){
   current=head[0];found=true;
   const rest=line.trim().replace(head[1],'').trim();
   if(rest)buckets[current].push(rest);
   continue;
  }
  if(current)buckets[current].push(line);
 }
 if(!found){out.body=text.trim();return normalizeScript(out)}
 for(const part of SCRIPT_PARTS)out[part]=buckets[part].join('\n').trim();
 return normalizeScript(out);
}

return {TAG_FIELDS,TAG_LABELS,STAGES,STAGE_LABELS,SCRIPT_PARTS,fold,emptyTags,emptyScript,normalizeTags,
 normalizeScript,normalizeStage,normalizeNotes,normalizeDate,hasScript,deriveStage,tagsOf,hasTag,matches,tagIndex,parseScript};
});
