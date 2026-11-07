import Task from "../objects/Task";
import {
  alertName, alertsLabel, DEFAULT_ALERT_SETTINGS, hasStartTime, isMultiDayPeriod, normalAlertSettings, periodCoversDay,
  periodOffset, periodStartedBy, periodStatus, taskAlerts, taskPeriod, taskStart,
} from "./taskPeriod";

// Synthetic times around the mock's now, Tue 2026-11-10 13:20 (local).
const at = (m, d, h = 23, mi = 59) => new Date(2026, m - 1, d, h, mi, h === 23 && mi === 59 ? 59 : 0).getTime();
const day0 = (m, d) => new Date(2026, m - 1, d).getTime();
const NOW = at(11, 10, 13, 20);
const H = 3600e3;
// A Task as the lists bring it (Task.fromEntity of a row).
const row = (fields) => Task.fromEntity({ tid: "t", title: "T", ...fields });
const period = (start, end, extra) => row({ due_date: end, start_offset: end - start, ...extra });

describe("Task rows (#109)", () => {
  test("startDate comes from the due and start_offset; alerts are on, off or null", () => {
    const t = period(day0(11, 9), at(11, 12), { alert_start: "on", alert_end: "off" });
    expect(t.startDate).toBe(day0(11, 9));
    expect(t.startOffset).toBe(at(11, 12) - day0(11, 9));
    expect([t.alertStart, t.alertEnd]).toEqual(["on", "off"]);
    expect(t.toEntity()).toMatchObject({ start_offset: at(11, 12) - day0(11, 9), alert_start: "on", alert_end: "off" });
  });

  test("an offset without a due, a bad offset or a bad alert is no period and follows the settings", () => {
    for (const fields of [{ due_date: 0, start_offset: 5000 }, { due_date: at(11, 12), start_offset: -1 }, { due_date: at(11, 12), start_offset: at(11, 12) },
      { due_date: at(11, 12), start_offset: "1" }, { due_date: at(11, 12) }]) {
      const t = row({ ...fields, alert_start: "yes", alert_end: 1 });
      expect([t.startDate, t.startOffset, t.alertStart, t.alertEnd]).toEqual([null, 0, null, null]);
    }
    const fresh = new Task("New", null);
    expect([fresh.startDate, fresh.startOffset, fresh.alertStart, fresh.alertEnd]).toEqual([null, 0, null, null]);
  });
});

describe("periods", () => {
  test("start, offsets and multi-day", () => {
    const t = period(day0(11, 9), at(11, 12));
    expect(taskStart(t)).toBe(day0(11, 9));
    expect(taskPeriod(t)).toEqual({ start: day0(11, 9), end: at(11, 12) });
    expect(taskStart({ due_date: at(11, 12), start_offset: 1000 })).toBe(at(11, 12) - 1000);
    expect(taskStart(row({ due_date: at(11, 12) }))).toBeNull();
    expect(taskPeriod(row({}))).toBeNull();
    expect(periodOffset(day0(11, 9), at(11, 12))).toBe(at(11, 12) - day0(11, 9));
    expect(periodOffset(new Date(day0(11, 9)), new Date(at(11, 12)))).toBe(at(11, 12) - day0(11, 9));
    expect(periodOffset(at(11, 12), at(11, 12))).toBe(0);
    expect(periodOffset(null, at(11, 12))).toBe(0);
    expect(periodOffset(at(11, 13), at(11, 12))).toBeNull();
    expect(isMultiDayPeriod(t)).toBe(true);
    expect(isMultiDayPeriod(period(at(11, 10, 14, 0), at(11, 10, 17, 0)))).toBe(false);
    expect(isMultiDayPeriod(row({ due_date: at(11, 12) }))).toBe(false);
  });

  test("a start at 00:00 has no chosen time", () => {
    expect(hasStartTime(day0(11, 9))).toBe(false);
    expect(hasStartTime(at(11, 9, 0, 30))).toBe(true);
    expect(hasStartTime(at(11, 9, 9, 0))).toBe(true);
  });

  test("status: before the start, running, ended, with the durations", () => {
    const before = periodStatus(period(at(11, 10, 14, 0), at(11, 10, 17, 0)), NOW);
    expect(before).toMatchObject({ state: "before", untilStart: 40 * 60e3, untilEnd: 3 * H + 40 * 60e3, sinceEnd: 0, elapsed: 0, progress: 0 });
    const running = periodStatus(period(day0(11, 9), at(11, 12)), NOW);
    expect(running.state).toBe("running");
    expect(running.untilStart).toBe(0);
    expect(running.untilEnd).toBe(at(11, 12) - NOW);
    expect(running.elapsed).toBe(NOW - day0(11, 9));
    expect(running.progress).toBeCloseTo((NOW - day0(11, 9)) / (at(11, 12) - day0(11, 9)));
    const ended = periodStatus(period(day0(11, 5), at(11, 9, 12, 0)), NOW);
    expect(ended).toMatchObject({ state: "ended", untilEnd: 0, sinceEnd: NOW - at(11, 9, 12, 0), progress: 1 });
    expect(periodStatus(row({ due_date: at(11, 12) }), NOW)).toBeNull();
    // The start and the end themselves count as running.
    expect(periodStatus(period(NOW, NOW + H), NOW).state).toBe("running");
    expect(periodStatus(period(NOW - H, NOW), NOW).state).toBe("running");
  });

  test("covering a day: every day from the start's to the end's; a due alone covers its day", () => {
    const t = period(day0(11, 9), at(11, 12));
    expect([8, 9, 10, 11, 12, 13].map((d) => periodCoversDay(t, at(11, d, 12, 0)))).toEqual([false, true, true, true, true, false]);
    const due = row({ due_date: at(11, 12, 18, 0) });
    expect([11, 12, 13].map((d) => periodCoversDay(due, day0(11, d)))).toEqual([false, true, false]);
    expect(periodCoversDay(row({}), NOW)).toBe(false);
    // Over a month and a year end.
    const wrap = period(day0(12, 30), new Date(2027, 0, 2, 23, 59, 59).getTime());
    expect(periodCoversDay(wrap, new Date(2027, 0, 1).getTime())).toBe(true);
  });

  test("started by today and not over (shown in 오늘)", () => {
    expect(periodStartedBy(period(day0(11, 9), at(11, 12)), NOW)).toBe(true);
    expect(periodStartedBy(period(at(11, 10, 18, 0), at(11, 12)), NOW)).toBe(true);
    expect(periodStartedBy(period(day0(11, 11), at(11, 12)), NOW)).toBe(false);
    expect(periodStartedBy(period(day0(11, 5), at(11, 9, 12, 0)), NOW)).toBe(false);
    expect(periodStartedBy(row({ due_date: at(11, 12) }), NOW)).toBe(false);
  });
});

