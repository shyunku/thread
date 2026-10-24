import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSelector } from "react-redux";
import SettingData from "./Data.settings";
import IpcSender from "../../utils/IpcSender";
import { SYNCING_MIN_MS } from "./data/SyncStatus";

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
// A connected device as main sends it (#77 names; null when the device has none yet).
const device = (fields) => ({ role: "write", own: false, addedAt: null, name: null, model: null, showId: true, canRename: false,
  shortId: String(fields.id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase(), ...fields });
// Each device row's name, with " · ID" when the short id is shown.
const rowLabels = () => [...document.querySelectorAll(".device-row .device-name")].map((node) =>
  [node.querySelector(".device-name__text").textContent, node.querySelector(".device-name__id")?.textContent].filter(Boolean).join(" · "));
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

test("fills the bar green when everything is synced", () => {
  render(<SettingData />);
  emit({ connected: true, pending: 0, lastSyncedAt: Date.now(), canSync: true });
  expect(syncRow()).toHaveTextContent("모두 동기화됨 · 방금");
  expect(screen.getByRole("img", { name: "모두 동기화됨" })).toBeInTheDocument();
  expect(document.querySelector(".sync-status__done--idle")).toBeNull();
  emit({ connected: true, pending: 3, lastSyncedAt: Date.now(), canSync: true });
  expect(syncRow()).toHaveTextContent("보낼 변경 3개 · 방금 동기화");
  expect(syncRow()).not.toHaveTextContent("모두 동기화됨");
});

test("shows a short sync as one calm pulse instead of a flicker", () => {
  jest.useFakeTimers();
  try {
    render(<SettingData />);
    emit({ connected: true, pending: 0, lastSyncedAt: Date.now(), canSync: true, syncing: true });
    expect(syncRow()).toHaveTextContent("동기화 중");
    expect(document.querySelector(".sync-status__bar--syncing")).not.toBeNull();
    emit({ connected: true, pending: 0, lastSyncedAt: Date.now(), canSync: true, syncing: false });
    expect(syncRow()).toHaveTextContent("동기화 중");
    act(() => { jest.advanceTimersByTime(SYNCING_MIN_MS); });
    expect(syncRow()).toHaveTextContent("온라인");
    expect(document.querySelector(".sync-status__bar--syncing")).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test("does not show syncing while offline", () => {
  render(<SettingData />);
  emit({ connected: false, pending: 0, canSync: true, syncing: true });
  expect(syncRow()).toHaveTextContent("오프라인");
  expect(document.querySelector(".sync-status__bar--syncing")).toBeNull();
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
      device({ id: "own-1", own: true, name: "Windows PC", model: "Windows PC", showId: false }),
      device({ id: "7be04411", role: "read", addedAt: new Date(2026, 8, 24).getTime() }),
    ] }),
    reencryption: okAction({ status: null }),
    backup: okAction({ last: null }),
  };
  await act(async () => { render(<SettingData modalRef={{ current: { close } }} />); });
  expect(await screen.findByText("✓ 보관됨")).toBeInTheDocument();
  expect(screen.getByText("2대")).toBeInTheDocument();
  expect(screen.getByText("⚠ 없음")).toBeInTheDocument();
  // 2.4.0 (#77): this PC shows its model; a device without a name keeps its short id.
  expect(rowLabels()).toEqual(["Windows PC", "다른 기기 · 7BE0"]);
  expect(screen.getByText("보기만 가능 · 9월 24일 연결")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "해제" })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /더 보기/ })).not.toBeInTheDocument();
  expect(screen.queryByText("이전 버전 데이터 검토")).not.toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /앱 잠금/ })); });
  expect(IpcSender.vault.lock).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalled();
  // The modal stays mounted while locked; the button must work again after the next unlock.
  expect(screen.getByRole("button", { name: /앱 잠금/ })).toBeEnabled();
});

test("non-owner device lists devices without managing them and sees unconfirmed actions only where allowed", async () => {
  IpcSender.vault = {
    status: ok({ uid: "fixture", phase: "UNLOCKED", osAvailable: false }),
    identityStatus: ok(null),
    intakes: ok([{ id: "intake-1", count: 3 }]),
    rotation: jest.fn(okAction({ status: null, devices: [
      device({ id: "owner-pc" }),
      device({ id: "this-pc", own: true, name: "Windows PC", model: "Windows PC", showId: false }),
    ] })),
    reencryption: okAction({ status: { phase: "PAUSED", count: 100 } }),
    backup: okAction({ last: { at: new Date(2026, 8, 29).getTime(), count: 42 } }),
  };
  await act(async () => { render(<SettingData />); });
  expect(await screen.findByText("다른 기기에서 관리")).toBeInTheDocument();
  expect(screen.queryByText("+ 새 기기 추가")).not.toBeInTheDocument();
  // Every PC lists the devices (#77); removing one stays with the owner.
  expect(IpcSender.vault.rotation).toHaveBeenCalledWith("devices", expect.anything(), expect.anything());
  expect(rowLabels()).toEqual(["다른 기기 · OWNE", "Windows PC"]);
  expect(screen.getByText("2대")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "해제" })).not.toBeInTheDocument();
  expect(screen.getByText("9월 29일")).toBeInTheDocument();
  expect(screen.getByText(/다시 보호하는 작업이 멈췄어요/)).toBeInTheDocument();
  expect(screen.getByText("이전 버전 데이터 검토")).toBeInTheDocument();
});

