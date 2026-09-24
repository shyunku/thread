import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import RecoverySetup from "./RecoverySetup";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({vault:{identityStatus:jest.fn(),copyRecoveryCode:jest.fn(),exportRecovery:jest.fn(),confirmRecovery:jest.fn()}}));
beforeEach(()=>{jest.clearAllMocks();IpcSender.vault.identityStatus.mockImplementation(cb=>cb({success:true,data:{phase:"RECOVERY_UNCONFIRMED"}}));IpcSender.vault.exportRecovery.mockImplementation(cb=>cb({success:true,data:true}));IpcSender.vault.copyRecoveryCode.mockImplementation(cb=>cb({success:true,data:true}));});
test("recovery code is copied but never rendered",async()=>{
 jest.useFakeTimers();
 const view=render(<RecoverySetup/>);await act(async()=>{});
 fireEvent.click(screen.getByText("복구 파일 저장하고 코드 복사"));await act(async()=>{});
 expect(IpcSender.vault.copyRecoveryCode).toHaveBeenCalledTimes(1);
 expect(screen.queryByText("SYNTHETIC_CODE")).not.toBeInTheDocument();
 act(()=>jest.advanceTimersByTime(30000));expect(screen.queryByText(/클립보드는 30초 뒤/)).not.toBeInTheDocument();
 view.unmount();jest.useRealTimers();
});
test("file dialog cancellation does not mark recovery confirmed and clears entered code",async()=>{
 IpcSender.vault.confirmRecovery.mockImplementation((code,cb)=>cb({success:true,data:false}));
 render(<RecoverySetup/>);await screen.findByText("복구 파일 저장하고 코드 복사");
 fireEvent.click(screen.getByText("복구 파일 저장하고 코드 복사"));
 const input=await screen.findByLabelText("기록한 복구 코드");
 fireEvent.change(input,{target:{value:"SYNTHETIC_CODE"}});
 fireEvent.click(screen.getByText("복구 자료 확인"));
 await waitFor(()=>expect(IpcSender.vault.confirmRecovery).toHaveBeenCalled());
 expect(input.value).toBe("");expect(screen.queryByText("복구 자료 확인 완료")).not.toBeInTheDocument();
});
test("existing recovery file is preserved and explained",async()=>{
 IpcSender.vault.exportRecovery.mockImplementation(cb=>cb({success:false,data:{code:"RECOVERY_FILE_EXISTS"}}));
 render(<RecoverySetup/>);fireEvent.click(await screen.findByText("복구 파일 저장하고 코드 복사"));
 expect(await screen.findByRole("alert")).toHaveTextContent("다른 이름으로 저장해주세요");
 expect(IpcSender.vault.copyRecoveryCode).not.toHaveBeenCalled();
});
