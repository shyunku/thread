import {fireEvent,render,screen} from "@testing-library/react";
import RotationPanel from "./RotationPanel";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({vault:{rotation:jest.fn()}}));
test("rotation is explicit and excludes this device from removal",async()=>{
 IpcSender.vault.rotation.mockImplementation((action,input,cb)=>cb({success:true,data:action==="status"?null:action==="devices"?[{id:"self",own:true,role:"write"},{id:"other",own:false,role:"read"}]:{phase:"RECOVERY_UNCONFIRMED"}}));
 render(<RotationPanel osAvailable/>);
 expect(IpcSender.vault.rotation).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByText("기기 목록 확인"));await screen.findByText(/현재 기기/);
 expect(screen.getByLabelText(/현재 기기/)).toBeDisabled();
 fireEvent.click(screen.getByLabelText(/조회 기기/));
 const prepare=screen.getByText("새 키·복구 자료 준비");expect(prepare).toBeDisabled();
 fireEvent.click(screen.getByLabelText(/기기 권한·키·복구 코드/));fireEvent.click(prepare);
 await screen.findByText("새 복구 자료 보관·확인 필요");
 expect(IpcSender.vault.rotation).toHaveBeenLastCalledWith("prepare",expect.objectContaining({confirmed:true,method:"os",remove:["other"]}),expect.any(Function));
 expect(screen.queryByText("키 회전 적용·결과 확인")).not.toBeInTheDocument();
});
