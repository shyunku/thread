import { act, fireEvent, render, screen } from "@testing-library/react";
import IpcSender from "../../../utils/IpcSender";
import KeyChangeDialog from "./KeyChangeDialog";
import AddDeviceDialog from "./AddDeviceDialog";
import FileAddDeviceDialog from "./FileAddDeviceDialog";
import BackupDialog from "./BackupDialog";
import RecoverySetupDialog from "./RecoverySetupDialog";

jest.mock("../../../utils/IpcSender", () => ({ syncV2: { retry: jest.fn() } }));
jest.mock("../../../utils/pairingQrImage", () => ({ readPairingImage: jest.fn() }));

const calls = [];
const group = (name, table) => jest.fn((action, input, cb) => {
  calls.push([name, action, input]);
  const value = table[action];
  cb(value instanceof Error ? { success: false, data: { code: value.message } } : { success: true, data: typeof value === "function" ? value(input) : value });
});
const click = async (name) => { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); };
const check = async (label) => { await act(async () => { fireEvent.click(screen.getByLabelText(label)); }); };

beforeEach(() => {
  calls.length = 0;
  // CRA resets mock implementations between tests.
  IpcSender.syncV2.retry.mockImplementation((cb) => cb({ success: true }));
});

test("removing a device rotates keys: prepare with the device, save, confirm, commit, then re-protect", async () => {
  IpcSender.vault = {
    rotation: group("rotation", { prepare: { phase: "RECOVERY_UNCONFIRMED" }, export: true, code: "THREAD1-NEWCODE",
      confirm: { phase: "RECOVERY_CONFIRMED" }, commit: { phase: "ACTIVE" } }),
    reencryption: group("reencryption", { start: { phase: "WAITING", count: 0 }, status: { phase: "WAITING", count: 100 } }),
  };
  const changed = jest.fn();
  render(<KeyChangeDialog mode="remove" device={{ id: "7be04411" }} osAvailable onClose={jest.fn()} onChanged={changed} />);
  expect(screen.getByRole("button", { name: "Windows Hello로 계속" })).toBeDisabled();
  await check("이해했어요. 새 복구 키를 안전하게 보관할게요.");
  await click("Windows Hello로 계속");
  expect(calls[0]).toEqual(["rotation", "prepare", { remove: ["7be04411"], confirmed: true, method: "os" }]);
  expect(screen.getByRole("button", { name: "저장했어요" })).toBeDisabled();
  await click("저장");
  await click("보기");
  expect(screen.getByText("THREAD1-NEWCODE")).toBeInTheDocument();
  await click("저장했어요");
  // The code is hidden again before the confirmation step.
  expect(screen.queryByText("THREAD1-NEWCODE")).not.toBeInTheDocument();
  const codeInput = screen.getByLabelText("새 복구 코드");
  fireEvent.change(codeInput, { target: { value: "THREAD1-NEWCODE" } });
  await check("적용하면 이 기기가 해제되고 이전 복구 키는 쓸 수 없어요.");
  await click("Windows Hello로 해제");
  expect(calls.filter(([, action]) => ["confirm", "commit"].includes(action))).toEqual([
    ["rotation", "confirm", { code: "THREAD1-NEWCODE" }],
    ["rotation", "commit", { confirmed: true, method: "os" }],
  ]);
  // The typed code is cleared from the field as soon as it is sent.
  expect(codeInput.value).toBe("");
  expect(changed).toHaveBeenCalled();
  expect(await screen.findByText(/다른 기기 · 7BE0을 해제했어요/)).toBeInTheDocument();
  expect(await screen.findByText(/다시 보호하고 있어요/)).toBeInTheDocument();
  expect(calls).toContainEqual(["reencryption", "start", { confirmed: true }]);
});

