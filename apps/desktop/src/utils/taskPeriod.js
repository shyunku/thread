import { dueMs, hasDueTime } from "./timeDisplay";

// Task periods (#109): a task's start is start_offset ms before its due (the end). A start
// without a chosen time is 00:00 (하루 시작); an end without one 23:59 (하루 끝). Tasks are the
// renderer's Task objects (dueDate: Date or ms, startOffset, alertStart, alertEnd) or rows
// with the stored names (due_date, start_offset, alert_start, alert_end).

const startOfDay = (value) => new Date(value).setHours(0, 0, 0, 0);
const dueOf = (task) => dueMs(task?.dueDate ?? task?.due_date);
const offsetOf = (task) => task?.startOffset ?? task?.start_offset;

// A start (ms) without a chosen time is stored at 00:00.
export function hasStartTime(start) {
  const date = new Date(start);
  return !(date.getHours() === 0 && date.getMinutes() === 0);
}

// The start as ms, or null when the task has no period.
export function taskStart(task) {
  const due = dueOf(task), offset = offsetOf(task);
  return due !== null && Number.isSafeInteger(offset) && offset > 0 && offset < due ? due - offset : null;
}

// { start, end } in ms, or null without a period.
export function taskPeriod(task) {
  const start = taskStart(task);
  return start === null ? null : { start, end: dueOf(task) };
}

// The start_offset for a start and an end (ms or Date): 0 for none or equal times, null when
// the start is after the end (not allowed).
export function periodOffset(start, end) {
  const s = dueMs(start), e = dueMs(end);
  if (s === null || e === null || s === e) return 0;
  return s < e ? e - s : null;
}

// Whether the period spans more than one calendar day.
export function isMultiDayPeriod(task) {
  const p = taskPeriod(task);
  return !!p && startOfDay(p.start) !== startOfDay(p.end);
}

// Where a period stands at `now`: { state, start, end, untilStart, untilEnd, sinceEnd, elapsed,
// progress }, or null without a period. state is "before" (N 뒤 시작), "running" (N 뒤 종료)
// or "ended" (N 지남, counted from the end). Durations are ms (0 when they do not apply);
// progress is 0..1 of the period gone by.
export function periodStatus(task, now = Date.now()) {
  const p = taskPeriod(task);
  if (!p) return null;
  const { start, end } = p;
  const state = now < start ? "before" : now <= end ? "running" : "ended";
  return {
    state, start, end,
    untilStart: Math.max(0, start - now),
    untilEnd: Math.max(0, end - now),
    sinceEnd: Math.max(0, now - end),
    elapsed: Math.max(0, Math.min(now, end) - start),
    progress: Math.min(1, Math.max(0, (now - start) / (end - start))),
  };
}

// Whether a task's period (or, without one, its due) falls on the day of `day`.
export function periodCoversDay(task, day) {
  const end = dueOf(task);
  if (end === null) return false;
  const d = startOfDay(day), start = taskStart(task) ?? end;
  return startOfDay(start) <= d && d <= startOfDay(end);
}

// Started by today (the start's day is today or earlier) and not over yet: such a period shows in
// 오늘 until it ends (the mock's rule).
export function periodStartedBy(task, now = Date.now()) {
  const p = taskPeriod(task);
  return !!p && startOfDay(p.start) <= startOfDay(now) && p.end >= now;
}

/* ------------------------------ Alerts ------------------------------ */
// The same rules as packages/e2ee/src/model/reminders.js (planReminders with periods), for the
// alert menu and the detail's bells. `settings` is main's reminders value (settings/get):
// { enabled, before, minutes, due, startBefore, startMinutes, startAt }.
const MINUTE_CHOICES = [5, 10, 15, 30, 60];
export const DEFAULT_ALERT_SETTINGS = Object.freeze({
  enabled: true, before: true, minutes: 10, due: false, startBefore: true, startMinutes: 10, startAt: false,
});
export function normalAlertSettings(value) {
  const v = value && typeof value === "object" ? value : {}, d = DEFAULT_ALERT_SETTINGS, out = {};
  for (const key of Object.keys(d))
    out[key] = key.endsWith("inutes") ? (MINUTE_CHOICES.includes(v[key]) ? v[key] : d[key]) : typeof v[key] === "boolean" ? v[key] : d[key];
  return out;
}
const span = (minutes) => (minutes === 60 ? "1시간" : `${minutes}분`);
const override = (value) => (value === "on" || value === "off" ? value : null);

// The alerts the settings ring for one side: [{ kind: "before" | "at", minutes }].
function settingsAlerts(side, s) {
  if (!s.enabled) return [];
  const before = side === "start" ? s.startBefore : s.before, at = side === "start" ? s.startAt : s.due;
  const minutes = side === "start" ? s.startMinutes : s.minutes;
  return [before && { kind: "before", minutes }, at && { kind: "at", minutes: 0 }].filter(Boolean);
}
// "10분 전" / "정각".
export const alertName = (alert) => (alert.kind === "at" ? "정각" : `${span(alert.minutes)} 전`);

// A task's alert sides, in the order shown ([] without a due; "start" only with a period):
// [{ side, time, alertable, mode, direct, on, alerts, offBySettings }]
// - time: the side's time (ms); alertable: it has a chosen time (date-only sides never ring);
// - mode: "follow" | "on" | "off" (the task's own choice); direct: mode is not "follow"
//   ("직접" vs "전체 설정");
// - alerts: what rings, [{ kind, minutes, at }] ("on" with nothing on in the settings rings once
//   N분 전); on: alerts is not empty; offBySettings: following settings that ring nothing.
export function taskAlerts(task, settings) {
  const end = dueOf(task);
  if (end === null) return [];
  const s = normalAlertSettings(settings), start = taskStart(task);
  const sides = start === null ? [["end", end]] : [["start", start], ["end", end]];
  return sides.map(([side, time]) => {
    const mode = override(side === "start" ? task.alertStart ?? task.alert_start : task.alertEnd ?? task.alert_end) ?? "follow";
    const alertable = side === "start" ? hasStartTime(time) : hasDueTime(time);
    const global = settingsAlerts(side, s), minutes = side === "start" ? s.startMinutes : s.minutes;
    const list = mode === "off" ? [] : mode === "on" && !global.length ? [{ kind: "before", minutes }] : global;
    const alerts = list.map((a) => ({ ...a, at: time - a.minutes * 60000 }));
    return {
      side, time, alertable, mode, direct: mode !== "follow", on: alerts.length > 0, alerts,
      offBySettings: mode === "follow" && !global.length,
    };
  });
}
// "10분 전, 정각", or "꺼짐".
export const alertsLabel = (alerts, separator = ", ") => (alerts.length ? alerts.map(alertName).join(separator) : "꺼짐");
