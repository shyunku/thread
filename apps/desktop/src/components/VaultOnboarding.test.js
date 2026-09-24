import {fireEvent,render,screen} from "@testing-library/react";
import VaultOnboarding from "./VaultOnboarding";
jest.mock("./RecoverySetup",()=>({onRegistered})=><button onClick={onRegistered}>등록 검증 완료</button>);
jest.mock("./MigrationPanel",()=>()=> <p>이관 동의 화면</p>);
jest.mock("./DevicePairing",()=>()=> <p>기기 연결 화면</p>);
jest.mock("./LostRecoveryPanel",()=>()=> <p>분실 복구 화면</p>);
jest.mock("./NewAccountActivation",()=>()=> <p>빈 v3 시작 화면</p>);
test("migration is shown only after registration has verified recovery",()=>{
 render(<VaultOnboarding/>);
 expect(screen.queryByText("이관 동의 화면")).not.toBeInTheDocument();
 fireEvent.click(screen.getByText("등록 검증 완료"));
 expect(screen.getByText("이관 동의 화면")).toBeInTheDocument();
 expect(screen.queryByText("등록 검증 완료")).not.toBeInTheDocument();
});
test("new v3 account skips v2 migration after registration",()=>{
 render(<VaultOnboarding newAccount/>);
 fireEvent.click(screen.getByText("등록 검증 완료"));
 expect(screen.getByText("빈 v3 시작 화면")).toBeInTheDocument();
 expect(screen.queryByText("이관 동의 화면")).not.toBeInTheDocument();
});
test("an existing v3 account connects without new owner setup",()=>{
 render(<VaultOnboarding connectionOnly/>);
 expect(screen.getByText("기기 연결 화면")).toBeInTheDocument();
 expect(screen.queryByText("등록 검증 완료")).not.toBeInTheDocument();
 expect(screen.queryByText("이관 동의 화면")).not.toBeInTheDocument();
});
test("reports the current step for the progress bar",()=>{
 const onStepChange=jest.fn();
 render(<VaultOnboarding onStepChange={onStepChange}/>);
 expect(onStepChange).toHaveBeenLastCalledWith("recovery");
 fireEvent.click(screen.getByText("등록 검증 완료"));
 expect(onStepChange).toHaveBeenLastCalledWith("migration");
});
