import {act,render,screen} from "@testing-library/react";
import QRCode from "qrcode";
import PairingQR from "./PairingQR";
jest.mock("qrcode",()=>({toDataURL:jest.fn()}));
test("QR expires visibly and a late render cannot show expired data",async()=>{
 jest.useFakeTimers();let finish;
 QRCode.toDataURL.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<PairingQR request={{qr:"thread-pair:v1:fixture",expiresAt:Date.now()+1000}}/>);
 act(()=>jest.advanceTimersByTime(1001));
 await act(async()=>finish("data:image/png;base64,fixture"));
 expect(screen.queryByRole("img")).not.toBeInTheDocument();
 expect(screen.getByText(/만료됐습니다/)).toBeInTheDocument();
 view.unmount();jest.useRealTimers();
});
