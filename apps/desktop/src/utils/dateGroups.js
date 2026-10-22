// Calendar-week helpers and the list's date groups (#102). Pure functions; `weekStart` is the
// 주 시작 요일 pref (0 = Sunday, 1 = Monday) and `now` is any time on the current day.
import { dayDifference } from "./timeDisplay";

const WEEKDAYS = "일월화수목금토";
const startOfDay = (value) => { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; };
const addDays = (value, days) => { const date = startOfDay(value); date.setDate(date.getDate() + days); return date; };
const normalWeekStart = (weekStart) => (weekStart === 1 ? 1 : 0);

// Weekday numbers (0 = Sunday) in display order.
export function weekdayOrder(weekStart = 0) {
  const start = normalWeekStart(weekStart);
  return [0, 1, 2, 3, 4, 5, 6].map((i) => (i + start) % 7);
}

// Midnight of the first day of the calendar week that contains `date`.
export function startOfWeek(date, weekStart = 0) {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() - normalWeekStart(weekStart) + 7) % 7));
}

// First cell of a month grid: the week start on or before the 1st of `month` (0-11).
export function monthGridStart(year, month, weekStart = 0) {
  return startOfWeek(new Date(year, month, 1), weekStart);
}

// Days left in this calendar week after today (0 on its last day).
export function daysLeftInWeek(now, weekStart = 0) {
  return 6 - ((new Date(now).getDay() - normalWeekStart(weekStart) + 7) % 7);
}

// The list's date groups in display order. 완료됨 holds every done task of the view.
export const DATE_GROUPS = Object.freeze([
  { id: "over", name: "기한 지남" },
  { id: "today", name: "오늘" },
  { id: "tomorrow", name: "내일" },
  { id: "week", name: "이번 주" }, // the rest of this calendar week
  { id: "next", name: "다음 주" }, // the 7 days after that
  { id: "later", name: "나중에" },
  { id: "none", name: "기한 없음" },
  { id: "done", name: "완료됨" },
]);
export const DATE_GROUP_IDS = Object.freeze(DATE_GROUPS.map((group) => group.id));

// The date group of an open task by its due (null/undefined = no due). Done tasks go to
// "done" regardless; the caller decides that.
export function dateGroupOf(due, now, weekStart = 0) {
  if (due === null || due === undefined || due === "") return "none";
  const days = dayDifference(new Date(due), now);
  if (days < 0) return "over";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  const left = daysLeftInWeek(now, weekStart);
  if (days <= left) return "week";
  if (days <= left + 7) return "next";
  return "later";
}

// "10월 24일 (토)", used for the quick-day tooltips.
export function dayLabel(date) {
  const d = new Date(date);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

// The date picker's quick days. 이번 주 토요일 is left out when it is today or tomorrow, or
// when this calendar week has no Saturday left (Monday start on a Sunday).
// 다음 주 월요일 is the Monday of the next calendar week, left out when it is tomorrow.
export function quickDays(now, weekStart = 0) {
  const today = new Date(now).getDay(), left = daysLeftInWeek(now, weekStart);
  const saturday = (6 - today + 7) % 7;
  const monday = left + 1 + ((1 - normalWeekStart(weekStart) + 7) % 7);
  const days = [
    { id: "today", label: "오늘", offset: 0 },
    { id: "tomorrow", label: "내일", offset: 1 },
    ...(saturday > 1 && saturday <= left ? [{ id: "saturday", label: "이번 주 토요일", offset: saturday }] : []),
    ...(monday > 1 ? [{ id: "monday", label: "다음 주 월요일", offset: monday }] : []),
  ];
  return days.map((day) => {
    const date = addDays(now, day.offset);
    return { ...day, date, tip: dayLabel(date) };
  });
}
