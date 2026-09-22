import {forwardRef,useState} from "react";
import "./PasswordField.scss";
const PasswordField=forwardRef(function PasswordField({label="비밀번호",...props},ref){
 const [visible,setVisible]=useState(false);
 return <div className="password-field"><input {...props} ref={ref} type={visible?"text":"password"}/><button type="button" disabled={props.disabled} aria-label={`${label} ${visible?"숨기기":"보기"}`} aria-pressed={visible} onClick={()=>setVisible(v=>!v)}>
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{!visible&&<path d="m3 3 18 18"/>}</svg>
 </button></div>;
});
export default PasswordField;
