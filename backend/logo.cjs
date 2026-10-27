'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sharp=require('sharp');
const jobs=new Map();
async function normalize(root,source){
 if(!source||!fs.existsSync(source))return null;
 const st=fs.statSync(source),fingerprint=crypto.createHash('sha256').update(source+st.size+st.mtimeMs).digest('hex').slice(0,16);
 const folder=path.join(root,'Recursos'),out=path.join(folder,'logo-preview-'+fingerprint+'.png');
 if(fs.existsSync(out)&&fs.statSync(out).size>100)return out;
 if(!jobs.has(out))jobs.set(out,(async()=>{
  fs.mkdirSync(folder,{recursive:true});
  const {data,info}=await sharp(source).rotate().resize(512,512,{fit:'inside',withoutEnlargement:true})
   .ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const rgba=Buffer.from(data);
  for(let i=0;i<rgba.length;i+=info.channels){
   const r=rgba[i],g=rgba[i+1],b=rgba[i+2];
   // Eliminar solo el fondo casi blanco sin oscurecer el emblema dorado.
   const lowest=Math.min(r,g,b),highest=Math.max(r,g,b);
   const white=lowest>=220&&highest-lowest<25;
   if(white){
    const opacity=Math.max(0,Math.min(1,(255-lowest)/35));
    rgba[i+3]=Math.round(rgba[i+3]*opacity);
   }
  }
  await sharp(rgba,{raw:{width:info.width,height:info.height,channels:info.channels}}).png().toFile(out);
  return out;
 })().finally(()=>jobs.delete(out)));
 return jobs.get(out);
}
module.exports={normalize};
