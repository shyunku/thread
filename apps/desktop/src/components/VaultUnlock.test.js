import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import VaultUnlock from "./VaultUnlock";
test("OS auth is the default, but password remains selectable",async()=>{
 const os=jest.fn().mockResolvedValue(true),password=jest.fn().mockResolvedValue(true),done=jest.fn();
 render(<VaultUnlock osAvailable onOSUnlock={os} onPasswordUnlock={password} onUnlocked={done}/>);
 expect(screen.queryByLabelText("보관함 비밀번호")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"보관함 비밀번호",exact:true}));
 const input=screen.getByLabelText("보관함 비밀번호");
 fireEvent.change(input,{target:{value:"synthetic password"}});
 fireEvent.click(screen.getByRole("button",{name:"비밀번호로 잠금 해제"}));
 await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));
 expect(password).toHaveBeenCalledWith("synthetic password");
 expect(os).not.toHaveBeenCalled();expect(input.value).toBe("");
});
test("OS cancel does not unlock or automatically try the password",async()=>{
 const done=jest.fn(),password=jest.fn();
 render(<VaultUnlock osAvailable onOSUnlock={()=>Promise.reject(Error("cancel"))} onPasswordUnlock={password} onUnlocked={done}/>);
 fireEvent.click(screen.getByRole("button",{name:"OS 인증으로 잠금 해제"}));
 await screen.findByRole("alert");expect(done).not.toHaveBeenCalled();expect(password).not.toHaveBeenCalled();
});
test("setup explains the separate purpose and rejects mismatch",async()=>{
 const create=jest.fn();
 render(<VaultUnlock setup onCreate={create}/>);
 expect(screen.getByText(/로그인 비밀번호와 별개/)).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText(/보관함 비밀번호 \(/),{target:{value:"synthetic password"}});
 fireEvent.change(screen.getByLabelText("비밀번호 확인"),{target:{value:"different"}});
 fireEvent.click(screen.getByRole("button",{name:"비밀번호 설정"}));
 expect(create).not.toHaveBeenCalled();expect(screen.getByRole("alert")).toBeInTheDocument();
});
test("an unverified response never signals unlock",async()=>{
 const done=jest.fn();
 render(<VaultUnlock osAvailable onOSUnlock={async()=>false} onUnlocked={done}/>);
 fireEvent.click(screen.getByRole("button",{name:"OS 인증으로 잠금 해제"}));
 await screen.findByRole("alert");expect(done).not.toHaveBeenCalled();
});
