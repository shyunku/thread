import {act,render,screen} from "@testing-library/react";
import LegacyRecovery from "./LegacyRecovery";
const page={total:1,next:null,items:[{changeId:"one",reason:"FIELD_CONFLICT",original:{title:"base"},local:{title:"PRIVATE_LOCAL"},remote:{title:"remote"},deleted:false}]};
test("shows three versions without sending or deleting changes and clears on lock",async()=>{
 const load=jest.fn().mockResolvedValue(page);
 const {rerender}=render(<LegacyRecovery sessionKey="a" intakeId="id" unlocked loadPage={load}/>);
 expect(await screen.findByRole("heading",{name:"PRIVATE_LOCAL"})).toBeInTheDocument();
 expect(screen.getByText("원래 내용")).toBeInTheDocument();
 rerender(<LegacyRecovery sessionKey="a" intakeId="id" unlocked={false} loadPage={load}/>);
 expect(screen.queryByRole("heading",{name:"PRIVATE_LOCAL"})).not.toBeInTheDocument();
 expect(load).toHaveBeenCalledTimes(1);
});
test("late response from a previous account never appears",async()=>{
 let finish;const load=jest.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({items:[],total:0,next:null});
 const {rerender}=render(<LegacyRecovery sessionKey="a" intakeId="id" unlocked loadPage={load}/>);
 await act(async()=>{});
 rerender(<LegacyRecovery sessionKey="b" intakeId="other" unlocked loadPage={load}/>);
 await act(async()=>{finish(page);});
 expect(screen.queryByRole("heading",{name:"PRIVATE_LOCAL"})).not.toBeInTheDocument();
 expect(await screen.findByText("검토할 변경 0개")).toBeInTheDocument();
});
