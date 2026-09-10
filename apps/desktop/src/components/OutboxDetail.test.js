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
