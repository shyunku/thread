import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { SecretSessionProvider, secretMethodLine, useSecretSession } from "./useSecretSession";
import IpcSender from "../utils/IpcSender";
import Toast from "../molecules/Toast";

jest.mock("../utils/IpcSender", () => ({ vault: { verifyUser: jest.fn(), onLocked: jest.fn() } }));
jest.mock("../molecules/Toast", () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn() } }));

let session;
function Probe() {
  session = useSecretSession();
  return <span data-testid="state">{`${session.unlocked}/${session.showSecret}`}</span>;
}
const state = () => screen.getByTestId("state").textContent;
let locked;
function setup() {
  IpcSender.vault.onLocked.mockImplementation((uid, cb) => {
    locked = cb;
    return () => {};
  });
  return render(
    <SecretSessionProvider uid="me">
      <Probe />
    </SecretSessionProvider>
  );
}
// probe: the answer to the empty password check; os/password: the real checks.
function vault({ osAvailable = true, passwordAvailable = true, os = { verified: true, method: "os" }, password = "pw", probe, busyPassword = false } = {}) {
  IpcSender.vault.verifyUser.mockImplementation((input, cb) => {
    if (input.method === "os") return cb({ success: true, data: os });
    if (input.method === "password" && input.password === undefined)
      return cb({ success: true, data: probe ?? { verified: false, method: "password", code: "PASSWORD_REJECTED", osAvailable, passwordAvailable } });
    if (busyPassword) return cb({ success: true, data: { verified: false, code: "BUSY" } });
    cb({ success: true, data: input.password === password ? { verified: true, method: "password" } : { verified: false, code: "PASSWORD_REJECTED" } });
  });
}
const dialog = () => screen.getByRole("alertdialog", { name: "비밀 카테고리를 볼까요?" });

beforeEach(() => jest.clearAllMocks());

test("an OS-auth vault shows the Hello dialog, then unlocks once for the run", async () => {
  vault();
  setup();
  expect(IpcSender.vault.onLocked).toHaveBeenCalledWith("me", expect.any(Function));
  let result;
  act(() => {
    result = session.unlock({ color: "#e57ad6" });
  });
  expect(within(dialog()).getByText("Windows Hello로 본인 확인을 해요. 앱을 닫거나 잠글 때까지 다시 묻지 않아요.")).toBeTruthy();
  // The shield in the category colour; no field.
  expect(dialog().querySelector(".tp-dialog-i").style.color).toBe("rgb(229, 122, 214)");
  expect(within(dialog()).queryByRole("textbox")).toBeNull();
  await act(async () => fireEvent.click(within(dialog()).getByText("확인")));
  await expect(result).resolves.toBe(true);
  expect(state()).toBe("true/false");
  expect(IpcSender.vault.verifyUser).toHaveBeenLastCalledWith({ method: "os" }, expect.any(Function));
  expect(session.method).toBe("os");
  // No second ask.
  await act(async () => expect(await session.unlock()).toBe(true));
  expect(IpcSender.vault.verifyUser).toHaveBeenCalledTimes(2);
});

test("cancel is silent and stays locked; a cancelled OS prompt too", async () => {
  vault({ os: { verified: false, method: "os", code: "OS_AUTH_CANCELLED", passwordAvailable: true } });
  setup();
  let result;
  act(() => {
    result = session.unlock();
  });
  await act(async () => fireEvent.click(screen.getByText("취소")));
  await expect(result).resolves.toBe(false);
  act(() => {
    result = session.unlock();
  });
  await act(async () => fireEvent.click(screen.getByText("확인")));
  await expect(result).resolves.toBe(false);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(Toast.error).not.toHaveBeenCalled();
  expect(state()).toBe("false/false");
});

