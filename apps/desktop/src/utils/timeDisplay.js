// Task time text for 설정 > 일반 > 시간 표시 (#101, #102).
// #102: the task line shows the due date on top and the remaining time below (optional).
// The old single choice (remaining time OR due) is only read to migrate saved prefs.
export const TIME_DISPLAYS = ["remain", "due"];
export const REMAIN_FORMATS = ["simple", "normal", "detailed", "all"];
// "group" (묶음 맞춤) words the due relative to the list's date groups; the default since #102.
export const DUE_FORMATS = ["group", "simple", "auto", "exact", "full"];

// Same unit lengths as fromRelativeTime in utils/Common.js (year = 365 days, month = 30 days).
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;
const UNITS = [[YEAR, "년"], [MONTH, "개월"], [DAY, "일"], [HOUR, "시간"], [MINUTE, "분"], [SECOND, "초"]];
const REMAIN_LAYERS = { simple: 1, normal: 2, detailed: 3, all: UNITS.length };
const WEEKDAYS = "일월화수목금토";

const pad = (n) => String(n).padStart(2, "0");

// From the largest non-zero unit, take `layers` units, then leave out the zero ones.
export function formatRemain(ms, format = "normal") {
  const layers = REMAIN_LAYERS[format] ?? REMAIN_LAYERS.normal;
  let rest = Math.abs(ms);
  const parts = [];
  for (const [size, unit] of UNITS) {
    const value = Math.floor(rest / size);
    rest -= value * size;
    if (parts.length === 0 && value === 0) continue;
    parts.push([value, unit]);
    if (parts.length >= layers) break;
  }
  const shown = parts.filter(([value]) => value > 0).map(([value, unit]) => value + unit);
  return `${shown.length ? shown.join(" ") : "0초"} ${ms < 0 ? "지남" : "남음"}`;
}

// Short "오후 2:45" / "14:45"; long "오후 3시 20분" / "15시 20분" (minute left out when 0).
export function formatClock(date, timeFormat = "12", long = false) {
  const h = date.getHours(), m = date.getMinutes();
  if (timeFormat === "24") return long ? `${h}시${m ? ` ${m}분` : ""}` : `${pad(h)}:${pad(m)}`;
  const half = h < 12 ? "오전" : "오후", h12 = h % 12 || 12;
  return long ? `${half} ${h12}시${m ? ` ${m}분` : ""}` : `${half} ${h12}:${pad(m)}`;
}

// Short clock for the list: "오후 9시" on the hour, "오후 8:30" otherwise; 24h is always "21:00".
export function formatClockShort(date, timeFormat = "12") {
  const h = date.getHours(), m = date.getMinutes();
  if (timeFormat === "24") return `${pad(h)}:${pad(m)}`;
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}${m ? `:${pad(m)}` : "시"}`;
}

// Minutes after midnight as a clock, e.g. the picker presets: 540 → "오전 9:00" / "09:00".
export function formatMinuteOfDay(minutes, timeFormat = "12", short = false) {
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return short ? formatClockShort(date, timeFormat) : formatClock(date, timeFormat);
}

// A stored due as ms, or null for none. Stored "no due" is 0 (also null or ""); renderer
// state may hold Date objects (#102).
export function dueMs(value) {
  if (value === null || value === undefined || value === "" || value === 0) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) && time > 0 ? time : null;
}

// A due date without a chosen time is stored at the end of the day (23:59).
export function hasDueTime(due) {
  const date = new Date(due);
  return !(date.getHours() === 23 && date.getMinutes() === 59);
}

// Detail panel: "2026.10.21 오후 5:30" / "2026.10.21 17:30".
export function formatDueDetail(due, timeFormat = "12") {
  const date = new Date(due);
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${formatClock(date, timeFormat)}`;
}

// Quick-add chip: "10월 21일 오후 8시", or just "10월 21일" when no time was chosen.
export function formatDueChip(due, timeFormat = "12") {
  const date = new Date(due);
  const day = `${date.getMonth() + 1}월 ${date.getDate()}일`;
  return hasDueTime(due) ? `${day} ${formatClockShort(date, timeFormat)}` : day;
}

// Calendar days from `now` to `date` in local time (DST-safe).
export function dayDifference(date, now) {
  const start = (value) => new Date(value).setHours(0, 0, 0, 0);
  return Math.round((start(date) - start(now)) / DAY);
}

