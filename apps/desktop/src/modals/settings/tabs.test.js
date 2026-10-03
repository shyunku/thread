import { act, fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import prefsReducer from "../../store/prefsSlice";
import accountReducer from "../../store/accountSlice";
import IpcSender from "../../utils/IpcSender";
import SettingCommon from "./Common.settings";
import SettingSystem from "./System.settings";
import SettingInfo from "./Info.settings";

jest.mock("../../utils/IpcSender", () => ({
  appSettings: { get: jest.fn(), set: jest.fn() },
  releaseAlerts: { get: jest.fn() },
  openExternal: jest.fn(),
  system: { relaunch: jest.fn() },
}));

const store = () => configureStore({ reducer: { prefs: prefsReducer, account: accountReducer } });
const wrap = (ui, s = store()) => ({ ...render(<Provider store={s}>{ui}</Provider>), store: s });
const SETTINGS = { autoStart: true, closeToTray: true, hardwareAcceleration: true, betaUpdates: false, restartRequired: false };

beforeEach(() => {
  IpcSender.appSettings.get.mockImplementation((cb) => cb({ success: true, data: SETTINGS }));
  IpcSender.appSettings.set.mockImplementation((patch, cb) => cb({ success: true, data: { ...SETTINGS, ...patch, restartRequired: patch.hardwareAcceleration === false } }));
});

test("general preferences are stored in the persisted prefs slice", () => {
  const { store: s } = wrap(<SettingCommon />);
  fireEvent.click(screen.getByRole("radio", { name: "타임라인" }));
  fireEvent.click(screen.getByRole("radio", { name: "월요일" }));
  fireEvent.click(screen.getByRole("radio", { name: "24시간" }));
  expect(s.getState().prefs).toEqual({ startView: "timeline", weekStart: 1, timeFormat: "24", listTodoOpen: true, listDoneOpen: false });
  expect(screen.getByRole("radio", { name: "라이트" })).toBeDisabled();
});

test("system toggles save through main and show the restart notice for hardware acceleration", () => {
  wrap(<SettingSystem />);
  const hardware = screen.getByRole("switch", { name: "하드웨어 가속" });
  expect(hardware).toHaveAttribute("aria-checked", "true");
  fireEvent.click(hardware);
  expect(IpcSender.appSettings.set).toHaveBeenCalledWith({ hardwareAcceleration: false }, expect.any(Function));
  expect(screen.getByText("다시 시작하면 적용")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다시 시작" }));
  expect(IpcSender.system.relaunch).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("switch", { name: "창을 닫으면 트레이로" }));
  expect(IpcSender.appSettings.set).toHaveBeenLastCalledWith({ closeToTray: false }, expect.any(Function));
});

test("failed save restores the stored value and explains", () => {
  IpcSender.appSettings.set.mockImplementation((patch, cb) => cb({ success: false }));
  wrap(<SettingSystem />);
  fireEvent.click(screen.getByRole("switch", { name: "컴퓨터를 켜면 자동 시작" }));
  expect(screen.getByRole("alert")).toHaveTextContent("설정을 저장하지 못했어요");
  expect(screen.getByRole("switch", { name: "컴퓨터를 켜면 자동 시작" })).toHaveAttribute("aria-checked", "true");
});

test("about tab checks for updates, toggles beta and opens allowed links", async () => {
  IpcSender.releaseAlerts.get.mockImplementationOnce((cb) => cb({ success: true, data: null }))
    .mockImplementationOnce((cb) => cb({ success: true, data: { version: "2.0.1", mandatory: false } }));
  wrap(<SettingInfo />);
  fireEvent.click(screen.getByRole("button", { name: "업데이트 확인" }));
  expect(screen.getByText(/최신 버전입니다/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "업데이트 확인" }));
  expect(screen.getByText("새 버전 2.0.1을 받을 수 있어요.")).toBeInTheDocument();
  const opened = jest.fn();
  window.addEventListener("thread:open-update", opened);
  fireEvent.click(screen.getByRole("button", { name: "업데이트 보기" }));
  expect(opened).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("switch", { name: "베타 버전 받기" }));
  expect(IpcSender.appSettings.set).toHaveBeenCalledWith({ betaUpdates: true }, expect.any(Function));
  fireEvent.click(screen.getByRole("button", { name: /열기/ }));
  expect(IpcSender.openExternal).toHaveBeenCalledWith("https://site.threadapp.kr/privacy", expect.any(Function));
  fireEvent.click(screen.getByRole("button", { name: "메일 보내기" }));
  expect(IpcSender.openExternal).toHaveBeenCalledWith("mailto:shyunku.support@gmail.com", expect.any(Function));
});
