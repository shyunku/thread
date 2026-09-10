import {act,fireEvent,render,screen} from "@testing-library/react";
import OutboxDetail from "./OutboxDetail";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({vault:{outboxDetail:jest.fn(),resolveConflict:jest.fn(),reconcileConflict:jest.fn()}}));
beforeEach(()=>jest.clearAllMocks());
const data={baseVersion:"1",currentVersion:"2",fields:[{slot:0,base:{present:true,text:"before"},local:{present:true,text:"<script>private</script>"},current:{present:true,text:"remote"}}],more:false};
test("contents are explicit, escaped text and hidden on request",()=>{
 IpcSender.vault.outboxDetail.mockImplementation((request,cb)=>cb({success:true,data}));
 const view=render(<OutboxDetail id="fixture" objectId="task"/>);
 expect(IpcSender.vault.outboxDetail).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText("내용 비교 열기"));
 expect(screen.getByText("<script>private</script>")).toBeInTheDocument();expect(view.container.querySelector("script")).toBeNull();
 expect(screen.getByText(/실시간 상태는 아닙니다/)).toBeInTheDocument();
 fireEvent.click(screen.getByText("내용 숨기기"));expect(screen.queryByText("before")).not.toBeInTheDocument();
});
test("hide and unmount invalidate late responses",()=>{
 let reply;IpcSender.vault.outboxDetail.mockImplementation((request,cb)=>{reply=cb;});
 const view=render(<OutboxDetail id="fixture" objectId="task"/>);
 fireEvent.click(screen.getByText("내용 비교 열기"));fireEvent.click(screen.getByText("내용 숨기기"));
 act(()=>reply({success:true,data}));expect(screen.queryByText("before")).not.toBeInTheDocument();
 fireEvent.click(screen.getByText("내용 비교 열기"));view.unmount();
 act(()=>reply({success:true,data}));expect(screen.queryByText("before")).not.toBeInTheDocument();
});

test("next page sends the same comparison revision and changed data clears the view",()=>{
 IpcSender.vault.outboxDetail.mockImplementationOnce((request,cb)=>cb({success:true,data:{...data,revision:"a".repeat(64),more:true,next:20,fields:[{...data.fields[0],status:"FIELD_CONFLICT"}]}}))
  .mockImplementationOnce((request,cb)=>cb({success:false}));
 render(<OutboxDetail id="fixture" objectId="task"/>);
 fireEvent.click(screen.getByText("내용 비교 열기"));expect(screen.getByText("양쪽 변경 충돌")).toBeInTheDocument();
 fireEvent.click(screen.getByText("다음 필드"));
 expect(IpcSender.vault.outboxDetail.mock.calls[1][0]).toEqual({id:"fixture",objectId:"task",offset:20,expectedRevision:"a".repeat(64)});
 expect(screen.queryByText("before")).not.toBeInTheDocument();
 expect(screen.getByRole("alert")).toHaveTextContent("처음부터 다시");
});

test("resolution requires explicit acknowledgement and preserves the displayed revision",()=>{
 IpcSender.vault.outboxDetail.mockImplementation((request,cb)=>cb({success:true,data:{...data,revision:"a".repeat(64),canResolve:true}}));
 IpcSender.vault.resolveConflict.mockImplementation((request,cb)=>cb({success:true,data:{phase:"QUEUED"}}));
 render(<OutboxDetail id="fixture" objectId="task"/>);fireEvent.click(screen.getByText("내용 비교 열기"));
 const button=screen.getByText("내 변경을 전송 대기에 등록");expect(button).toBeDisabled();
 fireEvent.click(button);expect(IpcSender.vault.resolveConflict).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(button);
 expect(IpcSender.vault.resolveConflict.mock.calls[0][0]).toEqual({id:"fixture",objectId:"task",expectedRevision:"a".repeat(64),choice:"local"});
 expect(screen.getByRole("status")).toHaveTextContent("아직 서버에 전송하지 않았습니다");
});

test("unresolved signed requests do not expose resolution actions",()=>{
 IpcSender.vault.outboxDetail.mockImplementation((request,cb)=>cb({success:true,data:{...data,canResolve:false}}));
 render(<OutboxDetail id="fixture" objectId="task"/>);fireEvent.click(screen.getByText("내용 비교 열기"));
 expect(screen.queryByText("내 변경을 전송 대기에 등록")).not.toBeInTheDocument();
});

test("signed retry requires consent and reports unresolved rejection without claiming success",()=>{
 IpcSender.vault.outboxDetail.mockImplementation((request,cb)=>cb({success:true,data:{...data,revision:"b".repeat(64),canRetrySigned:true,canResolve:false}}));
 IpcSender.vault.reconcileConflict.mockImplementation((request,cb)=>cb({success:true,data:{phase:"REVIEW_REQUIRED"}}));
 render(<OutboxDetail id="fixture" objectId="task"/>);fireEvent.click(screen.getByText("내용 비교 열기"));
 const button=screen.getByText("원본 재시도·반영 확인");expect(button).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(button);
 expect(IpcSender.vault.reconcileConflict.mock.calls[0][0]).toEqual({id:"fixture",objectId:"task",expectedRevision:"b".repeat(64)});
 expect(screen.getByRole("status")).toHaveTextContent("미반영이 확정된 것은 아니며");
 expect(IpcSender.vault.resolveConflict).not.toHaveBeenCalled();
});
