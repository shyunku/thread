import {fireEvent,render,screen} from "@testing-library/react";
import VaultRegistration from "./VaultRegistration";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({vault:{registrationEndpoint:jest.fn(),registerIdentity:jest.fn()}}));
test("registration requires explicit endpoint acknowledgement and distinguishes existing vault",async()=>{
 IpcSender.vault.registrationEndpoint.mockImplementation(cb=>cb({success:true,data:"http://localhost:4033"}));
 IpcSender.vault.registerIdentity.mockImplementation(cb=>cb({success:true,data:{phase:"PAIRING_REQUIRED"}}));
 render(<VaultRegistration/>);const button=screen.getByRole("button",{name:"서버 등록·연결 확인"});
 expect(button).toBeDisabled();expect(IpcSender.vault.registerIdentity).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(button);
 expect(await screen.findByText(/기존 보관함이 있습니다/)).toBeInTheDocument();
 expect(IpcSender.vault.registerIdentity).toHaveBeenCalledTimes(1);
});
