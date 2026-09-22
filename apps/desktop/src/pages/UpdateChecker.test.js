import {act,fireEvent,render,screen} from "@testing-library/react";
import UpdateChecker from "./UpdateChecker";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({onAll:jest.fn(),offAll:jest.fn(),silentSender:jest.fn()}));
const listeners={};
beforeEach(()=>{jest.clearAllMocks();IpcSender.onAll.mockImplementation((topic,cb)=>{listeners[topic]=cb;});});
test("download progress is bounded and unknown install state still has a label",()=>{
 render(<UpdateChecker/>);
 act(()=>listeners["release_download@state"]({data:{percentage:120,transferred:10,length:10}}));
 expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow","100");
 act(()=>listeners["release_install@state"]({data:"unknown"}));
 expect(screen.getByRole("status")).toHaveTextContent("업데이트를 준비하고 있어요");
});
test("warning has accessible title, focuses continuation and hides background status",()=>{
 const view=render(<UpdateChecker/>);
 act(()=>listeners["update_check@failed"]({data:{title:"확인 실패",message:"연결을 확인해주세요"}}));
 expect(screen.getByRole("dialog",{name:"확인 실패"})).toBeInTheDocument();
 expect(screen.queryByRole("status")).not.toBeInTheDocument();
 expect(screen.getByRole("button",{name:"계속"})).toHaveFocus();
 fireEvent.click(screen.getByRole("button",{name:"계속"}));
 expect(IpcSender.silentSender).toHaveBeenCalledWith("update_check@continue",true);
 view.unmount();expect(IpcSender.offAll).toHaveBeenCalledWith("update_check@failed");
});
