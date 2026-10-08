import type { Prefs } from '@/core/prefs';

// Task time text for the list rows (#101): time left ("1일 4시간 남음") or the due
// time ("내일 오후 3시"), per the 시간 표시 setting. Same rules as the desktop.
export type TimeDisplay = Pick<
  Prefs,
  'timeDisplay' | 'remainFormat' | 'dueFormat' | 'timeFormat'
>;
export type TimeText = { text: string; overdue: boolean };

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Same unit sizes as remainingText (a month is 30 days, a year 365).
const UNITS: [number, string][] = [
  [365 * DAY, '년'],
  [30 * DAY, '개월'],
  [DAY, '일'],
  [HOUR, '시간'],
  [MINUTE, '분'],
  [SECOND, '초'],
];
const LAYERS: Record<Prefs['remainFormat'], number> = {
  simple: 1,
  normal: 2,
  detailed: 3,
  all: UNITS.length,
};

// From the largest non-zero unit, take `layers` units; zero units are left out
// ("1시간 0분 5초" → 자세히 "1시간 5초", 보통 "1시간").
export function remainText(
  diff: number,
  format: Prefs['remainFormat'],
): TimeText {
  const layers = LAYERS[format];
  let rest = Math.abs(diff);
  const parts: string[] = [];
  let taken = 0;
  for (const [size, unit] of UNITS) {
    const value = Math.floor(rest / size);
    rest -= value * size;
    if (!taken && !value) continue;
    taken += 1;
    if (value) parts.push(`${value}${unit}`);
    if (taken >= layers) break;
  }
  return {
    text: `${parts.join(' ') || '0초'} ${diff < 0 ? '지남' : '남음'}`,
    overdue: diff < 0,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = '일월화수목금토';

// Short "오후 2:45" / "14:45"; long "오후 3시 20분" / "15시 20분", minutes left out at 0.
export function clockText(d: Date, timeFormat: '12' | '24', long: boolean) {
  const h = d.getHours();
  const m = d.getMinutes();
  if (timeFormat === '24')
    return long ? `${h}시${m ? ` ${m}분` : ''}` : `${pad(h)}:${pad(m)}`;
  const half = h < 12 ? '오전' : '오후';
  const h12 = h % 12 || 12;
  return long
    ? `${half} ${h12}시${m ? ` ${m}분` : ''}`
    : `${half} ${h12}:${pad(m)}`;
}

// Calendar days from b to a in local time (+1 = tomorrow).
export function dayDiff(a: number, b: number) {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  return Math.round((day(a) - day(b)) / DAY);
}

export function dueText(
  dueDate: number,
  now: number,
  format: Prefs['dueFormat'],
  timeFormat: '12' | '24',
): TimeText {
  const d = new Date(dueDate);
  const overdue = dueDate < now;
  const exact = `${pad(d.getFullYear() % 100)}.${pad(d.getMonth() + 1)}.${pad(
    d.getDate(),
  )} ${clockText(d, timeFormat, false)}`;
  if (format === 'exact') return { text: exact, overdue };
  if (format === 'full')
    return {
      text: `${d.getFullYear()}년 ${
        d.getMonth() + 1
      }월 ${d.getDate()}일 ${clockText(d, timeFormat, true)}`,
      overdue,
    };
  const days = dayDiff(dueDate, now);
  if (format === 'auto') {
    const word =
      days === 0
        ? '오늘'
        : days === 1
        ? '내일'
        : days === -1
        ? '어제'
        : days >= 2 && days <= 6
        ? `${WEEKDAYS[d.getDay()]}요일`
        : null;
    return {
      text: word ? `${word} ${clockText(d, timeFormat, true)}` : exact,
      overdue,
    };
  }
  const n = Math.abs(days);
  const side = days < 0 ? '전' : '뒤';
  const text =
    days === 0
      ? '오늘'
      : n === 1
      ? days < 0
        ? '어제'
        : '내일'
      : n < 30
      ? `${n}일 ${side}`
      : n < 365
      ? `${Math.floor(n / 30)}개월 ${side}`
      : `${Math.floor(n / 365)}년 ${side}`;
  return { text, overdue };
}

export function taskTimeText(
  dueDate: number | null,
  now: number,
  display: TimeDisplay,
): TimeText | null {
  if (dueDate == null) return null;
  return display.timeDisplay === 'due'
    ? dueText(dueDate, now, display.dueFormat, display.timeFormat)
    : remainText(dueDate - now, display.remainFormat);
}

// Delay until a list showing these due dates needs its next refresh. Every second
// while some row shows seconds; otherwise `base`, cut short when a row is about to
// start showing seconds. The 기한 texts change by minute or day only.
export function nextTick(
  dueDates: Iterable<number | null>,
  now: number,
  display: TimeDisplay,
  base: number,
) {
  if (display.timeDisplay === 'due') return base;
  const layers = LAYERS[display.remainFormat];
  // Seconds show while the largest unit is within `layers` of 초.
  const window =
    layers >= UNITS.length ? Infinity : UNITS[UNITS.length - 1 - layers][0];
  let delay = base;
  for (const due of dueDates) {
    if (due == null) continue;
    const diff = due - now;
    if (Math.abs(diff) < window) return SECOND;
    if (diff > 0) delay = Math.min(delay, diff - window + 1);
  }
  return delay;
}
