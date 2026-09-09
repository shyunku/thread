import jsQR from "jsqr";
import {readPairingImage} from "./pairingQrImage";
jest.mock("jsqr",()=>jest.fn());
afterEach(()=>{jest.restoreAllMocks();delete global.createImageBitmap;});
test("selected image is decoded locally and bitmap is always closed",async()=>{
 const bitmap={width:320,height:320,close:jest.fn()};
 global.createImageBitmap=jest.fn().mockResolvedValue(bitmap);
 jest.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue({drawImage:jest.fn(),getImageData:()=>({data:new Uint8ClampedArray(320*320*4)})});
 jsQR.mockReturnValue({data:"thread-pair:v1:fixture"});
 expect(await readPairingImage(new File(["fixture"],"qr.png",{type:"image/png"}))).toBe("thread-pair:v1:fixture");
 expect(bitmap.close).toHaveBeenCalledTimes(1);
 jsQR.mockReturnValue({data:"https://unrelated.invalid"});
 await expect(readPairingImage(new File(["fixture"],"qr.png",{type:"image/png"}))).rejects.toThrow("PAIRING_QR_NOT_FOUND");
 expect(bitmap.close).toHaveBeenCalledTimes(2);
});
test("non-image and oversized image are rejected before decoding",async()=>{
 global.createImageBitmap=jest.fn();
 await expect(readPairingImage({type:"image/svg+xml",size:1})).rejects.toThrow();
 await expect(readPairingImage({type:"image/png",size:6*1024*1024})).rejects.toThrow();
 expect(global.createImageBitmap).not.toHaveBeenCalled();
});
