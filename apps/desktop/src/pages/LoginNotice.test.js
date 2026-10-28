import { act, fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import accountReducer, { setAccount, setAuth } from "../store/accountSlice";
import IpcSender from "../utils/IpcSender";
import { clearLoginNotice, peekLoginNotice, setLoginNotice } from "../utils/loginNotice";
import Login from "./Login";
import AuthRouter from "../routers/AuthRouter";

jest.mock("../utils/IpcSender", () => {
  const listeners = {};
  return {
    __listeners: listeners,
    req: { system: { setAsLoginWindow: jest.fn() } },
    system: { minimizeWindow: jest.fn(), closeWindow: jest.fn() },
    // Plain functions: CRA's resetMocks would clear jest.fn implementations between tests.
    onAll: (topic, callback) => { listeners[topic] = callback; return callback; },
    off: (topic) => { delete listeners[topic]; },
  };
});
jest.mock("../thunks/AuthThunk", () => ({ pingTest: jest.fn() }));
jest.mock("../thunks/ThunkUtil", () => ({ getAppServerEndpoint: () => "https://api.fixture.invalid" }));

const store = () => configureStore({ reducer: { account: accountReducer } });

afterEach(() => clearLoginNotice());

test("the login screen says the account was deleted, once, and the line can be closed", () => {
  setLoginNotice("deleted");
  const { unmount } = render(<Provider store={store()}><MemoryRouter><Login /></MemoryRouter></Provider>);
  expect(screen.getByRole("status")).toHaveTextContent("계정을 삭제했어요");
  expect(peekLoginNotice()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(screen.queryByRole("status")).toBeNull();
  unmount();
  render(<Provider store={store()}><MemoryRouter><Login /></MemoryRouter></Provider>);
  expect(screen.queryByText("계정을 삭제했어요")).toBeNull();
});

test("a deletion on another device signs this PC out to the login screen with its own line", async () => {
  const s = store();
  s.dispatch(setAccount({ uid: "u1", username: "Jo" }));
  s.dispatch(setAuth({ accessToken: "a", refreshToken: "r" }));
  render(
    <Provider store={s}>
      <MemoryRouter initialEntries={["/home"]}>
        <Routes>
          <Route element={<AuthRouter />}><Route path="/home" element={<div>home</div>} /></Route>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  expect(screen.getByText("home")).toBeInTheDocument();
  // Another account's event is ignored.
  await act(async () => { IpcSender.__listeners["auth/accountDeleted"]({ success: true, data: { uid: "other" } }); });
  expect(screen.getByText("home")).toBeInTheDocument();
  await act(async () => { IpcSender.__listeners["auth/accountDeleted"]({ success: true, data: { uid: "u1" } }); });
  expect(s.getState().account.auth.accessToken).toBeNull();
  expect(s.getState().account.account.uid).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("계정이 삭제됐어요");
});
