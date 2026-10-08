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
  expect(s.getState().prefs).toEqual({ startView: "timeline", weekStart: 1, timeFormat: "24", timeDisplay: "remain", remainFormat: "normal", dueFormat: "auto", listTodoOpen: true, listDoneOpen: false });
  expect(screen.getByRole("radio", { name: "라이트" })).toBeDisabled();
});

test("시각 형식 keeps the 12/24-hour choice; 시간 표시 switches mode and detail with a live preview", () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 7, 14, 58, 19));
  try {
    const { store: s } = wrap(<SettingCommon />);
    expect(screen.getByRole("radiogroup", { name: "시각 형식" })).toBeInTheDocument();
    expect(screen.getByText("할 일 목록과 캘린더 아래 목록에 남은 시간을 얼마나 자세히 보여 줄지 정해요.")).toBeInTheDocument();
    const normal = screen.getByRole("radio", { name: "보통" });
    expect(normal).toHaveAttribute("aria-checked", "true");
    expect(normal).toHaveAccessibleDescription("1일 4시간 남음 · 1개월 4일 남음 · 1시간 남음");
    // Preview: two task rows and today's list, overdue first.
    expect(screen.getAllByText("2시간 59분 남음")).toHaveLength(2);
    expect(screen.getByText("1일 4시간 남음")).toBeInTheDocument();
    const day = [...document.querySelectorAll(".time-display .selected-day-task")];
    expect(day.map((row) => row.querySelector(".selected-day-task__title").textContent)).toEqual(["주간 보고서 제출", "분기 회고 자료 정리"]);
    expect(screen.getByText("3시간 40분 지남")).toHaveClass("overdue");

    fireEvent.click(screen.getByRole("radio", { name: "모두" }));
    expect(s.getState().prefs.remainFormat).toBe("all");
    expect(screen.getAllByText("2시간 59분 55초 남음")).toHaveLength(2);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getAllByText("2시간 59분 54초 남음")).toHaveLength(2);

    fireEvent.click(screen.getByRole("radio", { name: "기한" }));
    expect(s.getState().prefs.timeDisplay).toBe("due");
    expect(screen.getByText("할 일 목록과 캘린더 아래 목록에 기한을 얼마나 자세히 보여 줄지 정해요.")).toBeInTheDocument();
    const choices = screen.getByRole("radiogroup", { name: "기한 표시 방식" });
    expect([...choices.querySelectorAll("[role=radio]")].map((radio) => radio.getAttribute("aria-label"))).toEqual(["간단히", "자동", "정확히", "자세히"]);
    expect(screen.getByRole("radio", { name: "자동" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "자동" })).toHaveAccessibleDescription("오늘 오후 3시 20분 · 내일 오후 5시 30분 · 금요일 오후 3시 · 어제 오후 6시 · 26.10.17 오후 2:00");
    expect(screen.getAllByText("오늘 오후 5시 58분")).toHaveLength(2);
    expect(screen.getByText("오늘 오전 11시 18분")).toHaveClass("overdue");

    fireEvent.click(screen.getByRole("radio", { name: "24시간" }));
    expect(screen.getAllByText("오늘 17시 58분")).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: "정확히" }));
    expect(s.getState().prefs).toMatchObject({ timeDisplay: "due", remainFormat: "all", dueFormat: "exact", timeFormat: "24" });
    expect(screen.getAllByText("26.10.07 17:58")).toHaveLength(2);
  } finally {
    jest.useRealTimers();
  }
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