export function formatDue(due, now, format = "group", timeFormat = "12") {
  const date = new Date(due);
  if (format === "group") {
    // 묶음 맞춤: the group heading already says the day, so today is the clock only.
    const days = dayDifference(date, now), clock = formatClockShort(date, timeFormat);
    if (days === 0) return clock;
    if (days === 1) return `내일 ${clock}`;
    if (days === -1) return `어제 ${clock}`;
    if (days > 1 && days < 7) return `${WEEKDAYS[date.getDay()]} ${clock}`;
    return `${date.getMonth() + 1}월 ${date.getDate()}일`;
  }
  const exact = `${pad(date.getFullYear() % 100)}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${formatClock(date, timeFormat)}`;
  if (format === "exact") return exact;
  if (format === "full")
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${formatClock(date, timeFormat, true)}`;
  const days = dayDifference(date, now);
  if (format === "simple") {
    const n = Math.abs(days), side = days < 0 ? "전" : "뒤";
    if (days === 0) return "오늘";
    if (n === 1) return days < 0 ? "어제" : "내일";
    if (n < 30) return `${n}일 ${side}`;
    if (n < 365) return `${Math.floor(n / 30)}개월 ${side}`;
    return `${Math.floor(n / 365)}년 ${side}`;
  }
  const word = { 0: "오늘", 1: "내일", "-1": "어제" }[days] ?? (days >= 2 && days <= 6 ? `${WEEKDAYS[date.getDay()]}요일` : null);
  return word ? `${word} ${formatClock(date, timeFormat, true)}` : exact;
}

// Prefs with unknown values fall back to the defaults. Prefs saved before #102 have no
// showRemain; their 기한 choice (timeDisplay "due") meant no remaining time.
export function timeDisplayOptions(prefs = {}) {
  const showRemain = typeof prefs.showRemain === "boolean" ? prefs.showRemain : prefs.timeDisplay !== "due";
  return {
    showRemain,
    // Single-text task lines that are not redesigned yet show the due when the remaining time is off.
    timeDisplay: showRemain ? "remain" : "due",
    remainFormat: REMAIN_FORMATS.includes(prefs.remainFormat) ? prefs.remainFormat : "normal",
    dueFormat: DUE_FORMATS.includes(prefs.dueFormat) ? prefs.dueFormat : "group",
    timeFormat: prefs.timeFormat === "24" ? "24" : "12",
  };
}

// One text for a task line: the remaining time, or the due when 남은 시간 보이기 is off.
export function formatTaskTime(due, now, options = {}) {
  const { timeDisplay, remainFormat, dueFormat, timeFormat } = timeDisplayOptions(options);
  const at = new Date(due).valueOf();
  if (timeDisplay === "due") return formatDue(at, now, dueFormat, timeFormat);
  return formatRemain(at - now, remainFormat);
}

// The two-line right column of a task row: due on top, remaining time below (null when off).
export function formatTaskTimes(due, now, options = {}) {
  const { showRemain, remainFormat, dueFormat, timeFormat } = timeDisplayOptions(options);
  const at = new Date(due).valueOf();
  return {
    due: formatDue(at, now, dueFormat, timeFormat),
    remain: showRemain ? formatRemain(at - now, remainFormat) : null,
    overdue: at < now,
  };
}

// Sample values shown next to each choice in the settings.
const REMAIN_SAMPLES = [3 * HOUR + 30 * MINUTE, DAY + 4 * HOUR + 12 * MINUTE + 8 * SECOND];
// Due samples sit on round times relative to today: [days from today, hour, minute].
const DUE_SAMPLES = [[0, 21, 0], [2, 19, 0], [9, 18, 0]];

// `kind` is "due" or "remain"; `today` is any time on the day the examples count from.
export function timeDisplayExamples(kind, format, today, timeFormat = "12") {
  if (kind === "remain") return REMAIN_SAMPLES.map((ms) => formatRemain(ms, format)).join(" · ");
  return DUE_SAMPLES
    .map(([days, hour, minute]) => {
      const date = new Date(today);
      date.setDate(date.getDate() + days);
      date.setHours(hour, minute, 0, 0);
      return formatDue(date.valueOf(), today, format, timeFormat);
    })
    .join(" · ");
}
