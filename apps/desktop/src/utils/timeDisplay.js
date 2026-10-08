// Task time text for 설정 > 일반 > 시간 표시 (#101): remaining time or due date.
export const TIME_DISPLAYS = ["remain", "due"];
export const REMAIN_FORMATS = ["simple", "normal", "detailed", "all"];
export const DUE_FORMATS = ["simple", "auto", "exact", "full"];

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

// Calendar days from `now` to `date` in local time (DST-safe).
export function dayDifference(date, now) {
  const start = (value) => new Date(value).setHours(0, 0, 0, 0);
  return Math.round((start(date) - start(now)) / DAY);
}

export function formatDue(due, now, format = "auto", timeFormat = "12") {
  const date = new Date(due);
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

// Prefs with unknown values fall back to the defaults.
export function timeDisplayOptions(prefs = {}) {
  return {
    timeDisplay: TIME_DISPLAYS.includes(prefs.timeDisplay) ? prefs.timeDisplay : "remain",
    remainFormat: REMAIN_FORMATS.includes(prefs.remainFormat) ? prefs.remainFormat : "normal",
    dueFormat: DUE_FORMATS.includes(prefs.dueFormat) ? prefs.dueFormat : "auto",
    timeFormat: prefs.timeFormat === "24" ? "24" : "12",
  };
}

export function formatTaskTime(due, now, options = {}) {
  const { timeDisplay, remainFormat, dueFormat, timeFormat } = timeDisplayOptions(options);
  const at = new Date(due).valueOf();
  if (timeDisplay === "due") return formatDue(at, now, dueFormat, timeFormat);
  return formatRemain(at - now, remainFormat);
}

// Sample values shown next to each choice in the settings.
const REMAIN_SAMPLES = [DAY + 4 * HOUR + 12 * MINUTE + 8 * SECOND, MONTH + 4 * DAY + 23 * HOUR + 2 * MINUTE + 8 * SECOND, HOUR + 5 * SECOND];
// Due samples sit on round times relative to today: [days from today, hour, minute].
const DUE_SAMPLES = {
  simple: [[0, 15, 20], [1, 17, 30], [-2, 12, 0], [10, 12, 0], [95, 12, 0], [5 * 365 + 3, 12, 0]],
  auto: [[0, 15, 20], [1, 17, 30], [2, 15, 0], [-1, 18, 0], [10, 14, 0]],
  exact: [[2, 14, 45], [1, 17, 30]],
  full: [[2, 14, 45], [1, 17, 30]],
};

export function timeDisplayExamples(timeDisplay, format, now, timeFormat = "12") {
  if (timeDisplay === "remain") return REMAIN_SAMPLES.map((ms) => formatRemain(ms, format)).join(" · ");
  return (DUE_SAMPLES[format] || DUE_SAMPLES.auto)
    .map(([days, hour, minute]) => {
      const date = new Date(now);
      date.setDate(date.getDate() + days);
      date.setHours(hour, minute, 0, 0);
      return formatDue(date.valueOf(), now, format, timeFormat);
    })
    .join(" · ");
}