test("a password vault asks in the dialog's own field; a wrong password keeps it with a line", async () => {
  vault({ osAvailable: false });
  setup();
  let result;
  act(() => {
    result = session.unlock();
  });
  expect(within(dialog()).getByText(/보관함 비밀번호로 본인 확인을 해요/)).toBeTruthy();
  const field = within(dialog()).getByLabelText("보관함 비밀번호");
  expect(field).toHaveAttribute("type", "password");
  expect(document.activeElement).toBe(field);
  fireEvent.change(field, { target: { value: "nope" } });
  await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
  expect(within(dialog()).getByRole("alert")).toHaveTextContent("비밀번호가 맞지 않아요.");
  expect(field).toHaveValue("");
  fireEvent.change(field, { target: { value: "pw" } });
  await act(async () => fireEvent.click(within(dialog()).getByText("확인")));
  await expect(result).resolves.toBe(true);
  expect(IpcSender.vault.verifyUser).toHaveBeenLastCalledWith({ method: "password", password: "pw" }, expect.any(Function));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(field.value).toBe("");
  expect(state()).toBe("true/false");
  expect(secretMethodLine(session.method)).toBe("열 때 보관함 비밀번호로 확인해요");
});

test("a busy vault during the password check says to try again later", async () => {
  vault({ osAvailable: false, busyPassword: true });
  setup();
  act(() => {
    session.unlock();
  });
  const field = within(dialog()).getByLabelText("보관함 비밀번호");
  fireEvent.change(field, { target: { value: "pw" } });
  await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
  expect(within(dialog()).getByRole("alert")).toHaveTextContent("잠시 뒤에 다시 해 주세요.");
});

test("cancelling the password dialog (Esc) resolves false and closes only it", async () => {
  vault({ osAvailable: false });
  setup();
  let result;
  act(() => {
    result = session.unlock();
  });
  await act(async () => fireEvent.keyDown(within(dialog()).getByLabelText("보관함 비밀번호"), { key: "Escape" }));
  await expect(result).resolves.toBe(false);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("a failed OS check falls back to the vault password", async () => {
  vault({ os: { verified: false, method: "os", code: "OS_AUTH_FAILED", passwordAvailable: true } });
  setup();
  act(() => {
    session.unlock();
  });
  await act(async () => fireEvent.click(screen.getByText("확인")));
  expect(within(dialog()).getByLabelText("보관함 비밀번호")).toBeTruthy();
});

test("a BUSY probe says to try again later; a 'verified' probe is not trusted", async () => {
  vault({ probe: { verified: false, code: "BUSY" } });
  setup();
  await act(async () => expect(await session.unlock()).toBe(false));
  expect(Toast.warn).toHaveBeenCalledWith("잠시 뒤에 다시 해 주세요.");
  expect(Toast.error).not.toHaveBeenCalled();
  vault({ probe: { verified: true, method: "password" } });
  await act(async () => expect(await session.unlock()).toBe(false));
  expect(Toast.error).toHaveBeenCalledWith("잠금을 풀 수 없어요.");
  expect(state()).toBe("false/false");
});

test("the eye asks for the unlock once, and a vault lock clears everything", async () => {
  vault();
  setup();
  act(() => {
    session.toggleShowSecret();
  });
  await act(async () => fireEvent.click(screen.getByText("확인")));
  expect(state()).toBe("true/true");
  await act(async () => session.toggleShowSecret());
  expect(state()).toBe("true/false");
  await act(async () => session.toggleShowSecret());
  expect(state()).toBe("true/true");
  expect(IpcSender.vault.verifyUser).toHaveBeenCalledTimes(2);
  act(() => locked({ phase: "LOCKED", uid: "me" }));
  expect(state()).toBe("false/false");
});

test("a vault lock while the password dialog is open closes it and the ask ends unlocked = false", async () => {
  vault({ osAvailable: false });
  setup();
  let result;
  act(() => {
    result = session.unlock();
  });
  fireEvent.change(within(dialog()).getByLabelText("보관함 비밀번호"), { target: { value: "typed" } });
  act(() => locked({ phase: "LOCKED", uid: "me" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await expect(result).resolves.toBe(false);
});

test("probeMethod learns the method without asking", async () => {
  vault({ osAvailable: true });
  setup();
  expect(session.method).toBe(null);
  act(() => session.probeMethod());
  expect(session.method).toBe("os");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(state()).toBe("false/false");
});

test("an IPC failure (legacy session, locked vault) does not unlock", async () => {
  IpcSender.vault.verifyUser.mockImplementation((input, cb) => cb({ success: false, data: { code: "VAULT_ACTION_FAILED" } }));
  setup();
  await act(async () => expect(await session.unlock()).toBe(false));
  expect(state()).toBe("false/false");
});
