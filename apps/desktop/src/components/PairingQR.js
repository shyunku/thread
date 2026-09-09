import {useEffect,useState} from "react";
import QRCode from "qrcode";
export default function PairingQR({request}){
 const [image,setImage]=useState(null),[error,setError]=useState(false),[expired,setExpired]=useState(false);
 useEffect(()=>{
  let active=true;setImage(null);setError(false);setExpired(false);
  const remaining=request.expiresAt-Date.now();
  if(remaining<=0){setExpired(true);return ()=>{};}
  const timer=setTimeout(()=>{active=false;setImage(null);setExpired(true);},remaining);
  QRCode.toDataURL(request.qr,{errorCorrectionLevel:"M",width:512,margin:4}).then(url=>{if(active)setImage({qr:request.qr,url});}).catch(()=>{if(active)setError(true);});
  return ()=>{active=false;clearTimeout(timer);};
 },[request.qr,request.expiresAt]);
 if(expired||request.expiresAt<=Date.now())return <p>연결 QR이 만료됐습니다. 새 요청을 만들어주세요.</p>;
 if(error)return <p role="alert">QR을 표시하지 못했습니다. 연결 요청 파일을 사용해주세요.</p>;
 return image?.qr===request.qr?<img src={image.url} alt="기기 연결 요청 QR" style={{width:512,maxWidth:"100%",height:"auto",imageRendering:"pixelated"}}/>:<p>QR 생성 중…</p>;
}
