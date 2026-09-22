import {createRef} from "react";
import {fireEvent,render,screen} from "@testing-library/react";
import PasswordField from "./PasswordField";
test("visibility toggle keeps value and never submits the parent form",()=>{
 const ref=createRef(),submit=jest.fn(e=>e.preventDefault());
 render(<form onSubmit={submit}><label htmlFor="fixture">비밀번호</label><PasswordField id="fixture" ref={ref}/></form>);
 fireEvent.change(screen.getByLabelText("비밀번호",{selector:"input"}),{target:{value:"synthetic-only"}});
 fireEvent.click(screen.getByRole("button",{name:"비밀번호 보기"}));
 expect(ref.current.type).toBe("text");expect(ref.current.value).toBe("synthetic-only");expect(submit).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"비밀번호 숨기기"}));expect(ref.current.type).toBe("password");
});