test("renewing the recovery key rotates without removing devices and can resume a confirmed rotation", async () => {
  IpcSender.vault = { rotation: group("rotation", { commit: { phase: "ACTIVE" } }), reencryption: group("reencryption", { start: { phase: "DONE", count: 3 } }) };
  render(<KeyChangeDialog mode="renew" resumePhase="RECOVERY_CONFIRMED" onClose={jest.fn()} />);
  expect(screen.getByText("새 복구 키를 확인했어요. 적용하면 교체가 끝나요.")).toBeInTheDocument();
  await check("적용하면 이전 복구 키는 쓸 수 없어요.");
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "secret-password" } });
  await click("비밀번호로 적용");
  expect(calls[0]).toEqual(["rotation", "commit", { confirmed: true, method: "password", password: "secret-password" }]);
  expect(calls.some(([, action]) => action === "confirm")).toBe(false);
  expect(await screen.findByText("✓ 새 복구 키로 바꿨어요.")).toBeInTheDocument();
});

test("a failed key step keeps the dialog open with guidance", async () => {
  IpcSender.vault = { rotation: group("rotation", { prepare: new Error("VAULT_ACTION_FAILED") }) };
  render(<KeyChangeDialog mode="renew" osAvailable onClose={jest.fn()} />);
  await check("이해했어요. 새 복구 키를 안전하게 보관할게요.");
  await click("Windows Hello로 계속");
  expect(screen.getByText(/처리하지 못했어요/)).toBeInTheDocument();
  expect(screen.getByText("1/4 · 영향 확인")).toBeInTheDocument();
});

