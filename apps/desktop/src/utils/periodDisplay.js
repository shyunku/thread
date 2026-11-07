// Texts for task periods (#109, docs/designs/pc-2.6.0-period-mock.html): the list row, the detail,
// the quick-add chip and the views. Pure functions; tasks are renderer Task objects.
import { hasStartTime, periodStatus, taskPeriod } from "./taskPeriod";
import { normalRepeat, repeatName } from "./repeatRule";
import { dayDifference, formatClock, formatClockShort, formatDueDetail, formatSpan, hasDueTime } from "./timeDisplay";

const WEEKDAYS = "일월화수목금토";
const pad = (n) => String(n).padStart(2, "0");

// "11/9".
export const monthDay = (value) => { const d = new Date(value); return `${d.getMonth() + 1}/${d.getDate()}`; };

// Two clocks of one day: "오후 2시 ~ 5시" (the second leaves out a 오전/오후 it shares), or
// "14:00 ~ 17:00". `long` uses the detail clock ("오후 2:00 ~ 5:00").
export function clockRange(start, end, timeFormat = "12", long = false) {
  const fmt = long ? formatClock : formatClockShort;
  const a = fmt(new Date(start), timeFormat), b = fmt(new Date(end), timeFormat);
  return timeFormat !== "24" && a.slice(0, 2) === b.slice(0, 2) ? `${a} ~ ${b.slice(3)}` : `${a} ~ ${b}`;
}

// The period of a row: "11/9 ~ 11/12"; inside one day "오후 2시 ~ 5시" ("오후 2시 ~ 하루 끝"),
// or the day alone when its start has no time. "" without a period.
export function periodText(task, timeFormat = "12") {
  const p = taskPeriod(task);
  if (!p) return "";
  if (dayDifference(p.end, p.start) !== 0) return `${monthDay(p.start)} ~ ${monthDay(p.end)}`;
  if (!hasStartTime(p.start)) return monthDay(p.end);
  if (!hasDueTime(p.end)) return `${formatClockShort(new Date(p.start), timeFormat)} ~ 하루 끝`;
  return clockRange(p.start, p.end, timeFormat);
}

// The line under it: "N 뒤 시작" before the start (tone "soon"), "N 뒤 종료" while it runs, "N 지남"
// after the end (counted from the end, tone "over"). null without a period.
export function periodLeft(task, now, remainFormat = "normal") {
  const st = periodStatus(task, now);
  if (!st) return null;
  if (st.state === "ended") return { text: `${formatSpan(st.sinceEnd, remainFormat)} 지남`, tone: "over" };
  if (st.state === "before") return { text: `${formatSpan(st.untilStart, remainFormat)} 뒤 시작`, tone: "soon" };
  return { text: `${formatSpan(st.untilEnd, remainFormat)} 뒤 종료`, tone: "" };
}

// The detail's 진행 row: { progress 0..1, label, over }. Inside one day "35% · 2시간 뒤 종료",
// over several days "4일 중 2일째". null without a period.
export function periodProgress(task, now, done = false) {
  const st = periodStatus(task, now);
  if (!st) return null;
  if (done) return { progress: 1, label: "완료", over: false };
  if (st.state === "before") return { progress: 0, label: `${formatSpan(st.untilStart)} 뒤 시작`, over: false };
  if (st.state === "ended") return { progress: 1, label: `${formatSpan(st.sinceEnd)} 지남`, over: true };
  const days = dayDifference(st.end, st.start);
  const label = days === 0
    ? `${Math.round(st.progress * 100)}% · ${formatSpan(st.untilEnd)} 뒤 종료`
    : `${days + 1}일 중 ${dayDifference(now, st.start) + 1}일째`;
  return { progress: st.progress, label, over: false };
}

// The detail's 시작 row: "2026.11.09 오후 2:00", or "2026.11.09 · 하루 시작" without a time.
export function startDetailText(start, timeFormat = "12") {
  if (hasStartTime(start)) return formatDueDetail(start, timeFormat);
  const d = new Date(start);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} · 하루 시작`;
}

// The repeat of a period: a weekly one names its weekdays ("매주 · 월 ~ 금"); the others as before.
export function periodRepeatName(period, task, anchor) {
  const p = taskPeriod(task);
  if (p && normalRepeat(period) === "week" && dayDifference(p.end, p.start) !== 0)
    return `매주 · ${WEEKDAYS[new Date(p.start).getDay()]} ~ ${WEEKDAYS[new Date(p.end).getDay()]}`;
  return repeatName(period, anchor);
}

// The quick-add chip of a period: "11/20 ~ 11/23", "11/20 오후 2시 ~ 5시", "11/20 오후 2시 ~ 11/21 오전 9시".
export function periodChipText(start, end, timeFormat = "12") {
  const s = hasStartTime(start) ? `${monthDay(start)} ${formatClockShort(new Date(start), timeFormat)}` : monthDay(start);
  const sameDay = dayDifference(end, start) === 0;
  const e = hasDueTime(end) ? `${sameDay ? "" : `${monthDay(end)} `}${formatClockShort(new Date(end), timeFormat)}` : monthDay(end);
  return `${s} ~ ${e}`;
}
