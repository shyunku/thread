import {fireEvent,render,screen} from "@testing-library/react";
import VaultRegistration from "./VaultRegistration";
import IpcSender from "../utils/IpcSender";
jest.mock("../utils/IpcSender",()=>({vault:{registrationEndpoint:jest.fn(),registerIdentity:jest.fn()}}));
test("registration waits for endpoint and distinguishes existing vault",async()=>{
 IpcSender.vault.registrationEndpoint.mockImplementation(cb=>cb({success:true,data:"http://localhost:4033"}));
 IpcSender.vault.registerIdentity.mockImplementation(cb=>cb({success:true,data:{phase:"PAIRING_REQUIRED"}}));
 render(<VaultRegistration/>);const button=screen.getByRole("button",{name:"등록 확인"});
 expect(screen.queryByText(/대상 서버:/)).not.toBeInTheDocument();
 fireEvent.click(button);
 expect(await screen.findByText(/이미 연결된 데이터가 있어요/)).toBeInTheDocument();
 expect(IpcSender.vault.registerIdentity).toHaveBeenCalledTimes(1);
});
