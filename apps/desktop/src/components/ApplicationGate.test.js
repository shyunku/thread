import {act,fireEvent,render,screen} from "@testing-library/react";
import ApplicationGate from "./ApplicationGate";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({onAll:jest.fn(),off:jest.fn(),vault:{bootstrap:jest.fn(),status:jest.fn(),unlock:jest.fn()}}));
jest.mock("./VaultWorkspace",()=>()=> <p>Setup panel</p>);
let notify;
beforeEach(()=>{
 jest.clearAllMocks();IpcSender.onAll.mockImplementation((topic,cb)=>{notify=cb;return cb;});
 IpcSender.vault.status.mockImplementation(cb=>cb({success:true,data:{osAvailable:true,passwordAvailable:true}}));
});
test("normal app mounts only after bootstrap and unmounts on lock until unlock",async()=>{
 IpcSender.vault.bootstrap.mockImplementationOnce((uid,cb)=>cb({success:true,data:{mode:"E2EE"}}))
  .mockImplementationOnce((uid,cb)=>cb({success:true,data:{mode:"LOCKED"}}))
  .mockImplementationOnce((uid,cb)=>cb({success:true,data:{mode:"E2EE"}}));
 IpcSender.vault.unlock.mockImplementation((method,password,cb)=>cb({success:true,data:{}}));
 render(<ApplicationGate uid="u"><p>Private application</p></ApplicationGate>);
 expect(await screen.findByText("Private application")).toBeInTheDocument();
 act(()=>notify({data:{uid:"u",phase:"LOCKED"}}));
 expect(screen.queryByText("Private application")).not.toBeInTheDocument();
 fireEvent.click(await screen.findByText("OS 인증으로 잠금 해제"));
 expect(await screen.findByText("Private application")).toBeInTheDocument();
});
test("mode failure does not mount legacy app and retry can recover",async()=>{
 IpcSender.vault.bootstrap.mockImplementationOnce((uid,cb)=>cb({success:false}))
  .mockImplementationOnce((uid,cb)=>cb({success:true,data:{mode:"LEGACY"}}));
 render(<ApplicationGate uid="u"><p>Legacy application</p></ApplicationGate>);
 expect(await screen.findByRole("alert")).toBeInTheDocument();expect(screen.queryByText("Legacy application")).not.toBeInTheDocument();
 fireEvent.click(screen.getByText("저장소 다시 확인"));expect(await screen.findByText("Legacy application")).toBeInTheDocument();
});
test("late bootstrap for old account never renders its app",async()=>{
 let finish;IpcSender.vault.bootstrap.mockImplementationOnce((uid,cb)=>{finish=cb;})
  .mockImplementationOnce((uid,cb)=>cb({success:true,data:{mode:"SETUP_REQUIRED"}}));
 const view=render(<ApplicationGate uid="u"><p>App</p></ApplicationGate>);
 view.rerender(<ApplicationGate uid="other"><p>App</p></ApplicationGate>);
 expect(await screen.findByText("Setup panel")).toBeInTheDocument();
 act(()=>finish({success:true,data:{mode:"E2EE"}}));expect(screen.queryByText("App")).not.toBeInTheDocument();
});

test.each(["LOCKED","ERROR","RECOVERY_REQUIRED","SETUP_REQUIRED","MIGRATION_REQUIRED"])("%s keeps retry inside the same card without mounting the app",async mode=>{
 IpcSender.vault.bootstrap.mockImplementation((uid,cb)=>cb({success:true,data:{mode}}));
 render(<ApplicationGate uid="u"><p>Private application</p></ApplicationGate>);
 const retry=await screen.findByRole("button",{name:"저장소 다시 확인"});
 expect(retry.closest(".application-gate__card")).toContainElement(screen.getByRole("heading",{level:1}));
 expect(screen.queryByText("Private application")).not.toBeInTheDocument();
});
