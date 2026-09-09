import {act,fireEvent,render,screen} from "@testing-library/react";
import DevicePairing from "./DevicePairing";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({vault:{pairing:jest.fn()}}));
test("approval requires fingerprint confirmation and clears the reauthentication password",()=>{
 const preview={requestId:"a".repeat(32),fingerprint:"b".repeat(64),expiresAt:Date.now()+600000,role:"write"};
 IpcSender.vault.pairing.mockImplementation((action,input,cb)=>cb({success:true,data:action==="preview"?preview:{approved:true,saved:true}}));
 render(<DevicePairing/>);fireEvent.click(screen.getByText("연결 요청 파일 열기"));
 const approve=screen.getByText("재인증 후 승인·파일 저장");expect(approve).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox"));
 const password=screen.getByLabelText("승인용 보관함 비밀번호");
 fireEvent.change(password,{target:{value:"synthetic password"}});fireEvent.click(approve);
 expect(password.value).toBe("");
 expect(IpcSender.vault.pairing).toHaveBeenLastCalledWith("approve",expect.objectContaining({fingerprint:preview.fingerprint,password:"synthetic password"}),expect.any(Function));
});
test("late file reply after unmount does not update the next view",()=>{
 let finish;IpcSender.vault.pairing.mockImplementation((action,input,cb)=>{finish=cb;});
 const view=render(<DevicePairing/>);
 fireEvent.click(screen.getByText("승인받은 키 전달 파일 열기"));view.unmount();
 render(<DevicePairing/>);act(()=>finish({success:true,data:{phase:"PAIRED"}}));
 expect(screen.queryByText(/기기 키 연결을 완료/)).not.toBeInTheDocument();
});
