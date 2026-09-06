import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSelector } from "react-redux";
import SettingData from "./Data.settings";
import IpcSender from "../../utils/IpcSender";

jest.mock("react-redux", () => ({ useSelector: jest.fn() }));
jest.mock("../../utils/IpcSender", () => ({
  onAll: jest.fn(), off: jest.fn(),
  syncV2: { getStatus: jest.fn(), retry: jest.fn() },
}));

let listener;
beforeEach(() => {
  jest.clearAllMocks();
  useSelector.mockReturnValue({ uid: "fixture" });
  IpcSender.onAll.mockImplementation((topic, fn) => { listener = fn; return fn; });
  IpcSender.syncV2.getStatus.mockImplementation((fn) => fn({
    success: true, data: { uid: "fixture", connected: true, pending: 0, seq: "1", canSync: true },
  }));
});
const emit = (data) => act(() => listener({ success: true, data: { uid: "fixture", ...data } }));

test("loads current v2 state and updates pending changes and applied sequence", () => {
  const { unmount } = render(<SettingData />);
  expect(screen.getByRole("status")).toHaveTextContent("마지막 반영 번호: 1");
  emit({ connected: false, pending: 1, seq: "1", canSync: true });
  expect(screen.getByRole("status")).toHaveTextContent("오프라인");
  expect(screen.getByRole("status")).toHaveTextContent("미전송 변경: 1개");
  emit({ connected: true, pending: 0, seq: "9007199254740993", canSync: true });
  expect(screen.getByRole("status")).toHaveTextContent("마지막 반영 번호: 9007199254740993");
  expect(screen.getByRole("status")).toHaveTextContent("미전송 변경: 0개");
  unmount();
  expect(IpcSender.off).toHaveBeenCalledWith("sync-v2/status", listener);
});

test("ignores other accounts and stale initial response after a live update", () => {
  let initial;
  IpcSender.syncV2.getStatus.mockImplementation((fn) => { initial = fn; });
  render(<SettingData />);
  emit({ seq: "5", pending: 0 });
  emit({ uid: "someone-else", seq: "99" });
  act(() => initial({ success: true, data: { uid: "fixture", seq: "1" } }));
  expect(screen.getByRole("status")).toHaveTextContent("마지막 반영 번호: 5");
});

test("retries through v2 without a destructive initialization prompt", () => {
  IpcSender.syncV2.retry.mockImplementation((fn) => fn({ success: true }));
  render(<SettingData />);
  fireEvent.click(screen.getByRole("button", { name: "다시 동기화" }));
  expect(IpcSender.syncV2.retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("전체 초기화")).not.toBeInTheDocument();
});

test("disables retry before a session exists and shows unavailable state", () => {
  IpcSender.syncV2.getStatus.mockImplementation((fn) => fn({
    success: true, data: { uid: "fixture", pending: null, seq: null, canSync: false },
  }));
  render(<SettingData />);
  expect(screen.getByRole("status")).toHaveTextContent("마지막 반영 번호: —");
  expect(screen.getByRole("button", { name: "다시 동기화" })).toBeDisabled();
});
