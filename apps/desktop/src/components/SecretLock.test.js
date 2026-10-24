import { act, fireEvent, render, screen } from "@testing-library/react";
import SecretLock, { TOP_BAR_SLOT_ID } from "./SecretLock";
import { SecretSessionProvider, useSecretSession } from "../hooks/useSecretSession";
import IpcSender from "../utils/IpcSender";

jest.mock("../molecules/Toast", () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock("../utils/IpcSender", () => ({ vault: { verifyUser: jest.fn(), onLocked: () => () => {} } }));

let session;
function Grab() {
  session = useSecretSession();
  return null;
}
function setup(props) {
  const slot = document.createElement("div");
  slot.id = TOP_BAR_SLOT_ID;
  document.body.appendChild(slot);
  const onHide = jest.fn();
  const view = render(
    <SecretSessionProvider uid="fixture">
      <Grab />
      <SecretLock hasSecret onHide={onHide} {...props} />
    </SecretSessionProvider>
  );
  return { slot, onHide, ...view };
}

beforeEach(() => {
  IpcSender.vault.verifyUser.mockImplementation((input, cb) =>
    cb({ success: true, data: input.method === "os" ? { verified: true, method: "os" } : { verified: false, osAvailable: true, passwordAvailable: true } })
  );
});
afterEach(() => document.getElementById(TOP_BAR_SLOT_ID)?.remove());

test("the lock sits in the top-bar slot: opening asks, locking is immediate", async () => {
  const { slot } = setup();
  const lock = screen.getByRole("button", { name: "비밀 카테고리 잠금 풀기" });
  expect(slot.contains(lock)).toBe(true);
  expect(lock).toHaveAttribute("aria-pressed", "false");
  await act(async () => fireEvent.click(lock));
  expect(screen.getByRole("alertdialog", { name: "비밀 카테고리 잠금을 풀까요?" })).toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "확인" })));
  const open = screen.getByRole("button", { name: "비밀 카테고리 잠그기" });
  expect(open).toHaveClass("on");
  expect(session.showSecret).toBe(true);
  fireEvent.click(open);
  expect(session.unlocked).toBe(false);
  expect(screen.getByRole("button", { name: "비밀 카테고리 잠금 풀기" })).toBeInTheDocument();
});

test("no secret category, no lock", () => {
  setup({ hasSecret: false });
  expect(screen.queryByRole("button", { name: /비밀 카테고리/ })).toBeNull();
});

test("locking on a secret category's screen goes to 모든 할 일", async () => {
  const { onHide } = setup({ onSecretScreen: true });
  // Locked from the start: that screen gives way at once.
  expect(onHide).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "비밀 카테고리 잠금 풀기" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "확인" })));
  expect(onHide).toHaveBeenCalledTimes(1);
  act(() => session.lock());
  expect(onHide).toHaveBeenCalledTimes(2);
});
