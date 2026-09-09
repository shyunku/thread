import jsQR from "jsqr";
export async function readPairingImage(file){
 if(!file||!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>5*1024*1024)throw Error("INVALID_QR_IMAGE");
 const bitmap=await createImageBitmap(file);
 try{
  if(bitmap.width<1||bitmap.height<1||bitmap.width>8192||bitmap.height>8192)throw Error("QR_IMAGE_LIMIT");
  const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext("2d",{willReadFrequently:true});if(!context)throw Error("QR_IMAGE_UNAVAILABLE");
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const pixels=context.getImageData(0,0,canvas.width,canvas.height);
  const result=jsQR(pixels.data,canvas.width,canvas.height,{inversionAttempts:"attemptBoth"});
  if(!result?.data?.startsWith("thread-pair:v1:")||result.data.length>2800)throw Error("PAIRING_QR_NOT_FOUND");
  return result.data;
 }finally{bitmap.close();}
}
