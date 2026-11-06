import {act,fireEvent,render,screen} from "@testing-library/react";
import ApplicationGate from "./ApplicationGate";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({onAll:jest.fn(),off:jest.fn(),vault:{bootstrap:jest.fn(),status:jest.fn(),unlock:jest.fn()}}));
jest.mock("./gate/NewAccountSetup",()=>({onContinue})=> <><h1>새 데이터 보호 설정</h1><p>Setup panel</p><button onClick={onContinue}>New account started</button></>);
jest.mock("./gate/DeviceConnect",()=>()=> <h1>Setup panel</h1>);
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
 fireEvent.click(await screen.findByRole("button",{name:"Windows Hello로 열기"}));
 expect(await screen.findByText("Private application")).toBeInTheDocument();
});
test("an already migrated account opens its home in E2EE mode after unlock",async()=>{
 IpcSender.vault.bootstrap.mockImplementationOnce((uid,cb)=>cb({success:true,data:{mode:"LOCKED"}}))
  .mockImplementationOnce((uid,cb)=>cb({success:true,data:{mode:"E2EE"}}));
 IpcSender.vault.unlock.mockImplementation((method,password,cb)=>cb({success:true,data:{}}));
 render(<ApplicationGate uid="u">{mode=><p>Home mode: {mode}</p>}</ApplicationGate>);
 expect(screen.queryByText("Home mode: E2EE")).not.toBeInTheDocument();
 fireEvent.click(await screen.findByRole("button",{name:"Windows Hello로 열기"}));
 expect(await screen.findByText("Home mode: E2EE")).toBeInTheDocument();
});
test("new v3 account requires setup and does not mount home",async()=>{
 IpcSender.vault.bootstrap.mockImplementation((uid,cb)=>cb({success:true,data:{mode:"NEW_ACCOUNT_SETUP"}}));
 const view=render(<ApplicationGate uid="u"><p>Private application</p></ApplicationGate>);
 expect(await screen.findByRole("heading",{name:"새 데이터 보호 설정"})).toBeInTheDocument();
 expect(screen.getByText("Setup panel")).toBeInTheDocument();
 // The step flow draws its own head: no gate header or notice on top of it.
 expect(screen.getAllByRole("heading",{level:1})).toHaveLength(1);
 expect(view.container.querySelector(".application-gate--flow .application-gate__header")).toBeNull();
 expect(screen.queryByText("Private application")).not.toBeInTheDocument();
});
test("a started new account checks the mode again before the app opens",async()=>{
 IpcSender.vault.bootstrap.mockImplementationOnce((uid,cb)=>cb({success:true,data:{mode:"NEW_ACCOUNT_SETUP"}}))
  .mockImplementationOnce((uid,cb)=>cb({success:true,data:{mode:"E2EE"}}));
 render(<ApplicationGate uid="u"><p>Private application</p></ApplicationGate>);
 fireEvent.click(await screen.findByRole("button",{name:"New account started"}));
 expect(await screen.findByText("Private application")).toBeInTheDocument();
 expect(IpcSender.vault.bootstrap).toHaveBeenCalledTimes(2);
});
test("mode failure does not mount app and retry can recover",async()=>{
 IpcSender.vault.bootstrap.mockImplementationOnce((uid,cb)=>cb({success:false}))
  .mockImplementationOnce((uid,cb)=>cb({success:true,data:{mode:"NEW_ACCOUNT_SETUP"}}));
 render(<ApplicationGate uid="u"><p>Private application</p></ApplicationGate>);
 expect(await screen.findByRole("alert")).toBeInTheDocument();expect(screen.queryByText("Private application")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"상태 다시 확인"}));expect(await screen.findByRole("heading",{name:"새 데이터 보호 설정"})).toBeInTheDocument();
});
test("only allowlisted diagnostics are shown instead of raw error data",async()=>{
 IpcSender.vault.bootstrap.mockImplementationOnce((uid,cb)=>cb({success:false,data:{code:"AUTH_REQUIRED"}}))
  .mockImplementationOnce((uid,cb)=>cb({success:false,data:{code:"private token fixture"}}));
 render(<ApplicationGate uid="u"><p>App</p></ApplicationGate>);
 expect(await screen.findByText("AUTH_REQUIRED")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"상태 다시 확인"}));
 expect(await screen.findByText("APPLICATION_UNAVAILABLE")).toBeInTheDocument();
 expect(screen.queryByText("private token fixture")).not.toBeInTheDocument();
});

