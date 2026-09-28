import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSelector } from "react-redux";
import SettingData from "./Data.settings";
import IpcSender from "../../utils/IpcSender";

jest.mock("react-redux", () => ({ useSelector: jest.fn() }));
jest.mock("../../components/VaultWorkspace", () => () => <nav aria-label="데이터 관리 작업" />);
jest.mock("../../utils/IpcSender", () => ({
  onAll: jest.fn(), off: jest.fn(),
  syncV2: { getStatus: jest.fn(), retry: jest.fn() },
}));

let listener;
test("shows recovery count without a redundant protection card", () => {
  render(<SettingData />);
  emit({protocolVersion:3,connected:true,pending:0,seq:"8",recovery:2,canSync:true});
  expect(screen.queryByRole("heading", {name:"데이터 보호"})).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("복구 검토: 2개");
});
beforeEach(() => {
  jest.clearAllMocks();
  useSelector.mockReturnValue({ uid: "fixture" });
  IpcSender.onAll.mockImplementation((topic, fn) => { listener = fn; return fn; });
  IpcSender.syncV2.getStatus.mockImplementation((fn) => fn({
    success: true, data: { uid: "fixture", connected: true, pending: 0, seq: "1", canSync: true },
  }));
});
const emit = (data) => act(() => listener({ success: true, data: { uid: "fixture", ...data } }));

test("shows pending changes in a status bar", () => {
  const { unmount } = render(<SettingData />);
  expect(screen.getByRole("status")).toHaveTextContent("동기화 대기: 0개");
  emit({ connected: false, pending: 1, seq: "1", canSync: true });
  expect(screen.getByRole("status")).toHaveTextContent("오프라인");
  expect(screen.getByRole("status")).toHaveTextContent("동기화 대기: 1개");
  expect(screen.getByRole("button", {name:"동기화"})).toBeDisabled();
  emit({ connected: true, pending: 0, seq: "9007199254740993", canSync: true });
  expect(screen.getByRole("status")).toHaveTextContent("동기화 대기: 0개");
  expect(screen.queryByText("9007199254740993")).not.toBeInTheDocument();
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
  expect(screen.getByRole("status")).not.toHaveTextContent("99");
});

test("retries through the existing sync action without a destructive initialization prompt", () => {
  IpcSender.syncV2.retry.mockImplementation((fn) => fn({ success: true }));
  render(<SettingData />);
  fireEvent.click(screen.getByRole("button", { name: "동기화" }));
  expect(IpcSender.syncV2.retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("전체 초기화")).not.toBeInTheDocument();
});

test("disables retry before a session exists and shows unavailable state", () => {
  IpcSender.syncV2.getStatus.mockImplementation((fn) => fn({
    success: true, data: { uid: "fixture", pending: null, seq: null, canSync: false },
  }));
  render(<SettingData />);
  expect(screen.getByRole("status")).toHaveTextContent("동기화 대기: —개");
  expect(screen.getByRole("button", { name: "동기화" })).toBeDisabled();
});

test("preview shows synthetic data without requesting account status", () => {
  render(<SettingData preview />);
  expect(IpcSender.syncV2.getStatus).not.toHaveBeenCalled();
  expect(IpcSender.onAll).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "동기화" })).toBeDisabled();
  expect(screen.getByRole("navigation", {name:"데이터 관리 작업"})).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "관리 메뉴 열기" })).not.toBeInTheDocument();
});
