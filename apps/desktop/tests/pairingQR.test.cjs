const {test}=require("node:test"),assert=require("node:assert/strict"),QRCode=require("qrcode"),jsQR=require("jsqr");
const p=require("../public/electron/e2ee/protocol"),pair=require("../public/electron/e2ee/pairing");
test("actual QR pixels decode back to the exact signed public request",async()=>{
 const device=await p.createDevice(),request=await pair.createRequest({vaultId:"fixture",genesisFingerprint:"a".repeat(64),device});
 const text=pair.toQR(request),symbol=QRCode.create(text,{errorCorrectionLevel:"M"}),scale=4,margin=4,size=(symbol.modules.size+margin*2)*scale;
 const pixels=new Uint8ClampedArray(size*size*4).fill(255);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const row=Math.floor(y/scale)-margin,col=Math.floor(x/scale)-margin;
  if(row>=0&&col>=0&&row<symbol.modules.size&&col<symbol.modules.size&&symbol.modules.get(row,col)){
   const index=(y*size+x)*4;pixels[index]=pixels[index+1]=pixels[index+2]=0;
  }
 }
 const result=jsQR(pixels,size,size);assert.equal(result.data,text);
 assert.deepEqual(await pair.fromQR(result.data),request);
 assert.equal(text.includes(device.signing.privateKey.toString("hex")),false);
 await assert.rejects(pair.fromQR(text,request.body.expiresAt+1));
});