test("late bootstrap for old account never renders its app",async()=>{
 let finish;IpcSender.vault.bootstrap.mockImplementationOnce((uid,cb)=>{finish=cb;})
  .mockImplementationOnce((uid,cb)=>cb({success:true,data:{mode:"SETUP_REQUIRED"}}));
 const view=render(<ApplicationGate uid="u"><p>App</p></ApplicationGate>);
 view.rerender(<ApplicationGate uid="other"><p>App</p></ApplicationGate>);
 expect(await screen.findByText("Setup panel")).toBeInTheDocument();
 act(()=>finish({success:true,data:{mode:"E2EE"}}));expect(screen.queryByText("App")).not.toBeInTheDocument();
});

test.each(["LOCKED","ERROR","RECOVERY_REQUIRED","SETUP_REQUIRED"])("%s only offers retry when recovery is needed",async mode=>{
 IpcSender.vault.bootstrap.mockImplementation((uid,cb)=>cb({success:true,data:{mode}}));
 render(<ApplicationGate uid="u"><p>Private application</p></ApplicationGate>);
 await screen.findByRole("heading",{level:1});
 const retry=screen.queryByRole("button",{name:"상태 다시 확인"});
 if(["ERROR","RECOVERY_REQUIRED"].includes(mode))expect((await screen.findByRole("button",{name:"상태 다시 확인"})).closest(".application-gate__card")).toContainElement(screen.getByRole("heading",{level:1}));
 else expect(retry).not.toBeInTheDocument();
 expect(screen.queryByText("Private application")).not.toBeInTheDocument();
});
test("a lock reply with extra fields still shows the plain lock screen",async()=>{
 IpcSender.vault.bootstrap.mockImplementation((uid,cb)=>cb({success:true,data:{mode:"LOCKED",migrationPending:true}}));
 render(<ApplicationGate uid="u"><p>Private application</p></ApplicationGate>);
 expect(await screen.findByRole("button",{name:"Windows Hello로 열기"})).toBeInTheDocument();
 expect(IpcSender.vault.unlock).not.toHaveBeenCalled();
});
test.each(["LEGACY","MIGRATION_REQUIRED"])("unknown bootstrap mode %s fails closed",async mode=>{
 IpcSender.vault.bootstrap.mockImplementation((uid,cb)=>cb({success:true,data:{mode}}));
 render(<ApplicationGate uid="u"><p>Private application</p></ApplicationGate>);
 expect(await screen.findByText(/기존 보호 방식으로 돌아가지는 않습니다/)).toBeInTheDocument();
 expect(screen.getByText("APPLICATION_MODE_UNAVAILABLE")).toBeInTheDocument();
 expect(screen.queryByText("Private application")).not.toBeInTheDocument();
 expect(screen.queryByRole("button",{name:/기존 방식/})).not.toBeInTheDocument();
});

test("a pending update is offered on gate screens too",async()=>{
 IpcSender.releaseAlerts={get:jest.fn(cb=>cb({success:true,data:{version:"9.9.9",status:"available",mandatory:false}}))};
 IpcSender.vault.bootstrap.mockImplementation((uid,cb)=>cb({success:true,data:{mode:"SETUP_REQUIRED"}}));
 const open=jest.fn();window.addEventListener("thread:open-update",open);
 render(<ApplicationGate uid="u"><p>App</p></ApplicationGate>);
 fireEvent.click(await screen.findByRole("button",{name:/9\.9\.9 업데이트/}));
 expect(open).toHaveBeenCalled();
 window.removeEventListener("thread:open-update",open);delete IpcSender.releaseAlerts;
});