test("a stale locked state recovers on unlock events and when the window regains focus", async () => {
  let phase = "LOCKED";
  let vaultListener;
  IpcSender.onAll.mockImplementation((topic, fn) => { if (topic === "vault/status") vaultListener = fn; if (topic === "sync-v2/status") listener = fn; return fn; });
  IpcSender.vault = {
    status: (cb) => cb({ success: true, data: { uid: "fixture", phase, osAvailable: true } }),
    identityStatus: ok({ phase: "RECOVERY_CONFIRMED", fingerprint: "a".repeat(64) }),
    intakes: ok([]),
    rotation: okAction({ status: null, devices: [] }),
    reencryption: okAction({ status: null }),
    backup: okAction({ last: null }),
  };
  await act(async () => { render(<SettingData />); });
  expect(screen.getByRole("navigation", { name: "데이터 관리 작업" })).toBeInTheDocument();
  phase = "UNLOCKED";
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(await screen.findByText("✓ 보관됨")).toBeInTheDocument();
  await act(async () => { vaultListener({ success: true, data: { uid: "fixture", phase: "LOCKED" } }); });
  expect(screen.getByRole("navigation", { name: "데이터 관리 작업" })).toBeInTheDocument();
  await act(async () => { vaultListener({ success: true, data: { uid: "fixture", phase: "UNLOCKED" } }); });
  expect(await screen.findByText("✓ 보관됨")).toBeInTheDocument();
});

// Name writing on (2.5.0): main sends canRename for a write PC.
function renameFixture() {
  const renamable = (fields) => device({ canRename: true, ...fields });
  IpcSender.vault = {
    status: ok({ uid: "fixture", phase: "UNLOCKED", osAvailable: true, generation: 1 }),
    identityStatus: ok({ phase: "RECOVERY_CONFIRMED", fingerprint: "a".repeat(64) }),
    intakes: ok([]),
    rotation: okAction({ status: null, devices: [
      renamable({ id: "4d6be81f", own: true, name: "Windows PC", model: "Windows PC", showId: true }),
      renamable({ id: "7be0a1c2", name: "Windows PC", model: "Windows PC", showId: true, addedAt: new Date(2026, 8, 24).getTime() }),
      renamable({ id: "c90d5b37", name: "Galaxy S24", model: "Galaxy S24", showId: false }),
    ] }),
    reencryption: okAction({ status: null }),
    backup: okAction({ last: null }),
  };
  const saved = [];
  IpcSender.req = { device: { setDeviceName: jest.fn((id, name, cb) => { saved.push([id, name]); cb({ success: true }); }) } };
  return saved;
}

test("with name writing on, the ⋯ menu renames a device: Enter saves, Esc cancels, repeated names keep the id", async () => {
  const saved = renameFixture();
  await act(async () => { render(<SettingData />); });
  await screen.findByText("Galaxy S24");
  expect(rowLabels()).toEqual(["Windows PC · 4D6B", "Windows PC · 7BE0", "Galaxy S24"]);
  // Removal moved into the menu; this PC's menu only renames.
  expect(screen.queryByRole("button", { name: "해제" })).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: /더 보기/ })[0]);
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["이름 바꾸기"]);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();

  fireEvent.click(screen.getAllByRole("button", { name: /더 보기/ })[1]);
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["이름 바꾸기", "기기 해제"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "이름 바꾸기" }));
  const field = screen.getByRole("textbox", { name: "기기 이름" });
  expect(field).toHaveValue("Windows PC");
  expect(field).toHaveAttribute("placeholder", "Windows PC");
  expect(screen.getByText(/비워 두면 모델 이름\(Windows PC\)으로 보여요/)).toBeInTheDocument();
  // Esc cancels without saving.
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "기기 이름 바꾸기" })).not.toBeInTheDocument();
  expect(saved).toEqual([]);

  fireEvent.click(screen.getAllByRole("button", { name: /더 보기/ })[1]);
  fireEvent.click(screen.getByRole("menuitem", { name: "이름 바꾸기" }));
  fireEvent.change(screen.getByRole("textbox", { name: "기기 이름" }), { target: { value: "  회사 노트북 " } });
  await act(async () => { fireEvent.keyDown(screen.getByRole("textbox", { name: "기기 이름" }), { key: "Enter" }); });
  expect(saved).toEqual([["7be0a1c2", "회사 노트북"]]);
  expect(screen.queryByRole("dialog", { name: "기기 이름 바꾸기" })).not.toBeInTheDocument();
  // The names no longer repeat, so the ids go away.
  expect(rowLabels()).toEqual(["Windows PC", "회사 노트북", "Galaxy S24"]);
  delete IpcSender.req;
});

test("the rename dialog keeps an error from main and does not save an unchanged name", async () => {
  const saved = renameFixture();
  IpcSender.req.device.setDeviceName.mockImplementation((id, name, cb) => { saved.push([id, name]); cb({ success: false, data: { code: "DEVICE_NAME_INVALID" } }); });
  await act(async () => { render(<SettingData />); });
  await screen.findByText("Galaxy S24");
  fireEvent.click(screen.getAllByRole("button", { name: /더 보기/ })[2]);
  fireEvent.click(screen.getByRole("menuitem", { name: "이름 바꾸기" }));
  // Unchanged: closes without a request.
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(saved).toEqual([]);
  fireEvent.click(screen.getAllByRole("button", { name: /더 보기/ })[2]);
  fireEvent.click(screen.getByRole("menuitem", { name: "이름 바꾸기" }));
  fireEvent.change(screen.getByRole("textbox", { name: "기기 이름" }), { target: { value: "새 이름" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "저장" })); });
  expect(saved).toEqual([["c90d5b37", "새 이름"]]);
  expect(screen.getByRole("alert")).toHaveTextContent("이름은 40자까지");
  expect(screen.getByRole("dialog", { name: "기기 이름 바꾸기" })).toBeInTheDocument();
  delete IpcSender.req;
});
