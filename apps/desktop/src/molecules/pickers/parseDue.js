// Parser for the date picker's text field (#106.7, docs/designs/pc-250-mock.html parseDue).
// parseDue(text, now, weekStart) returns
//   null                   for an empty text,
//   false                  when the text is not understood,
//   { day, minutes }       otherwise: day is a Date at midnight, minutes the minute of the day or
//                          null when the text has no time (the picker keeps its time setting).
// Times without 오전/오후 are taken as written ("3시" is 03:00, "15시" is 15:00).

const WEEKDAYS = "일월화수목금토";
const END_OF_DAY = 1439;
const HALF = "(오전|오후|아침|낮|저녁|밤|새벽)";
const REL_DAYS = { 오늘: 0, 금일: 0, 내일: 1, 낼: 1, 모레: 2, 낼모레: 2, 내일모레: 2, 글피: 3 };
const WORD_DAYS = { 하루: 1, 이틀: 2, 사흘: 3, 나흘: 4, 닷새: 5, 일주일: 7, 열흘: 10 };
const WEEK_WORDS = { 이번주: 0, 금주: 0, 다음주: 1, 담주: 1, 다다음주: 2 };

const midnight = (value) => { const d = new Date(value); d.setHours(0, 0, 0, 0); return d; };
const addDays = (value, n) => { const d = midnight(value); d.setDate(d.getDate() + n); return d; };
// n months later, on `day` (or the same day), clamped to the month's last day.
const addMonths = (value, n, day) => {
  const d = new Date(value);
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day ?? d.getDate(), last));
  return x;
};
// The date, or null when it does not exist (2월 30일).
const validDate = (y, month, d) => {
  const x = new Date(y, month, d);
  return x.getFullYear() === y && x.getMonth() === month && x.getDate() === d ? x : null;
};

// Minute of the day for an hour and minute, with an optional 오전/오후-like word; null if invalid.
function toMinutes(half, hour, minute) {
  let h = +hour;
  const m = minute == null || minute === "" ? 0 : +minute;
  if (m > 59) return null;
  if (half) {
    // "오후 15시": a 24-hour hour after a PM word is still fine.
    if (h > 12) return /오후|저녁|밤|낮/.test(half) && h < 24 ? h * 60 + m : null;
    // "밤 12시" means the end of that day.
    if (half === "밤" && h === 12) return m ? null : END_OF_DAY;
    const pm = /오후|저녁|밤/.test(half) || (half === "낮" && h < 7);
    h = pm ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
  } else if (h > 23) return null;
  return h * 60 + m;
}

