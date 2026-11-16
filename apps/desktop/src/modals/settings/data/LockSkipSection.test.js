import { act, fireEvent, render, screen } from "@testing-library/react";
import IpcSender from "../../../utils/IpcSender";
import LockSkipSection, { LOCK_SKIP_DESC, LOCK_SKIP_LABEL } from "./LockSkipSection";

jest.mock("../../../utils/IpcSender", () => ({
  appSettings: { get: jest.fn(), set: jest.fn() },
  vault: { skipLock: jest.fn() },
}));

let stored;
beforeEach(() => {
  stored = { skipLockOnStart: false };
  IpcSender.appSettings.get.mockImplementation((cb) => cb({ success: true, data: { ...stored } }));
  IpcSender.appSettings.set.mockImplementation((patch, cb) => { stored = { ...stored, ...patch }; cb({ success: true, data: { ...stored } }); });
});

const toggle = () => screen.getByRole("switch", { name: LOCK_SKIP_LABEL });
const flip = async () => { await act(async () => { fireEvent.click(toggle()); }); };

test("앱 잠금 row: the confirmed wording, off by default", () => {
  render(<LockSkipSection vault={{ osAvailable: true, passwordAvailable: true }} />);
  expect(screen.getByRole("heading", { name: "앱 잠금" })).toBeInTheDocument();
  expect(screen.getByText(LOCK_SKIP_LABEL)).toBeInTheDocument();
  expect(screen.getByText("이 PC에서는 본인 확인 없이 바로 열려요. 비밀 카테고리 잠금 설정은 별개예요.")).toBeInTheDocument();
  expect(LOCK_SKIP_DESC).toBe("이 PC에서는 본인 확인 없이 바로 열려요. 비밀 카테고리 잠금 설정은 별개예요.");
  expect(toggle()).toHaveAttribute("aria-checked", "false");
});

test("turning it on asks Windows Hello in main; cancelling leaves it off; off asks nothing", async () => {
  let verified = false;
  IpcSender.vault.skipLock.mockImplementation((input, cb) => cb({ success: true, data: verified ? { verified: true, method: "os", skipLockOnStart: true } : { verified: false, method: "os", code: "OS_AUTH_CANCELLED", passwordAvailable: true } }));
  render(<LockSkipSection vault={{ osAvailable: true, passwordAvailable: true }} />);
  await flip();
  expect(IpcSender.vault.skipLock).toHaveBeenLastCalledWith({ method: "os" }, expect.any(Function));
  expect(toggle()).toHaveAttribute("aria-checked", "false");
  expect(screen.queryByRole("alert")).toBeNull();
  // Never through settings/set.
  expect(IpcSender.appSettings.set).not.toHaveBeenCalled();
  verified = true;
  await flip();
  expect(toggle()).toHaveAttribute("aria-checked", "true");
  await flip();
  expect(IpcSender.appSettings.set).toHaveBeenCalledWith({ skipLockOnStart: false }, expect.any(Function));
  expect(IpcSender.vault.skipLock).toHaveBeenCalledTimes(2);
  expect(toggle()).toHaveAttribute("aria-checked", "false");
});

test("a vault without the OS check asks its password in a dialog", async () => {
  IpcSender.vault.skipLock.mockImplementation((input, cb) => cb({ success: true, data: input.password === "right" ? { verified: true, method: "password", skipLockOnStart: true } : { verified: false, method: "password", code: "PASSWORD_REJECTED" } }));
  render(<LockSkipSection vault={{ osAvailable: false, passwordAvailable: true }} />);
  await flip();
  expect(IpcSender.vault.skipLock).not.toHaveBeenCalled();
  const field = screen.getByLabelText("보관함 비밀번호");
  fireEvent.change(field, { target: { value: "wrong" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "켜기" })); });
  expect(IpcSender.vault.skipLock).toHaveBeenLastCalledWith({ method: "password", password: "wrong" }, expect.any(Function));
  expect(screen.getByText("보관함 비밀번호가 맞지 않아요.")).toBeInTheDocument();
  expect(toggle()).toHaveAttribute("aria-checked", "false");
  fireEvent.change(screen.getByLabelText("보관함 비밀번호"), { target: { value: "right" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "켜기" })); });
  expect(toggle()).toHaveAttribute("aria-checked", "true");
  expect(screen.queryByLabelText("보관함 비밀번호")).toBeNull();
});

test("a failed Hello falls back to the password; busy says so", async () => {
  IpcSender.vault.skipLock.mockImplementationOnce((input, cb) => cb({ success: true, data: { verified: false, method: "os", code: "OS_AUTH_FAILED", passwordAvailable: true } }))
    .mockImplementationOnce((input, cb) => cb({ success: true, data: { verified: false, code: "BUSY" } }));
  render(<LockSkipSection vault={{ osAvailable: true, passwordAvailable: true }} />);
  await flip();
  expect(screen.getByText(/Windows Hello로 확인하지 못했어요/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  await flip();
  expect(screen.getByRole("alert")).toHaveTextContent("잠시 뒤에 다시 해 주세요.");
});

test("it shows what is stored", () => {
  stored.skipLockOnStart = true;
  render(<LockSkipSection vault={{ osAvailable: true }} />);
  expect(toggle()).toHaveAttribute("aria-checked", "true");
});
