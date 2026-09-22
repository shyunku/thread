import {fireEvent,render,screen,act} from "@testing-library/react";
import IpcSender from "../utils/IpcSender";
import LostRecoveryPanel from "./LostRecoveryPanel";
import BackupPanel from "./BackupPanel";
import LegacyStructureReview from "./LegacyStructureReview";
import ReencryptionPanel from "./ReencryptionPanel";
jest.mock("../utils/IpcSender",()=>({vault:{lostRecovery:jest.fn(),backup:jest.fn(),legacyManual:jest.fn(),reencryption:jest.fn()}}));
beforeEach(()=>jest.clearAllMocks());
test("loss recovery requires fresh consent for server apply and does not run on mount",async()=>{
 IpcSender.vault.lostRecovery.mockImplementation((action,input,cb)=>cb({success:true,data:action==="status"?null:{phase:action==="prepare"?"RECOVERY_UNCONFIRMED":"RECOVERY_CONFIRMED"}}));
 render(<LostRecoveryPanel osAvailable/>);
 const prepare=await screen.findByText("기존 파일 열어 분실 복구 준비");expect(prepare).toBeDisabled();
 expect(IpcSender.vault.lostRecovery).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(prepare);
 fireEvent.click(await screen.findByText("새 파일·코드 확인"));
 expect(await screen.findByText("이전 기기 해지·복구 결과 확인")).toBeDisabled();
});
test("backup never exports or restores automatically and requires explicit consent",async()=>{
 IpcSender.vault.backup.mockImplementation((action,input,cb)=>cb({success:true,data:{phase:"EXPORTED",count:3}}));
 render(<BackupPanel osAvailable/>);
 const save=screen.getByText("암호화 백업 저장");expect(save).toBeDisabled();
 expect(IpcSender.vault.backup).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(save);
 expect(await screen.findByRole("status")).toHaveTextContent("3개");
 expect(save).toBeDisabled();
 expect(IpcSender.vault.backup).toHaveBeenCalledWith("export",expect.objectContaining({confirmed:true,method:"os"}),expect.any(Function));
});
test("structural review submits only selected changes with the displayed revision",async()=>{
 IpcSender.vault.legacyManual.mockImplementation((action,input,cb)=>cb({success:true,data:action==="review"?{revision:"a".repeat(64),items:[{changeId:"one",text:"create task"}],total:1,next:null,canApply:true}:{phase:"QUEUED",count:1}}));
 render(<LegacyStructureReview intakeId="fixture"/>);
 expect(IpcSender.vault.legacyManual).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText("구조 변경 검토 불러오기"));
 await screen.findByText("create task");
 const boxes=screen.getAllByRole("checkbox");fireEvent.click(boxes[0]);fireEvent.click(boxes[1]);
 fireEvent.click(screen.getByText("선택한 변경을 새 의도로 적용"));
 await screen.findByRole("status");
 expect(IpcSender.vault.legacyManual).toHaveBeenLastCalledWith("resolve",{id:"fixture",changeIds:["one"],choice:"local",expectedRevision:"a".repeat(64),confirmed:true},expect.any(Function));
});
test("reencryption starts only on explicit consent and exposes durable status",async()=>{
 IpcSender.vault.reencryption.mockImplementation((action,input,cb)=>cb({success:true,data:{phase:"READY",generation:2,count:0}}));
 render(<ReencryptionPanel/>);
 expect(IpcSender.vault.reencryption).not.toHaveBeenCalled();
 const start=screen.getByText("재암호화 작업 시작");expect(start).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(start);
 expect(await screen.findByRole("status")).toHaveTextContent("키 세대 2");
 expect(IpcSender.vault.reencryption).toHaveBeenCalledWith("start",{confirmed:true},expect.any(Function));
});
test("late backup code after unmount is discarded",async()=>{
 let done;IpcSender.vault.backup.mockImplementation((action,input,cb)=>{done=cb;});
 const view=render(<BackupPanel osAvailable/>);fireEvent.click(screen.getByText("새 백업 코드 생성 (30초)"));view.unmount();
 await act(async()=>done({success:true,data:"PRIVATE_CODE"}));expect(screen.queryByText("PRIVATE_CODE")).not.toBeInTheDocument();
});
