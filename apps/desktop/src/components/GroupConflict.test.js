import {fireEvent,render,screen} from "@testing-library/react";
import GroupConflict from "./GroupConflict";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({vault:{groupConflict:jest.fn()}}));
test("whole pending review requires explicit consent and sends the exact displayed revision",()=>{
 const page={revision:"a".repeat(64),requests:2,objects:1,canResolve:true,items:[]};
 IpcSender.vault.groupConflict.mockImplementation((action,input,cb)=>cb({success:true,data:action==="review"?page:{phase:"QUEUED"}}));
 render(<GroupConflict/>);expect(IpcSender.vault.groupConflict).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText("전체 전송 대기 비교"));
 const choose=screen.getByText("전체 로컬 값으로 새 요청 만들기");expect(choose).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(choose);
 expect(IpcSender.vault.groupConflict).toHaveBeenLastCalledWith("resolve",{confirmed:true,choice:"local",expectedRevision:page.revision},expect.any(Function));
 expect(screen.getByRole("status")).toHaveTextContent("아직 서버 전송 완료가 아닙니다");
});
