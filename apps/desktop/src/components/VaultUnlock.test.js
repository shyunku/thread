import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import VaultUnlock from "./VaultUnlock";
test("password can unlock directly without selecting a method first",async()=>{
 const os=jest.fn().mockResolvedValue(true),password=jest.fn().mockResolvedValue(true),done=jest.fn();
 render(<VaultUnlock osAvailable onOSUnlock={os} onPasswordUnlock={password} onUnlocked={done}/>);
 expect(screen.getByRole("button",{name:"Windows Hello / Touch ID로 열기"})).toBeInTheDocument();
 const input=screen.getByLabelText("데이터 잠금 비밀번호");
 fireEvent.change(input,{target:{value:"synthetic password"}});
 fireEvent.click(screen.getByRole("button",{name:"비밀번호로 열기"}));
 await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));
 expect(password).toHaveBeenCalledWith("synthetic password");
 expect(os).not.toHaveBeenCalled();expect(input.value).toBe("");
});
test("OS cancel does not unlock or automatically try the password",async()=>{
 const done=jest.fn(),password=jest.fn();
 render(<VaultUnlock osAvailable onOSUnlock={()=>Promise.reject(Error("cancel"))} onPasswordUnlock={password} onUnlocked={done}/>);
 fireEvent.click(screen.getByRole("button",{name:"Windows Hello / Touch ID로 열기"}));
 await screen.findByRole("alert");expect(done).not.toHaveBeenCalled();expect(password).not.toHaveBeenCalled();
});
test("setup explains the separate purpose and rejects mismatch",async()=>{
 const create=jest.fn();
 render(<VaultUnlock setup onCreate={create}/>);
 expect(screen.getByText(/로그인 비밀번호와는 별개/)).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText(/데이터 잠금 비밀번호 \(/),{target:{value:"synthetic password"}});
 fireEvent.change(screen.getByLabelText("비밀번호 확인"),{target:{value:"different"}});
 fireEvent.click(screen.getByRole("button",{name:"비밀번호 설정"}));
 expect(create).not.toHaveBeenCalled();expect(screen.getByRole("alert")).toBeInTheDocument();
});
test("OS-only setup does not request a password",async()=>{
 const create=jest.fn().mockResolvedValue(true),done=jest.fn();
 render(<VaultUnlock setup osAvailable onCreate={create} onUnlocked={done}/>);
 expect(screen.queryByLabelText("비밀번호 확인")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Windows Hello / Touch ID만"}));
 fireEvent.click(screen.getByRole("button",{name:"OS 인증으로 설정"}));
 await waitFor(()=>expect(create).toHaveBeenCalledWith({method:"os"}));
 await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));
});
test("an unverified response never signals unlock",async()=>{
 const done=jest.fn();
 render(<VaultUnlock osAvailable onOSUnlock={async()=>false} onUnlocked={done}/>);
 fireEvent.click(screen.getByRole("button",{name:"Windows Hello / Touch ID로 열기"}));
 await screen.findByRole("alert");expect(done).not.toHaveBeenCalled();
});
test("missing OS and password methods show recovery guidance instead of an empty action area",()=>{
 render(<VaultUnlock osAvailable={false} passwordAvailable={false}/>);
 expect(screen.getByRole("alert")).toHaveTextContent("복구가 필요합니다");
 expect(screen.queryByRole("button",{name:/열기/})).not.toBeInTheDocument();
});
