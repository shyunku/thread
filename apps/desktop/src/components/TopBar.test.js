import {act,fireEvent,render,screen} from "@testing-library/react";
import TopBar from "./TopBar";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({
 onAll:jest.fn(),off:jest.fn(),releaseAlerts:{get:jest.fn()},
 system:{isMaximizable:jest.fn(),minimizeWindow:jest.fn(),maximizeWindow:jest.fn(),restoreWindow:jest.fn(),closeWindow:jest.fn()}
}));
test("update indicator appears beside version and opens the notice",()=>{
 const listeners={};
 IpcSender.onAll.mockImplementation((topic,receive)=>{listeners[topic]=receive;return receive;});
 IpcSender.releaseAlerts.get.mockImplementation(receive=>receive({success:true,data:null}));
 const open=jest.fn();window.addEventListener("thread:open-update",open);
 const view=render(<TopBar/>);
 expect(screen.queryByRole("button",{name:/업데이트 다운로드 가능/})).toBeNull();
 act(()=>listeners["release-alert/available"]({success:true,data:{version:"2.0.0",status:"available"}}));
 const button=screen.getByRole("button",{name:/업데이트 다운로드 가능/});
 expect(button.nextElementSibling).toHaveClass("build-label");
 expect(button).toHaveTextContent("업데이트");
 act(()=>listeners["release-alert/available"]({success:true,data:{version:"2.0.0",status:"ready"}}));
 expect(screen.getByRole("button",{name:/설치 준비 완료/})).toHaveTextContent("업데이트 설치");
 fireEvent.click(button);expect(open).toHaveBeenCalledTimes(1);
 view.unmount();window.removeEventListener("thread:open-update",open);
});
