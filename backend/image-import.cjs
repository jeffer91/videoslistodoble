'use strict';
// Se conservan las imágenes originales. Los formatos especiales se rasterizan
// a PNG para asegurar compatibilidad con la vista previa y el render FFmpeg.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const sharp=require('sharp');
const IMAGE_EXTENSIONS=[
 '.jpg','.jpeg','.jpe','.jfif','.png','.apng','.webp','.gif',
 '.bmp','.dib','.tif','.tiff','.tga','.targa','.ico','.cur',
 '.avif','.heic','.heif','.svg','.svgz','.psd','.dds','.pcx',
 '.jp2','.j2k','.jpf','.jpx','.pbm','.pgm','.ppm','.pnm','.pam',
 '.hdr','.exr','.qoi'
];
const IMAGE_SET=new Set(IMAGE_EXTENSIONS);
const DIRECT_EXTENSIONS=new Set(['.jpg','.jpeg','.png','.webp','.gif']);
async function importImage(root,projectId,source,store){
 const ext=path.extname(source).toLowerCase();
 if(!IMAGE_SET.has(ext))throw Error('Extensión de imagen no admitida: '+ext);
 const stat=fs.statSync(source);
 if(!stat.isFile()||stat.size>200*1024*1024)throw Error('Imagen vacía o mayor a 200 MB');
 if(DIRECT_EXTENSIONS.has(ext))return store.importAsset(root,projectId,source);
 const tmp=path.join(os.tmpdir(),'11records-image-'+crypto.randomUUID()+'.png');
 try{
  try{
   await sharp(source,{limitInputPixels:64*1024*1024,animated:false,failOn:'error'})
    .rotate().resize({width:4096,height:4096,fit:'inside',withoutEnlargement:true})
    .png({compressionLevel:7}).toFile(tmp);
  }catch(firstError){
   if(fs.existsSync(tmp))fs.rmSync(tmp,{force:true});
   const ffmpeg=require('ffmpeg-static');
   const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',source,
     '-frames:v','1','-vf',"scale=w='min(iw,4096)':h='min(ih,4096)':force_original_aspect_ratio=decrease",
     '-pix_fmt','rgba',tmp],
     {encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:2*1024*1024});
   if(result.error||result.status!==0)
    throw Error('No se pudo convertir '+path.basename(source)+'. '+(result.error?.message||result.stderr||firstError.message).slice(0,260));
  }
  if(!fs.existsSync(tmp)||fs.statSync(tmp).size<50)throw Error('No se generó un PNG válido');
  return store.importAsset(root,projectId,tmp,path.basename(source)+' (convertida a PNG)');
 }finally{if(fs.existsSync(tmp))fs.rmSync(tmp,{force:true})}
}
module.exports={IMAGE_EXTENSIONS,IMAGE_SET,importImage};
