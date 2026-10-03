import { act, fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import accountReducer, { setAccount } from "../../store/accountSlice";
import IpcSender from "../../utils/IpcSender";
import DeviceConnect from "./DeviceConnect";

jest.mock("../../utils/IpcSender", () => ({ req: { auth: { deleteAuthInfoSync: jest.fn() } }, vault: {} }));
jest.mock("../DevicePairing", () => () => <p>QR file pairing</p>);

const calls = [];
const reply = (name, value) => (...args) => {
  const cb = args.pop();
  calls.push([name, ...args]);
  const data = typeof value === "function" ? value(...args) : value;
  cb(data instanceof Error ? { success: false, data: { code: data.message } } : { success: true, data });
};
const click = async (name) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };

function renderConnect(props = {}) {
  const store = configureStore({ reducer: { account: accountReducer } });
  store.dispatch(setAccount({ uid: "u1", username: "shyunku" }));
  const onConnected = jest.fn();
  const view = render(<Provider store={store}><DeviceConnect onConnected={onConnected} {...props} /></Provider>);
  return { ...view, store, onConnected };
}

beforeEach(() => {
  calls.length = 0;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

test("start offers the existing-device and recovery paths for the signed-in account", async () => {
  IpcSender.vault = { status: reply("status", { phase: "ABSENT", osAvailable: true }) };
  await act(async () => { renderConnect(); });
  expect(screen.getByRole("heading", { name: "이 기기에서 데이터 열기" })).toBeInTheDocument();
  expect(screen.getByText("shyunku · 로그인됨")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /쓰던 기기로 연결/ })).toBeEnabled();
  expect(screen.getByRole("button", { name: /복구 코드로 연결/ })).toBeEnabled();
});

test("connecting through an existing device: lock, wait, compare, confirm, done", async () => {
  const phases = [{ phase: "WAITING" }, { phase: "CONNECTING" }, { phase: "COMPARE", code: "482913", expiresAt: Date.now() + 540000 }];
  IpcSender.vault = {
    status: reply("status", { phase: "ABSENT", osAvailable: true }),
    create: reply("create", { phase: "UNLOCKED" }),
    relay: reply("relay", (action) => {
      if (action === "recipientPoll") return phases.length > 1 ? phases.shift() : phases[0];
      if (action === "recipientConfirm") { phases.splice(0, phases.length, { phase: "PAIRED" }); return { phase: "APPROVAL", code: "482913" }; }
      return { phase: "CANCELLED" };
    }),
  };
  const { onConnected } = renderConnect();
  await act(async () => {});
  await click(/쓰던 기기로 연결/);
  expect(screen.getByRole("heading", { name: "이 기기의 잠금 방법" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /Windows Hello \+ 비밀번호/ })).toHaveAttribute("aria-checked", "false");
  await click("Windows Hello로 설정");
  expect(calls).toContainEqual(["create", { method: "os" }]);
  expect(screen.getByRole("heading", { name: "쓰던 기기에서 열어 주세요" })).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(screen.getByText("쓰던 기기와 연결하는 중…")).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(screen.getByText("482 913")).toBeInTheDocument();
  await click("같아요");
  expect(screen.getByRole("heading", { name: "쓰던 기기에서 승인해 주세요" })).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(screen.getByRole("heading", { name: "이 기기가 연결됐어요" })).toBeInTheDocument();
  await click("시작하기");
  expect(onConnected).toHaveBeenCalled();
});

test("a different code stops the connection and offers a retry", async () => {
  IpcSender.vault = {
    status: reply("status", { phase: "UNLOCKED", osAvailable: true }),
    relay: reply("relay", (action) => (action === "recipientPoll" ? { phase: "COMPARE", code: "111222" } : action === "recipientReject" ? { phase: "MISMATCH" } : { phase: "CANCELLED" })),
  };
  renderConnect();
  await act(async () => {});
  await click(/쓰던 기기로 연결/);
  await act(async () => {});
  await click("다른 숫자예요");
  expect(screen.getByRole("heading", { name: "연결을 멈췄어요" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
});

test("recovery asks for consent before anything happens", async () => {
  IpcSender.vault = {
    status: reply("status", { phase: "UNLOCKED", osAvailable: true }),
    lostRecovery: reply("lostRecovery", (action) => (action === "status" ? null : { phase: "RECOVERY_UNCONFIRMED" })),
  };
  renderConnect();
  await act(async () => {});
  await click(/복구 코드로 연결/);
  expect(screen.getByRole("heading", { name: "쓰던 기기를 모두 잃었나요?" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: /다른 기기의 연결을 모두 해제할게요/ })); });
  await click("다음");
  expect(screen.getByRole("heading", { name: "복구 자료 입력" })).toBeInTheDocument();
  expect(calls.filter(([name, action]) => name === "lostRecovery" && action !== "status")).toEqual([]);
});

test("signing in with another account clears this device's login", async () => {
  IpcSender.vault = { status: reply("status", { phase: "ABSENT", osAvailable: false }) };
  IpcSender.req.auth.deleteAuthInfoSync.mockResolvedValue(true);
  const { store } = renderConnect();
  await act(async () => {});
  await click("다른 계정으로 로그인");
  expect(IpcSender.req.auth.deleteAuthInfoSync).toHaveBeenCalledWith("u1");
  expect(store.getState().account.account.uid).toBeFalsy();
});
