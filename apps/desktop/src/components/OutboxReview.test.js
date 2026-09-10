import {act,fireEvent,render,screen} from "@testing-library/react";
import OutboxReview from "./OutboxReview";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({vault:{outboxReviews:jest.fn()}}));
beforeEach(()=>jest.clearAllMocks());
test("review is explicit, paginated and does not offer destructive actions",()=>{
 IpcSender.vault.outboxReviews.mockImplementation((request,cb)=>cb({success:true,data:{items:[{id:"fixture",status:"REVIEW_REQUIRED",reason:"STALE_SIGNED_REQUEST",objectCount:1,objects:[]}],next:"cursor",more:true}}));
 render(<OutboxReview/>);expect(IpcSender.vault.outboxReviews).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText("미전송 항목 확인"));
 expect(screen.getByText(/미반영이 확정된 것은 아닙니다/)).toBeInTheDocument();
 fireEvent.click(screen.getByText("다음 20개"));
 expect(IpcSender.vault.outboxReviews.mock.calls[1][0]).toEqual({after:"cursor",limit:20});
 expect(screen.queryByRole("button",{name:"삭제"})).not.toBeInTheDocument();
});
test("late replies cannot repopulate an unmounted vault panel",()=>{
 let reply;IpcSender.vault.outboxReviews.mockImplementation((request,cb)=>{reply=cb;});
 const view=render(<OutboxReview/>);fireEvent.click(screen.getByText("미전송 항목 확인"));view.unmount();
 act(()=>reply({success:true,data:{items:[],more:false}}));
 expect(screen.queryByText(/미전송 항목이 없습니다/)).not.toBeInTheDocument();
});
