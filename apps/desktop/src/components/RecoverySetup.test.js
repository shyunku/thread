import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import RecoverySetup from "./RecoverySetup";
import IpcSender from "../utils/IpcSender";
import Toast from "../molecules/Toast";
const PREVIEW="THREAD1-F*******-"+Array(8).fill("********").join("-");
jest.mock("../utils/IpcSender",()=>({vault:{identityStatus:jest.fn(),prepareIdentity:jest.fn(),recoveryCodePreview:jest.fn(),copyRecoveryCode:jest.fn(),exportRecovery:jest.fn(),confirmRecovery:jest.fn()}}));
jest.mock("../molecules/Toast",()=>({__esModule:true,default:{success:jest.fn()}}));
beforeEach(()=>{jest.clearAllMocks();IpcSender.vault.identityStatus.mockImplementation(cb=>cb({success:true,data:{phase:"RECOVERY_UNCONFIRMED"}}));IpcSender.vault.exportRecovery.mockImplementation(cb=>cb({success:true,data:true}));IpcSender.vault.recoveryCodePreview.mockImplementation(cb=>cb({success:true,data:PREVIEW}));IpcSender.vault.copyRecoveryCode.mockImplementation(cb=>cb({success:true,data:true}));});
test("file save, code copy and code confirmation use separate screens",async()=>{
 render(<RecoverySetup/>);
 fireEvent.click(await screen.findByRole("button",{name:"복구 파일 저장"}));
 expect(await screen.findByText(PREVIEW)).toBeInTheDocument();
 expect(screen.queryByLabelText("기록한 복구 코드")).not.toBeInTheDocument();
 const next=screen.getByRole("button",{name:"저장했어요"});expect(next).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"복구 코드 복사"}));
 await waitFor(()=>expect(Toast.success).toHaveBeenCalledWith("복사되었어요",{duration:3000}));
 expect(screen.getByText(/클립보드는 30초 뒤/)).toBeInTheDocument();
 await waitFor(()=>expect(next).toBeEnabled());
 fireEvent.click(next);
 expect(screen.getByLabelText("기록한 복구 코드")).toBeInTheDocument();
 expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
 expect(screen.getByRole("button",{name:"복구 코드 확인"})).toBeInTheDocument();
});
test("missing identity is prepared automatically without an extra button",async()=>{
 IpcSender.vault.identityStatus.mockImplementation(cb=>cb({success:true,data:null}));
 IpcSender.vault.prepareIdentity.mockImplementation(cb=>cb({success:true,data:{phase:"RECOVERY_UNCONFIRMED"}}));
 render(<RecoverySetup/>);
 expect(await screen.findByRole("button",{name:"복구 파일 저장"})).toBeInTheDocument();
 expect(IpcSender.vault.prepareIdentity).toHaveBeenCalledTimes(1);
 expect(screen.queryByText("복구 자료 만들기")).not.toBeInTheDocument();
});
test("automatic preparation failure can be retried without resetting data",async()=>{
 IpcSender.vault.identityStatus.mockImplementation(cb=>cb({success:true,data:null}));
 IpcSender.vault.prepareIdentity.mockImplementationOnce(cb=>cb({success:false})).mockImplementationOnce(cb=>cb({success:true,data:{phase:"RECOVERY_UNCONFIRMED"}}));
 render(<RecoverySetup/>);
 fireEvent.click(await screen.findByRole("button",{name:"백업 수단 다시 시도"}));
 expect(await screen.findByRole("button",{name:"복구 파일 저장"})).toBeInTheDocument();
 expect(IpcSender.vault.prepareIdentity).toHaveBeenCalledTimes(2);
});
test("file dialog cancellation does not mark recovery confirmed and clears entered code",async()=>{
 IpcSender.vault.confirmRecovery.mockImplementation((code,cb)=>cb({success:true,data:false}));
 render(<RecoverySetup/>);fireEvent.click(await screen.findByRole("button",{name:"복구 파일 저장"}));
 fireEvent.click(await screen.findByRole("button",{name:"복구 코드 복사"}));
 const next=screen.getByRole("button",{name:"저장했어요"});await waitFor(()=>expect(next).toBeEnabled());fireEvent.click(next);
 const input=await screen.findByLabelText("기록한 복구 코드");
 fireEvent.change(input,{target:{value:"SYNTHETIC_CODE"}});
 fireEvent.click(screen.getByRole("button",{name:"복구 코드 확인"}));
 await waitFor(()=>expect(IpcSender.vault.confirmRecovery).toHaveBeenCalled());
 expect(input.value).toBe("");expect(screen.queryByText("복구 자료 확인 완료")).not.toBeInTheDocument();
});
test("existing recovery file is preserved and explained",async()=>{
 IpcSender.vault.exportRecovery.mockImplementation(cb=>cb({success:false,data:{code:"RECOVERY_FILE_EXISTS"}}));
 render(<RecoverySetup/>);fireEvent.click(await screen.findByRole("button",{name:"복구 파일 저장"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("다른 이름으로 저장해주세요");
 expect(IpcSender.vault.copyRecoveryCode).not.toHaveBeenCalled();
});
