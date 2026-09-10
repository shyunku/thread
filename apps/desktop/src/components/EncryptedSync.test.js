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

test("active sync with pending work is not called complete or proof of plaintext cleanup",()=>{
 IpcSender.vault.sync.mockImplementation(cb=>cb({success:true,data:{phase:"ACTIVE",cursor:"2",pending:1,conflicts:1}}));
 render(<EncryptedSync/>);fireEvent.click(screen.getByRole("button",{name:"암호화 동기화 실행"}));
 expect(screen.getByText(/미전송 1개 · 확인 필요 1개/)).toBeInTheDocument();
 expect(screen.queryByText(/암호화 동기화 완료/)).not.toBeInTheDocument();
 expect(screen.getByText(/과거 서버 데이터·백업의 평문 정리/)).toBeInTheDocument();
});