// The day in a text with the time already taken out: a Date, "none" for an empty text, or null.
function parseDay(text, today, weekStart) {
  const z = text.replace(/\s+/g, "");
  if (!z) return "none";
  if (z in REL_DAYS) return addDays(today, REL_DAYS[z]);
  let m;
  if ((m = z.match(/^(\d{1,3})(일|주|달|개월)(뒤|후)$/))) {
    const n = +m[1];
    return m[2] === "일" ? addDays(today, n) : m[2] === "주" ? addDays(today, 7 * n) : addMonths(today, n);
  }
  if ((m = z.match(/^(하루|이틀|사흘|나흘|닷새|일주일|열흘)(뒤|후)$/))) return addDays(today, WORD_DAYS[m[1]]);
  if ((m = z.match(/^한?(달|주)(뒤|후)$/))) return m[1] === "달" ? addMonths(today, 1) : addDays(today, 7);

  // The first day of the week n weeks from this one, by the app's week start.
  const weekFirst = (n) => addDays(today, -((today.getDay() - weekStart + 7) % 7) + 7 * n);
  // A bare "일" is left out: it reads as a day of the month, not Sunday.
  if ((m = z.match(/^(이번주|금주|다음주|담주|다다음주)?(주말|월|화|수|목|금|토|일)(요일)?$/)) && !(m[2] === "일" && !m[3])) {
    const wd = m[2] === "주말" ? 6 : WEEKDAYS.indexOf(m[2]);
    if (!m[1]) {
      // A weekday alone is the next one after today (today's weekday means next week).
      let diff = (wd - today.getDay() + 7) % 7;
      if (diff === 0 && m[2] !== "주말") diff = 7;
      return addDays(today, diff);
    }
    return addDays(weekFirst(WEEK_WORDS[m[1]]), (wd - weekStart + 7) % 7);
  }
  // "다음 주" alone is that week's Monday.
  if ((m = z.match(/^(다음주|담주|다다음주)$/))) return addDays(weekFirst(WEEK_WORDS[m[1]]), (1 - weekStart + 7) % 7);
  if ((m = z.match(/^(이번달|다음달|담달)(\d{1,2})일$/))) {
    const base = addMonths(today, m[1] === "이번달" ? 0 : 1, 1);
    return validDate(base.getFullYear(), base.getMonth(), +m[2]);
  }
  if ((m = z.match(/^(이번달|다음달|담달)?(말|월말)$/))) {
    const base = addMonths(today, m[1] && m[1] !== "이번달" ? 1 : 0, 1);
    return new Date(base.getFullYear(), base.getMonth() + 1, 0);
  }
  // 2026-11-30, 26.11.30, 26년 11월 30일, 11/20, 11.30, 11월 20일.
  if ((m = z.match(/^(?:(\d{4}|\d{2})[년./-])?(\d{1,2})(?:월|[./-])(\d{1,2})일?\.?$/))) {
    const y = m[1] ? (m[1].length === 2 ? 2000 + +m[1] : +m[1]) : today.getFullYear();
    let d = validDate(y, +m[2] - 1, +m[3]);
    // Without a year, a day already past is next year's.
    if (d && !m[1] && d < today) d = validDate(y + 1, +m[2] - 1, +m[3]);
    return d;
  }
  // 261130 (YYMMDD) and 20261130 (YYYYMMDD), #107.
  if ((m = z.match(/^(\d{2}|\d{4})(\d{2})(\d{2})$/))) {
    const y = m[1].length === 2 ? 2000 + +m[1] : +m[1];
    return validDate(y, +m[2] - 1, +m[3]);
  }
  // "25일": this month's, or next month's when already past (or missing this month).
  if ((m = z.match(/^(\d{1,2})일$/))) {
    let d = validDate(today.getFullYear(), today.getMonth(), +m[1]);
    if (!d || d < today) {
      const next = addMonths(today, 1, 1);
      d = validDate(next.getFullYear(), next.getMonth(), +m[1]);
    }
    return d;
  }
  return null;
}

export default function parseDue(raw, now = Date.now(), weekStart = 0) {
  let t = String(raw ?? "").trim().replace(/\s+/g, " ").replace(/\s*(까지|에|쯤)$/, "").trim();
  if (!t) return null;
  const nowDate = new Date(now), today = midnight(nowDate);
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
  const ws = weekStart === 1 ? 1 : 0;

  // "2시간 뒤", "30분 후": from now, with the time.
  let m = t.match(/^(\d{1,3})\s*(시간|분)\s*(뒤|후)$/);
  if (m) {
    const d = new Date(nowDate.getTime() + +m[1] * (m[2] === "시간" ? 3600e3 : 60e3));
    return { day: midnight(d), minutes: d.getHours() * 60 + d.getMinutes() };
  }

  // Take the time out first, then read the rest as the day.
  let minutes = null;
  const cut = (match) => { t = `${t.slice(0, match.index)} ${t.slice(match.index + match[0].length)}`.trim(); };
  if ((m = t.match(/정오/))) { minutes = 720; cut(m); }
  else if ((m = t.match(new RegExp(`${HALF}\\s*(\\d{1,2})(?:\\s*(?::\\s*(\\d{2})|시(?!간)\\s*(?:(\\d{1,2})\\s*분|(반))?))?`)))) {
    minutes = toMinutes(m[1], m[2], m[3] ?? m[4] ?? (m[5] ? 30 : 0));
    if (minutes === null) return false;
    cut(m);
  } else if ((m = t.match(/(\d{1,2})\s*(?::\s*(\d{2})|시(?!간)\s*(?:(\d{1,2})\s*분|(반))?)/))) {
    minutes = toMinutes(null, m[1], m[2] ?? m[3] ?? (m[4] ? 30 : 0));
    if (minutes === null) return false;
    cut(m);
  }

  let day = parseDay(t, today, ws);
  if (day === null && minutes === null && (m = t.match(/^(.*\S)\s+(\d{1,2})$/))) {
    // "내일 3": a bare number after a day is the hour.
    const d = parseDay(m[1], today, ws), hour = toMinutes(null, m[2], 0);
    if (d && d !== "none" && hour !== null) { day = d; minutes = hour; }
  }
  if (!day) return false;
  if (day === "none") {
    if (minutes === null) return false;
    // A time alone is today's, or tomorrow's once it has passed.
    day = minutes > nowMinutes ? today : addDays(today, 1);
  }
  return { day: midnight(day), minutes };
}
