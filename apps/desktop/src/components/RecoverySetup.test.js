import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import RecoverySetup from "./RecoverySetup";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({vault:{identityStatus:jest.fn(),recoveryCode:jest.fn(),confirmRecovery:jest.fn()}}));
beforeEach(()=>{jest.clearAllMocks();IpcSender.vault.identityStatus.mockImplementation(cb=>cb({success:true,data:{phase:"RECOVERY_UNCONFIRMED"}}));});
test("code is hidden after thirty seconds",async()=>{
 jest.useFakeTimers();IpcSender.vault.recoveryCode.mockImplementation(cb=>cb({success:true,data:"SYNTHETIC_CODE"}));
 const view=render(<RecoverySetup/>);await act(async()=>{});
 fireEvent.click(screen.getByText("복구 코드 보기 (30초)"));await act(async()=>{});
 expect(screen.getByText("SYNTHETIC_CODE")).toBeInTheDocument();
 act(()=>jest.advanceTimersByTime(30000));expect(screen.queryByText("SYNTHETIC_CODE")).not.toBeInTheDocument();
 view.unmount();jest.useRealTimers();
});
test("file dialog cancellation does not mark recovery confirmed and clears entered code",async()=>{
 IpcSender.vault.confirmRecovery.mockImplementation((code,cb)=>cb({success:true,data:false}));
 render(<RecoverySetup/>);const input=await screen.findByLabelText("보관한 복구 코드");
 fireEvent.change(input,{target:{value:"SYNTHETIC_CODE"}});
 fireEvent.click(screen.getByText("저장한 파일 열어 확인"));
 await waitFor(()=>expect(IpcSender.vault.confirmRecovery).toHaveBeenCalled());
 expect(input.value).toBe("");expect(screen.queryByText("복구 파일·코드 검증 완료")).not.toBeInTheDocument();
});
