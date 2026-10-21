import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
  expect(s.getState().prefs).toMatchObject({ startView: "timeline", weekStart: 1, timeFormat: "24", showRemain: true, remainFormat: "normal", dueFormat: "group" });
  expect(s.getState().prefs).not.toHaveProperty("timeDisplay");
  expect(screen.getByRole("radio", { name: "라이트" })).toBeDisabled();
});

test("시간 표시 picks the due and remaining formats and the 보이기 switch, with a live two-line preview", () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 7, 14, 58, 19)); // Wednesday
  try {
    const { store: s } = wrap(<SettingCommon />);
    expect(screen.getByRole("radiogroup", { name: "시각 형식" })).toBeInTheDocument();
    expect(screen.getByText("할 일 목록 오른쪽 칸 위에는 기한, 아래에는 남은 시간을 연하게 보여 줘요.")).toBeInTheDocument();
    // The old 남은 시간 / 기한 choice is gone.
    expect(screen.queryByRole("radiogroup", { name: "시간 표시" })).toBeNull();

    const due = screen.getByRole("radiogroup", { name: "기한 표시 방식" });
    expect([...due.querySelectorAll("[role=radio]")].map((radio) => radio.getAttribute("aria-label"))).toEqual(["묶음 맞춤", "간단히", "자동", "정확히", "자세히"]);
    expect(within(due).getByRole("radio", { name: "묶음 맞춤" })).toHaveAttribute("aria-checked", "true");
    expect(within(due).getByText("새 기본값")).toBeInTheDocument();
    expect(within(due).getByRole("radio", { name: "묶음 맞춤" })).toHaveAccessibleDescription("오후 9시 · 금 오후 7시 · 10월 16일");
    expect(within(due).getByRole("radio", { name: "자동" })).toHaveAccessibleDescription("오늘 오후 9시 · 금요일 오후 7시 · 26.10.16 오후 6:00");

    const remain = screen.getByRole("radiogroup", { name: "남은 시간 표시 방식" });
    expect([...remain.querySelectorAll("[role=radio]")].map((radio) => radio.getAttribute("aria-label"))).toEqual(["간단히", "보통", "자세히", "모두"]);
    expect(within(remain).getByRole("radio", { name: "보통" })).toHaveAttribute("aria-checked", "true");
    expect(within(remain).getByRole("radio", { name: "보통" })).toHaveAccessibleDescription("3시간 30분 남음 · 1일 4시간 남음");

    // Preview: due on top, remaining time below; the overdue row is red.
    const preview = document.querySelector(".time-preview");
    const row = (title) => [...preview.querySelectorAll(".time-preview__row")].find((el) => el.textContent.includes(title));
    expect(row("분기 회고 자료 정리").querySelector(".time-preview__due")).toHaveTextContent("오후 5:58");
    expect(row("분기 회고 자료 정리").querySelector(".time-preview__remain")).toHaveTextContent("2시간 59분 남음");
    expect(row("운동 30분").querySelector(".time-preview__due")).toHaveTextContent("내일 오후 7:10");
    expect(row("주간 보고서 제출").querySelector(".time-preview__due")).toHaveClass("overdue");
    expect(row("주간 보고서 제출").querySelector(".time-preview__remain")).toHaveTextContent("3시간 40분 지남");

    fireEvent.click(within(remain).getByRole("radio", { name: "모두" }));
    expect(s.getState().prefs.remainFormat).toBe("all");
    expect(row("분기 회고 자료 정리").querySelector(".time-preview__remain")).toHaveTextContent("2시간 59분 55초 남음");
    act(() => { jest.advanceTimersByTime(1000); });
    expect(row("분기 회고 자료 정리").querySelector(".time-preview__remain")).toHaveTextContent("2시간 59분 54초 남음");

    const show = screen.getByRole("switch", { name: "남은 시간 보이기" });
    expect(show).toHaveAttribute("aria-checked", "true");
    fireEvent.click(show);
    expect(s.getState().prefs.showRemain).toBe(false);
    expect(preview.querySelector(".time-preview__remain")).toBeNull();
    expect(screen.getByRole("switch", { name: "남은 시간 보이기" })).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByRole("radio", { name: "24시간" }));
    expect(row("분기 회고 자료 정리").querySelector(".time-preview__due")).toHaveTextContent("17:58");
    expect(within(due).getByRole("radio", { name: "묶음 맞춤" })).toHaveAccessibleDescription("21:00 · 금 19:00 · 10월 16일");
    fireEvent.click(within(due).getByRole("radio", { name: "정확히" }));
    expect(s.getState().prefs).toMatchObject({ showRemain: false, remainFormat: "all", dueFormat: "exact", timeFormat: "24" });
    expect(row("분기 회고 자료 정리").querySelector(".time-preview__due")).toHaveTextContent("26.10.07 17:58");
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
