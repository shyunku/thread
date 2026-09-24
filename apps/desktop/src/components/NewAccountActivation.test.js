import {fireEvent,render,screen} from "@testing-library/react";
import NewAccountActivation from "./NewAccountActivation";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({vault:{activateEmpty:jest.fn()}}));

test("new v3 account starts only after an explicit click",()=>{
 const onContinue=jest.fn();
 IpcSender.vault.activateEmpty.mockImplementation(callback=>callback({success:true,data:{phase:"ACTIVE"}}));
 render(<NewAccountActivation onContinue={onContinue}/>);
 expect(IpcSender.vault.activateEmpty).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"시작하기"}));
 expect(IpcSender.vault.activateEmpty).toHaveBeenCalledTimes(1);
 expect(onContinue).toHaveBeenCalledTimes(1);
});

test("activation failure remains on setup rather than entering home",()=>{
 const onContinue=jest.fn();
 IpcSender.vault.activateEmpty.mockImplementation(callback=>callback({success:false}));
 render(<NewAccountActivation onContinue={onContinue}/>);
 fireEvent.click(screen.getByRole("button",{name:"시작하기"}));
 expect(screen.getByRole("alert")).toBeInTheDocument();
 expect(onContinue).not.toHaveBeenCalled();
});
