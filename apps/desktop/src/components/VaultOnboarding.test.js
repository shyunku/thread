import {fireEvent,render,screen} from "@testing-library/react";
import VaultOnboarding from "./VaultOnboarding";
jest.mock("./RecoverySetup",()=>({onRegistered})=><button onClick={onRegistered}>등록 검증 완료</button>);
jest.mock("./NewAccountActivation",()=>()=> <p>빈 v3 시작 화면</p>);
test("a new account starts the empty vault only after registration has verified recovery",()=>{
 render(<VaultOnboarding/>);
 expect(screen.queryByText("빈 v3 시작 화면")).not.toBeInTheDocument();
 fireEvent.click(screen.getByText("등록 검증 완료"));
 expect(screen.getByText("빈 v3 시작 화면")).toBeInTheDocument();
 expect(screen.queryByText("등록 검증 완료")).not.toBeInTheDocument();
});
test("reports the current step for the progress bar",()=>{
 const onStepChange=jest.fn();
 render(<VaultOnboarding onStepChange={onStepChange}/>);
 expect(onStepChange).toHaveBeenLastCalledWith("recovery");
 fireEvent.click(screen.getByText("등록 검증 완료"));
 expect(onStepChange).toHaveBeenLastCalledWith("activate");
});
