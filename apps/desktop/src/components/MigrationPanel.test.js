import {act,fireEvent,render,screen} from "@testing-library/react";
import MigrationPanel from "./MigrationPanel";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({vault:{migrationStatus:jest.fn(),migration:jest.fn()}}));
beforeEach(()=>{
 jest.clearAllMocks();
 IpcSender.vault.migrationStatus.mockImplementation(cb=>cb({success:true,data:{phase:"NOT_STARTED",busy:false}}));
});
test("never migrates on mount and requires new explicit consent for each stage",async()=>{
 IpcSender.vault.migration.mockImplementation((action,input,cb)=>cb({success:true,data:{phase:action==="prepare"?"FROZEN":"ACTIVE"}}));
 const next=jest.fn();render(<MigrationPanel osAvailable onContinue={next}/>);
 const prepare=await screen.findByText("기존 데이터 확인");
 expect(prepare).toBeDisabled();expect(IpcSender.vault.migration).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(prepare);
 const transfer=await screen.findByText("데이터 이동·이어하기");
 expect(transfer).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(transfer);
 fireEvent.click(await screen.findByText("Thread 시작하기"));expect(next).toHaveBeenCalledTimes(1);
 expect(IpcSender.vault.migration).toHaveBeenNthCalledWith(1,"prepare",expect.objectContaining({confirmed:true,method:"os"}),expect.any(Function));
});
test("cancelled attempt requires consent to restart and separate consent to freeze again",async()=>{
 IpcSender.vault.migrationStatus.mockImplementation(cb=>cb({success:true,data:{phase:"CANCELLED",busy:false}}));
 IpcSender.vault.migration.mockImplementation((action,input,cb)=>cb({success:true,data:{phase:"PREPARING"}}));
 render(<MigrationPanel osAvailable/>);
 const restart=await screen.findByText("다시 시작");expect(restart).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(restart);
 expect(await screen.findByText("기존 데이터 확인")).toBeDisabled();
 expect(IpcSender.vault.migration).toHaveBeenCalledTimes(1);
 expect(IpcSender.vault.migration).toHaveBeenCalledWith("restart",expect.objectContaining({confirmed:true,method:"os"}),expect.any(Function));
});
test("late response after unmount does not continue or expose a result",async()=>{
 let done;IpcSender.vault.migration.mockImplementation((action,input,cb)=>{done=cb;});
 const next=jest.fn(),view=render(<MigrationPanel osAvailable onContinue={next}/>);
 await screen.findByText("기존 데이터 확인");fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByText("기존 데이터 확인"));
 view.unmount();await act(async()=>done({success:true,data:{phase:"ACTIVE"}}));expect(next).not.toHaveBeenCalled();
});
