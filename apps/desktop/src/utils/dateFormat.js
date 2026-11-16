// Numeric dates (#111, 설정 > 일반 > 시간 표시): the separator, the year's digits and the zero
// padding, "28.03.01" by default. This year's dates leave the year out ("11.18"); a period with
// either end in another year shows it on both ends ("26.11.02 ~ 27.02.28"). Pure functions;
// `prefs` is any object with the pref keys (the prefs, timeDisplayOptions) or nothing.
export const DATE_SEPS = [".", "/"]; // 점 / 빗금
export const YEAR_DIGITS = [2, 4];

export function dateFormatOptions(prefs) {
  return {
    dateSep: DATE_SEPS.includes(prefs?.dateSep) ? prefs.dateSep : ".",
    yearDigits: prefs?.yearDigits === 4 ? 4 : 2,
    datePad: typeof prefs?.datePad === "boolean" ? prefs.datePad : true,
  };
}

const yearOf = (value) => new Date(value).getFullYear();
export const isOtherYear = (value, now) => yearOf(value) !== yearOf(now);

// "11.18"; with the year "28.03.01", "2028.03.01" or "28/3/1".
export function numericDate(value, withYear, prefs) {
  const { dateSep, yearDigits, datePad } = dateFormatOptions(prefs);
  const d = new Date(value), part = (n) => (datePad ? String(n).padStart(2, "0") : String(n));
  const monthDay = `${part(d.getMonth() + 1)}${dateSep}${part(d.getDate())}`;
  if (!withYear) return monthDay;
  const year = yearDigits === 4 ? String(d.getFullYear()) : String(d.getFullYear() % 100).padStart(2, "0");
  return `${year}${dateSep}${monthDay}`;
}

// The year only when it is not the year of `now`.
export const shortDate = (value, now, prefs) => numericDate(value, isOtherYear(value, now), prefs);

// A period writes the year on both ends when either end is not this year.
export const rangeHasYear = (start, end, now) => isOtherYear(start, now) || isOtherYear(end, now);
export function shortRange(start, end, now, prefs) {
  const withYear = rangeHasYear(start, end, now);
  return [numericDate(start, withYear, prefs), numericDate(end, withYear, prefs)];
}
export const shortRangeText = (start, end, now, prefs) => shortRange(start, end, now, prefs).join(" ~ ");

// The long form the app keeps elsewhere: "11월 18일", "2028년 3월 1일" in another year.
export function longDate(value, now) {
  const d = new Date(value);
  return `${isOtherYear(d, now) ? `${d.getFullYear()}년 ` : ""}${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// Examples for the settings: a date this year, one in another year and a period over the new
// year, as the setting would be with `patch`.
export function dateExamples(prefs, now, patch = {}) {
  const p = { ...dateFormatOptions(prefs), ...patch }, y = yearOf(now);
  return [
    shortDate(new Date(y, 10, 18), now, p),
    shortDate(new Date(y + 2, 2, 1), now, p),
    shortRangeText(new Date(y, 10, 2), new Date(y + 1, 1, 28), now, p),
  ].join(" · ");
}
