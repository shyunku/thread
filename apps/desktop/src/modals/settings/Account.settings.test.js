import { act, fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import accountReducer from "../../store/accountSlice";
import IpcSender from "../../utils/IpcSender";
import Prompt from "../../molecules/Prompt";
import Toast from "../../molecules/Toast";
import SettingAccount from "./Account.settings";

jest.mock("../../utils/IpcSender", () => ({ vault: { revokeOtherSessions: jest.fn() } }));
jest.mock("../../molecules/Prompt", () => ({ __esModule: true, default: { float: jest.fn() } }));
jest.mock("../../molecules/Toast", () => ({ __esModule: true, default: { info: jest.fn(), error: jest.fn() } }));

const renderAccount = () => render(
  <Provider store={configureStore({ reducer: { account: accountReducer } })}><SettingAccount /></Provider>
);
const confirmRevoke = async () => {
  fireEvent.click(screen.getByRole("button", { name: "모두 로그아웃" }));
  expect(Prompt.float).toHaveBeenCalledWith("다른 곳에서 모두 로그아웃", expect.any(String), expect.anything());
  await act(async () => { await Prompt.float.mock.calls.at(-1)[2].onConfirm(); });
};

test("logging out other devices asks first and reports success", async () => {
  IpcSender.vault.revokeOtherSessions.mockImplementation((cb) => cb({ success: true, data: true }));
  renderAccount();
  await confirmRevoke();
  expect(IpcSender.vault.revokeOtherSessions).toHaveBeenCalledTimes(1);
  expect(Toast.info).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "모두 로그아웃" })).toBeEnabled();
});

test("a failed revoke shows an error and can be retried", async () => {
  IpcSender.vault.revokeOtherSessions.mockImplementation((cb) => cb({ success: false, data: { code: "VAULT_ACTION_FAILED" } }));
  renderAccount();
  await confirmRevoke();
  expect(Toast.error).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "모두 로그아웃" })).toBeEnabled();
});
