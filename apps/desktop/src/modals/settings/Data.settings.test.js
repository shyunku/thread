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
const ok = (data) => (cb) => cb({ success: true, data });
const okAction = (table) => (action, input, cb) => cb({ success: true, data: typeof table[action] === "function" ? table[action](input) : table[action] });

beforeEach(() => {
  jest.clearAllMocks();
  delete IpcSender.vault;
  useSelector.mockReturnValue({ uid: "fixture" });
  IpcSender.onAll.mockImplementation((topic, fn) => { if (topic === "sync-v2/status") listener = fn; return fn; });
  IpcSender.syncV2.getStatus.mockImplementation((fn) => fn({
    success: true, data: { uid: "fixture", connected: true, pending: 0, seq: "1", canSync: true },
  }));
});
const emit = (data) => act(() => listener({ success: true, data: { uid: "fixture", ...data } }));
const syncRow = () => screen.getAllByRole("status")[0];

test("shows pending changes and offline state in the sync bar", () => {
  const { unmount } = render(<SettingData />);
  expect(syncRow()).toHaveTextContent("보낼 변경 0개");
  emit({ connected: false, pending: 1, seq: "1", canSync: true });
  expect(syncRow()).toHaveTextContent("오프라인");
  expect(syncRow()).toHaveTextContent("보낼 변경 1개");
  expect(screen.getByRole("button", { name: "지금 동기화" })).toBeDisabled();
  emit({ connected: true, pending: 0, seq: "9007199254740993", canSync: true });
  expect(syncRow()).toHaveTextContent("보낼 변경 0개");
  expect(screen.queryByText("9007199254740993")).not.toBeInTheDocument();
  unmount();
  expect(IpcSender.off).toHaveBeenCalledWith("sync-v2/status", listener);
});

test("shows the last successful sync as relative time and conflicts needing review", () => {
  render(<SettingData />);
  emit({ connected: true, pending: 2, lastSyncedAt: Date.now() - 5 * 60000, recovery: 2, canSync: true });
  expect(syncRow()).toHaveTextContent("5분 전 동기화");
  expect(screen.getByText("충돌 검토가 필요한 변경: 2개")).toBeInTheDocument();
});

test("ignores other accounts and stale initial response after a live update", () => {
  let initial;
  IpcSender.syncV2.getStatus.mockImplementation((fn) => { initial = fn; });
  render(<SettingData />);
  emit({ seq: "5", pending: 0 });
  emit({ uid: "someone-else", pending: 99 });
  act(() => initial({ success: true, data: { uid: "fixture", pending: 7 } }));
  expect(syncRow()).not.toHaveTextContent("99");
  expect(syncRow()).not.toHaveTextContent("7개");
});

test("retries through the existing sync action without a destructive initialization prompt", () => {
  IpcSender.syncV2.retry.mockImplementation((fn) => fn({ success: true }));
  render(<SettingData />);
  fireEvent.click(screen.getByRole("button", { name: "지금 동기화" }));
  expect(IpcSender.syncV2.retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("전체 초기화")).not.toBeInTheDocument();
});

test("without an unlocked vault the existing unlock/setup flow is shown", () => {
  render(<SettingData />);
  expect(screen.getByRole("navigation", { name: "데이터 관리 작업" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /앱 잠금/ })).not.toBeInTheDocument();
});

test("unlocked owner sees protection summary, devices and can lock the app", async () => {
  const close = jest.fn();
  IpcSender.vault = {
    status: ok({ uid: "fixture", phase: "UNLOCKED", osAvailable: true, generation: 1 }),
    identityStatus: ok({ phase: "RECOVERY_CONFIRMED", fingerprint: "a".repeat(64) }),
    intakes: ok([]),
    lock: jest.fn(ok(true)),
    rotation: okAction({ status: null, devices: [
      { id: "own-1", role: "write", own: true, addedAt: null },
      { id: "7be04411", role: "read", own: false, addedAt: new Date(2026, 8, 24).getTime() },
    ] }),
    reencryption: okAction({ status: null }),
    backup: okAction({ last: null }),
  };
  await act(async () => { render(<SettingData modalRef={{ current: { close } }} />); });
  expect(await screen.findByText("✓ 보관됨")).toBeInTheDocument();
  expect(screen.getByText("2대")).toBeInTheDocument();
  expect(screen.getByText("⚠ 없음")).toBeInTheDocument();
  expect(screen.getByText("다른 기기 · 7BE0")).toBeInTheDocument();
  expect(screen.getByText("보기만 가능 · 9월 24일 연결")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "해제" })).toHaveLength(1);
  expect(screen.queryByText("이전 버전 데이터 검토")).not.toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /앱 잠금/ })); });
  expect(IpcSender.vault.lock).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalled();
});

test("non-owner device does not list or manage devices and sees unconfirmed actions only where allowed", async () => {
  IpcSender.vault = {
    status: ok({ uid: "fixture", phase: "UNLOCKED", osAvailable: false }),
    identityStatus: ok(null),
    intakes: ok([{ id: "intake-1", count: 3 }]),
    rotation: jest.fn(okAction({ status: null })),
    reencryption: okAction({ status: { phase: "PAUSED", count: 100 } }),
    backup: okAction({ last: { at: new Date(2026, 8, 29).getTime(), count: 42 } }),
  };
  await act(async () => { render(<SettingData />); });
  expect(await screen.findByText("다른 기기에서 관리")).toBeInTheDocument();
  expect(screen.queryByText("+ 새 기기 추가")).not.toBeInTheDocument();
  expect(IpcSender.vault.rotation).not.toHaveBeenCalledWith("devices", expect.anything(), expect.anything());
  expect(screen.getByText("9월 29일")).toBeInTheDocument();
  expect(screen.getByText(/다시 보호하는 작업이 멈췄어요/)).toBeInTheDocument();
  expect(screen.getByText("이전 버전 데이터 검토")).toBeInTheDocument();
});