test("adding a device through the relay waits, compares the code and approves", async () => {
  jest.useFakeTimers();
  try {
    let polls = 0;
    IpcSender.vault = { relay: group("relay", {
      ownerStart: { phase: "WAITING", expiresAt: Date.now() + 600000 },
      ownerPoll: () => (++polls < 2 ? { phase: "WAITING" } : { phase: "COMPARE", code: "482913", role: "write", expiresAt: Date.now() + 540000 }),
      ownerApprove: { phase: "DONE" },
      cancel: { phase: "CANCELLED" },
    }) };
    const changed = jest.fn();
    await act(async () => { render(<AddDeviceDialog vaultCode={"a".repeat(64)} osAvailable onClose={jest.fn()} onChanged={changed} />); });
    expect(screen.getByText(/새 기기를 기다리는 중/)).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(2000); });
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(screen.getByText("482 913")).toBeInTheDocument();
    expect(screen.getByText(/편집 가능/)).toBeInTheDocument();
    await click("Windows Hello로 승인");
    expect(calls.find(([, action]) => action === "ownerApprove")).toEqual(["relay", "ownerApprove", { method: "os" }]);
    expect(screen.getByText("✓ 새 기기를 추가했어요.")).toBeInTheDocument();
    expect(changed).toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test("the QR and file flow is still available from the relay dialog", async () => {
  IpcSender.vault = { relay: group("relay", { ownerStart: { phase: "WAITING" }, cancel: { phase: "CANCELLED" } }) };
  await act(async () => { render(<AddDeviceDialog vaultCode={"a".repeat(64)} osAvailable onClose={jest.fn()} />); });
  await click("QR·파일로 연결");
  expect(screen.getByText(/^AAAAAAAA AAAAAAAA/)).toBeInTheDocument();
  expect(calls.some(([, action]) => action === "cancel")).toBe(true);
});

test("adding a device shows this vault's code, opens the request and approves the matching fingerprint", async () => {
  const fingerprint = "b".repeat(64);
  IpcSender.vault = { pairing: group("pairing", { preview: { requestId: "r".repeat(32), fingerprint, role: "write", expiresAt: Date.now() + 9 * 60000 }, approve: { approved: true, saved: true } }) };
  render(<FileAddDeviceDialog vaultCode={"a".repeat(64)} osAvailable onClose={jest.fn()} />);
  expect(screen.getByText(/^AAAAAAAA AAAAAAAA/)).toBeInTheDocument();
  await click("다음");
  await click(/요청 파일 열기/);
  expect(screen.getByText(/^BBBBBBBB/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Windows Hello로 승인" })).toBeDisabled();
  await check("새 기기의 코드와 같습니다.");
  await click("Windows Hello로 승인");
  expect(calls.at(-1)).toEqual(["pairing", "approve", { requestId: "r".repeat(32), fingerprint, method: "os" }]);
  expect(screen.getByText("✓ 승인했어요.")).toBeInTheDocument();
});

test("backup export passes the generated code only after it was kept", async () => {
  IpcSender.vault = { backup: group("backup", { code: "BACKUP1-CODE", list: [], export: { phase: "EXPORTED", count: 42 } }) };
  const changed = jest.fn();
  await act(async () => { render(<BackupDialog osAvailable onClose={jest.fn()} onChanged={changed} />); });
  expect(screen.getByText("BACKUP1-CODE")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Windows Hello로 저장" })).toBeDisabled();
  await check("백업 코드를 따로 보관했어요.");
  await click("Windows Hello로 저장");
  expect(calls.at(-1)).toEqual(["backup", "export", { code: "BACKUP1-CODE", confirmed: true, method: "os" }]);
  expect(screen.getByText("✓ 42개 항목을 백업했어요.")).toBeInTheDocument();
  expect(changed).toHaveBeenCalled();
});

test("backup import reviews titles before adding them as new items", async () => {
  IpcSender.vault = { backup: group("backup", { code: "BACKUP1-CODE", list: [],
    restore: { phase: "REVIEW_REQUIRED", id: "c".repeat(32), count: 2 },
    review: { items: [{ id: "1", bucket: "visible", content: { title: "치과 예약" } }], next: null, count: 2 },
    apply: { phase: "COPIES_QUEUED", count: 2 } }) };
  await act(async () => { render(<BackupDialog osAvailable onClose={jest.fn()} />); });
  await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "불러오기" })); });
  fireEvent.change(screen.getByLabelText("백업 코드"), { target: { value: "BACKUP1-CODE" } });
  await click("Windows Hello로 파일 열기");
  expect(calls).toContainEqual(["backup", "restore", { code: "BACKUP1-CODE", confirmed: true, method: "os" }]);
  expect(screen.getByText("치과 예약")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Windows Hello로 2개 추가" })).toBeDisabled();
  await check("백업의 항목을 새 항목으로 추가할게요.");
  await click("Windows Hello로 2개 추가");
  expect(calls.at(-1)).toEqual(["backup", "apply", { id: "c".repeat(32), confirmed: true, method: "os" }]);
  expect(screen.getByText(/2개 항목을 새 항목으로 추가했어요/)).toBeInTheDocument();
});

test("first recovery key: save file, copy code through main, then confirm", async () => {
  const ok = (data) => jest.fn((...args) => args.at(-1)({ success: true, data }));
  IpcSender.vault = { prepareIdentity: ok({ phase: "RECOVERY_UNCONFIRMED" }), exportRecovery: ok(true),
    recoveryCodePreview: ok("THREAD1-F52B8***"), copyRecoveryCode: ok(true), confirmRecovery: ok({ phase: "RECOVERY_CONFIRMED" }) };
  const changed = jest.fn();
  render(<RecoverySetupDialog onClose={jest.fn()} onChanged={changed} />);
  expect(screen.getByRole("button", { name: "저장했어요" })).toBeDisabled();
  await click("저장");
  expect(screen.getByText("THREAD1-F52B8***")).toBeInTheDocument();
  await click("복사");
  await click("저장했어요");
  fireEvent.change(screen.getByLabelText("복구 코드"), { target: { value: "THREAD1-F52B8" } });
  await click("파일 열어 확인");
  expect(IpcSender.vault.confirmRecovery.mock.calls[0][0]).toBe("THREAD1-F52B8");
  expect(screen.getByText("✓ 복구 키를 확인했어요.")).toBeInTheDocument();
  expect(changed).toHaveBeenCalled();
});