describe("alerts", () => {
  // The mock's settings: 끝 10분 전 and 정각, 시작 10분 전.
  const S = { enabled: true, before: true, minutes: 10, due: true, startBefore: true, startMinutes: 10, startAt: false };
  const sides = (t, s = S) => taskAlerts(t, s).map((a) => [a.side, a.mode, alertsLabel(a.alerts), a.alertable]);

  test("normal settings fill in the defaults", () => {
    expect(normalAlertSettings(undefined)).toEqual(DEFAULT_ALERT_SETTINGS);
    expect(normalAlertSettings({ enabled: true, before: false, minutes: 30, due: true })).toEqual({ ...DEFAULT_ALERT_SETTINGS, before: false, minutes: 30, due: true });
    expect(normalAlertSettings({ startMinutes: 7, startAt: "y" })).toEqual(DEFAULT_ALERT_SETTINGS);
  });

  test("sides: none without a due, the end alone, start and end for a period", () => {
    expect(taskAlerts(row({}), S)).toEqual([]);
    expect(sides(row({ due_date: at(11, 12, 17, 0) }))).toEqual([["end", "follow", "10분 전, 정각", true]]);
    expect(sides(period(at(11, 12, 9, 0), at(11, 12, 17, 0)))).toEqual([["start", "follow", "10분 전", true], ["end", "follow", "10분 전, 정각", true]]);
    // Date-only sides cannot ring.
    expect(sides(period(day0(11, 9), at(11, 12))).map((x) => x[3])).toEqual([false, false]);
  });

  test("the times rung and the task's own choice", () => {
    const t = period(at(11, 12, 9, 0), at(11, 12, 17, 0), { alert_start: "off" });
    const [start, end] = taskAlerts(t, S);
    expect(start).toMatchObject({ mode: "off", direct: true, on: false, alerts: [], offBySettings: false });
    expect(end).toMatchObject({ mode: "follow", direct: false, on: true, time: at(11, 12, 17, 0) });
    expect(end.alerts).toEqual([{ kind: "before", minutes: 10, at: at(11, 12, 16, 50) }, { kind: "at", minutes: 0, at: at(11, 12, 17, 0) }]);
  });

  test("on with nothing on in the settings rings once N분 전; follow then says so", () => {
    const off = { ...S, before: false, due: false, startBefore: false, minutes: 30 };
    const [start, end] = taskAlerts(period(at(11, 12, 9, 0), at(11, 12, 17, 0), { alert_end: "on" }), off);
    expect(start).toMatchObject({ mode: "follow", on: false, offBySettings: true });
    expect(end).toMatchObject({ mode: "on", on: true, offBySettings: false });
    expect(end.alerts).toEqual([{ kind: "before", minutes: 30, at: at(11, 12, 16, 30) }]);
    // Reminders off entirely: the same.
    const [, all] = taskAlerts(period(at(11, 12, 9, 0), at(11, 12, 17, 0), { alert_end: "on" }), { ...S, enabled: false });
    expect(alertsLabel(all.alerts)).toBe("10분 전");
  });

  test("names", () => {
    expect(alertName({ kind: "before", minutes: 60 })).toBe("1시간 전");
    expect(alertName({ kind: "at", minutes: 0 })).toBe("정각");
    expect(alertsLabel([], " · ")).toBe("꺼짐");
    expect(alertsLabel([{ kind: "before", minutes: 5 }, { kind: "at", minutes: 0 }], " · ")).toBe("5분 전 · 정각");
  });
});
