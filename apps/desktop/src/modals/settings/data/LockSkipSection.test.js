import { act, fireEvent, render, screen } from "@testing-library/react";
import IpcSender from "../../../utils/IpcSender";
import LockSkipSection, { LOCK_SKIP_DESC, LOCK_SKIP_LABEL } from "./LockSkipSection";

jest.mock("../../../utils/IpcSender", () => ({
  appSettings: { get: jest.fn(), set: jest.fn() },
  vault: { skipLock: jest.fn() },
}));

// This account's skip lives in main (vault/skipLock get / on / off), not in app settings.
let stored, onAnswer;
beforeEach(() => {
  stored = false;
  onAnswer = () => ({ verified: true, method: "os", skipLockOnStart: true });
  IpcSender.vault.skipLock.mockImplementation((action, input, cb) => {
    if (action === "get") return cb({ success: true, data: { skipLockOnStart: stored } });
    if (action === "off") { stored = false; return cb({ success: true, data: { skipLockOnStart: false } }); }
    const answer = onAnswer(input);
    if (answer.verified) stored = true;
    cb({ success: true, data: answer });
  });
});

const toggle = () => screen.getByRole("switch", { name: LOCK_SKIP_LABEL });
const flip = async () => { await act(async () => { fireEvent.click(toggle()); }); };
const view = async (vault) => { await act(async () => { render(<LockSkipSection vault={vault} />); }); };
const calls = (action) => IpcSender.vault.skipLock.mock.calls.filter(([a]) => a === action);

test("앱 잠금 row: the confirmed wording, this account's value", async () => {
  await view({ osAvailable: true, passwordAvailable: true });
  expect(screen.getByRole("heading", { name: "앱 잠금" })).toBeInTheDocument();
  expect(screen.getByText(LOCK_SKIP_LABEL)).toBeInTheDocument();
  expect(screen.getByText("이 PC에서는 본인 확인 없이 바로 열려요. 비밀 카테고리 잠금 설정은 별개예요.")).toBeInTheDocument();
  expect(LOCK_SKIP_DESC).toBe("이 PC에서는 본인 확인 없이 바로 열려요. 비밀 카테고리 잠금 설정은 별개예요.");
  expect(calls("get")).toHaveLength(1);
  expect(toggle()).toHaveAttribute("aria-checked", "false");
  expect(IpcSender.appSettings.get).not.toHaveBeenCalled();
});

test("turning it on asks Windows Hello in main; cancelling leaves it off; off asks nothing", async () => {
  onAnswer = () => ({ verified: false, method: "os", code: "OS_AUTH_CANCELLED", passwordAvailable: true });
  await view({ osAvailable: true, passwordAvailable: true });
  await flip();
  expect(IpcSender.vault.skipLock).toHaveBeenLastCalledWith("on", { method: "os" }, expect.any(Function));
  expect(toggle()).toHaveAttribute("aria-checked", "false");
  expect(screen.queryByRole("alert")).toBeNull();
  onAnswer = () => ({ verified: true, method: "os", skipLockOnStart: true });
  await flip();
  expect(toggle()).toHaveAttribute("aria-checked", "true");
  await flip();
  expect(IpcSender.vault.skipLock).toHaveBeenLastCalledWith("off", {}, expect.any(Function));
  expect(calls("on")).toHaveLength(2);
  expect(toggle()).toHaveAttribute("aria-checked", "false");
  // Never through app settings.
  expect(IpcSender.appSettings.set).not.toHaveBeenCalled();
});

test("a vault without the OS check asks its password in a dialog", async () => {
  onAnswer = (input) => (input.password === "right" ? { verified: true, method: "password", skipLockOnStart: true } : { verified: false, method: "password", code: "PASSWORD_REJECTED" });
  await view({ osAvailable: false, passwordAvailable: true });
  await flip();
  expect(calls("on")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("보관함 비밀번호"), { target: { value: "wrong" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "켜기" })); });
  expect(IpcSender.vault.skipLock).toHaveBeenLastCalledWith("on", { method: "password", password: "wrong" }, expect.any(Function));
  expect(screen.getByText("보관함 비밀번호가 맞지 않아요.")).toBeInTheDocument();
  expect(toggle()).toHaveAttribute("aria-checked", "false");
  fireEvent.change(screen.getByLabelText("보관함 비밀번호"), { target: { value: "right" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "켜기" })); });
  expect(toggle()).toHaveAttribute("aria-checked", "true");
  expect(screen.queryByLabelText("보관함 비밀번호")).toBeNull();
});

test("a failed Hello falls back to the password; busy and a failed off say so", async () => {
  let n = 0;
  onAnswer = () => (++n === 1 ? { verified: false, method: "os", code: "OS_AUTH_FAILED", passwordAvailable: true } : { verified: false, code: "BUSY" });
  await view({ osAvailable: true, passwordAvailable: true });
  await flip();
  expect(screen.getByText(/Windows Hello로 확인하지 못했어요/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  await flip();
  expect(screen.getByRole("alert")).toHaveTextContent("잠시 뒤에 다시 해 주세요.");
});

test("it shows what this account has", async () => {
  stored = true;
  await view({ osAvailable: true });
  expect(toggle()).toHaveAttribute("aria-checked", "true");
  IpcSender.vault.skipLock.mockImplementation((action, input, cb) => cb({ success: false, data: { code: "VAULT_ACTION_FAILED" } }));
  await flip();
  expect(screen.getByRole("alert")).toHaveTextContent("설정을 바꾸지 못했어요");
  expect(toggle()).toHaveAttribute("aria-checked", "true");
});
