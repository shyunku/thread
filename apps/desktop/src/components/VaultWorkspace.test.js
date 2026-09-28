import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import VaultWorkspace from "./VaultWorkspace";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({onAll:jest.fn(),off:jest.fn(),vault:{status:jest.fn(),unlock:jest.fn(),intakes:jest.fn(),lock:jest.fn()}}));
let notify;
beforeEach(()=>{
 jest.clearAllMocks();IpcSender.onAll.mockImplementation((topic,callback)=>{notify=callback;return callback;});
 IpcSender.vault.status.mockImplementation(callback=>callback({success:true,data:{enabled:true,uid:"user",phase:"LOCKED",osAvailable:true,passwordAvailable:true,generation:1}}));
 IpcSender.vault.intakes.mockImplementation(callback=>callback({success:true,data:[]}));
});
test("real panel connects unlock and clears state on lock notification",async()=>{
 IpcSender.vault.unlock.mockImplementation((method,password,callback)=>callback({success:true,data:{enabled:true,uid:"user",phase:"UNLOCKED",generation:1}}));
 render(<VaultWorkspace uid="user"/>);
 fireEvent.click(await screen.findByRole("button",{name:"Windows Hello / Touch ID로 열기"}));
 expect(await screen.findByText(/데이터 잠금 해제됨/)).toBeInTheDocument();
 act(()=>notify({data:{uid:"user",phase:"LOCKED",generation:2}}));
 expect(screen.queryByText(/데이터 잠금 해제됨/)).not.toBeInTheDocument();
});
test("late unlock response after lock is not rendered",async()=>{
 let finish;IpcSender.vault.unlock.mockImplementation((method,password,callback)=>{finish=callback;});
 render(<VaultWorkspace uid="user"/>);
 fireEvent.click(await screen.findByRole("button",{name:"Windows Hello / Touch ID로 열기"}));
 act(()=>notify({data:{uid:"user",phase:"LOCKED",generation:2}}));
 await act(async()=>finish({success:true,data:{uid:"user",phase:"UNLOCKED"}}));
 expect(screen.queryByText(/데이터 잠금 해제됨/)).not.toBeInTheDocument();
 expect(IpcSender.vault.intakes).not.toHaveBeenCalled();
});
test("manual lock notifies its owner so the settings modal can close",async()=>{
 const onLocked=jest.fn();
 IpcSender.vault.unlock.mockImplementation((method,password,callback)=>callback({success:true,data:{enabled:true,uid:"user",phase:"UNLOCKED",generation:1}}));
 IpcSender.vault.lock.mockImplementation(callback=>callback({success:true,data:true}));
 render(<VaultWorkspace uid="user" onLocked={onLocked}/>);
 fireEvent.click(await screen.findByRole("button",{name:"Windows Hello / Touch ID로 열기"}));
 fireEvent.click(await screen.findByRole("button",{name:"데이터 잠그기"}));
 await waitFor(()=>expect(onLocked).toHaveBeenCalledTimes(1));
});
