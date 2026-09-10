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
 const prepare=await screen.findByText("원본 준비·재확인");
 expect(prepare).toBeDisabled();expect(IpcSender.vault.migration).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(prepare);
 const transfer=await screen.findByText("암호화 전환·재개");
 expect(transfer).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(transfer);
 fireEvent.click(await screen.findByText("저장소 다시 확인"));expect(next).toHaveBeenCalledTimes(1);
 expect(IpcSender.vault.migration).toHaveBeenNthCalledWith(1,"prepare",expect.objectContaining({confirmed:true,method:"os"}),expect.any(Function));
});
test("late response after unmount does not continue or expose a result",async()=>{
 let done;IpcSender.vault.migration.mockImplementation((action,input,cb)=>{done=cb;});
 const next=jest.fn(),view=render(<MigrationPanel osAvailable onContinue={next}/>);
 await screen.findByText("원본 준비·재확인");fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByText("원본 준비·재확인"));
 view.unmount();await act(async()=>done({success:true,data:{phase:"ACTIVE"}}));expect(next).not.toHaveBeenCalled();
});
