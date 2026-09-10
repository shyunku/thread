import {act,fireEvent,render,screen} from "@testing-library/react";
import OutboxDetail from "./OutboxDetail";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({vault:{outboxDetail:jest.fn()}}));
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
