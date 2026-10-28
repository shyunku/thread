import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import accountReducer, { setAccount, setAuth } from "../../store/accountSlice";
import IpcSender from "../../utils/IpcSender";
import { clearLoginNotice, peekLoginNotice } from "../../utils/loginNotice";
import SettingAccount from "./Account.settings";

jest.mock("../../utils/IpcSender", () => ({
  vault: { revokeOtherSessions: jest.fn(), deleteAccount: jest.fn(), status: jest.fn(), rotation: jest.fn() },
}));
jest.mock("../../molecules/Prompt", () => ({ __esModule: true, default: { float: jest.fn() } }));
jest.mock("../../molecules/Toast", () => ({ __esModule: true, default: { info: jest.fn(), error: jest.fn() } }));

const ACK = "모든 기기의 데이터가 지워지는 것을 이해했어요";

function setup({ osAvailable = true, passwordAvailable = true, devices = 3 } = {}) {
  IpcSender.vault.status.mockImplementation((cb) => cb({ success: true, data: { phase: "UNLOCKED", osAvailable, passwordAvailable } }));
  IpcSender.vault.rotation.mockImplementation((action, _input, cb) => cb({ success: true, data: Array.from({ length: devices }, (_, i) => ({ id: "d" + i })) }));
  const store = configureStore({ reducer: { account: accountReducer } });
  store.dispatch(setAccount({ uid: "u1", username: "Jo", authId: "thread_user", googleEmail: null }));
  store.dispatch(setAuth({ accessToken: "a", refreshToken: "r" }));
  const modalRef = { current: { close: jest.fn() } };
  const openPage = jest.fn();
  render(<Provider store={store}><SettingAccount modalRef={modalRef} openPage={openPage} /></Provider>);
  return { store, modalRef, openPage };
}

const openDialog = async () => {
  fireEvent.click(screen.getByRole("button", { name: "계정 삭제…" }));
  await screen.findByRole("dialog", { name: "계정을 삭제할까요?" });
};

afterEach(() => {
  jest.clearAllMocks();
  clearLoginNotice();
});

test("the account tab ends with 계정 삭제; the dialog lists what goes and keeps the red button off until checked", async () => {
  setup();
  expect(screen.getByText("계정과 모든 기기의 할 일을 지워요. 되돌릴 수 없어요.")).toBeInTheDocument();
  await openDialog();
  expect(screen.getByRole("dialog")).toHaveTextContent("thread_user 계정을 삭제하면");
  expect(screen.getByText("아이디 thread_user, 사용자 이름, Google 연결")).toBeInTheDocument();
  expect(screen.getByText("모든 기기의 할 일")).toBeInTheDocument();
  expect(await screen.findByText("연결된 기기 3대와 로그인")).toBeInTheDocument();
  expect(screen.getByText("복구 코드와 복구 파일")).toBeInTheDocument();
  const kill = await screen.findByRole("button", { name: "Windows Hello로 계정 삭제" });
  expect(kill).toBeDisabled();
  fireEvent.click(screen.getByText(ACK));
  expect(kill).toBeEnabled();
  fireEvent.click(screen.getByText(ACK));
  expect(kill).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(IpcSender.vault.deleteAccount).not.toHaveBeenCalled();
});

test("Windows Hello deletes, then the app forgets the account and the login screen says so", async () => {
  const { store, modalRef } = setup();
  IpcSender.vault.deleteAccount.mockImplementation((input, cb) => cb({ success: true, data: { deleted: true } }));
  await openDialog();
  fireEvent.click(screen.getByText(ACK));
  await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Windows Hello로 계정 삭제" })); });
  expect(IpcSender.vault.deleteAccount).toHaveBeenCalledWith({ method: "os" }, expect.any(Function));
  expect(peekLoginNotice()).toBe("deleted");
  expect(store.getState().account.auth.accessToken).toBeNull();
  expect(store.getState().account.account.uid).toBeNull();
  expect(modalRef.current.close).toHaveBeenCalled();
});

test("the vault password is the other way; a wrong one keeps the dialog with a line", async () => {
  setup();
  IpcSender.vault.deleteAccount.mockImplementation((input, cb) => cb({ success: true, data: { deleted: false, code: "PASSWORD_REJECTED" } }));
  await openDialog();
  fireEvent.click(screen.getByText(ACK));
  fireEvent.click(await screen.findByRole("button", { name: "비밀번호 사용" }));
  const kill = screen.getByRole("button", { name: "비밀번호로 계정 삭제" });
  expect(kill).toBeDisabled();
  fireEvent.change(screen.getByLabelText("보관함 비밀번호"), { target: { value: "vault pw" } });
  await act(async () => { fireEvent.click(kill); });
  expect(IpcSender.vault.deleteAccount).toHaveBeenCalledWith({ method: "password", password: "vault pw" }, expect.any(Function));
  expect(screen.getByRole("alert")).toHaveTextContent("보관함 비밀번호가 맞지 않아요.");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByLabelText("보관함 비밀번호")).toHaveValue("");
  expect(peekLoginNotice()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Windows Hello 사용" }));
  expect(screen.queryByLabelText("보관함 비밀번호")).toBeNull();
});

test("without Windows Hello only the password is offered", async () => {
  setup({ osAvailable: false });
  await openDialog();
  expect(await screen.findByRole("button", { name: "비밀번호로 계정 삭제" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Windows Hello 사용" })).toBeNull();
  expect(screen.getByLabelText("보관함 비밀번호")).toBeInTheDocument();
});

test("a cancelled Hello prompt says nothing; a failed one falls back to the password; server errors are shown", async () => {
  setup();
  await openDialog();
  fireEvent.click(screen.getByText(ACK));
  const hello = await screen.findByRole("button", { name: "Windows Hello로 계정 삭제" });

  IpcSender.vault.deleteAccount.mockImplementationOnce((input, cb) => cb({ success: true, data: { deleted: false, code: "OS_AUTH_CANCELLED" } }));
  await act(async () => { fireEvent.click(hello); });
  expect(screen.queryByRole("alert")).toBeNull();

  IpcSender.vault.deleteAccount.mockImplementationOnce((input, cb) => cb({ success: true, data: { deleted: false, code: "OS_AUTH_FAILED", passwordAvailable: true } }));
  await act(async () => { fireEvent.click(hello); });
  expect(screen.getByLabelText("보관함 비밀번호")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("보관함 비밀번호를 입력해 주세요");

  IpcSender.vault.deleteAccount.mockImplementationOnce((input, cb) => cb({ success: true, data: { deleted: false, code: "ACCOUNT_DELETE_UNAVAILABLE" } }));
  fireEvent.change(screen.getByLabelText("보관함 비밀번호"), { target: { value: "pw" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "비밀번호로 계정 삭제" })); });
  expect(screen.getByRole("alert")).toHaveTextContent("계정을 삭제하지 못했어요");

  IpcSender.vault.deleteAccount.mockImplementationOnce((input, cb) => cb({ success: false, data: { code: "VAULT_ACTION_FAILED" } }));
  fireEvent.change(screen.getByLabelText("보관함 비밀번호"), { target: { value: "pw" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "비밀번호로 계정 삭제" })); });
  expect(screen.getByRole("alert")).toHaveTextContent("계정을 삭제하지 못했어요");
  expect(peekLoginNotice()).toBeNull();
});

test("데이터 백업 opens 설정 → 데이터 with the backup dialog", async () => {
  const { openPage } = setup();
  await openDialog();
  fireEvent.click(screen.getByRole("button", { name: "데이터 백업" }));
  expect(openPage).toHaveBeenCalledWith("DATA", "backup");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
