import {fireEvent,render,screen} from "@testing-library/react";
import EncryptedSync from "./EncryptedSync";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({vault:{sync:jest.fn()}}));
test("sync is explicit and an unmigrated server is never presented as protected",()=>{
 IpcSender.vault.sync.mockImplementation(cb=>cb({success:true,data:{phase:"WAITING_FOR_MIGRATION"}}));
 render(<EncryptedSync/>);expect(IpcSender.vault.sync).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"암호화 동기화 실행"}));
 expect(screen.getByText(/서버 계정이 아직 E2EE로 전환되지 않았습니다/)).toBeInTheDocument();
 expect(screen.queryByText(/암호화 동기화 완료/)).not.toBeInTheDocument();
});
