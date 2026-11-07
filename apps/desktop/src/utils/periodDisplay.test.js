import Task from "objects/Task";
import { clockRange, periodChipText, periodLeft, periodProgress, periodRepeatName, periodText, startDetailText } from "./periodDisplay";

const at = (m, d, h = 0, min = 0, s = 0) => new Date(2026, m - 1, d, h, min, s).getTime();
const end = (m, d) => at(m, d, 23, 59, 59);
const NOW = at(11, 10, 13, 20); // Tue
const task = (start, due, extra = {}) => Object.assign(Task.fromEntity({ tid: "t", title: "x", due_date: due, start_offset: start === null ? 0 : due - start }), extra);

test("row text: days, or the clocks inside one day", () => {
  expect(periodText(task(at(11, 9), end(11, 12)))).toBe("11/9 ~ 11/12");
  expect(periodText(task(at(11, 9, 9), at(11, 13, 18)))).toBe("11/9 ~ 11/13");
  expect(periodText(task(at(11, 10, 14), at(11, 10, 17)))).toBe("오후 2시 ~ 5시");
  expect(periodText(task(at(11, 10, 11), at(11, 10, 13, 30)))).toBe("오전 11시 ~ 오후 1:30");
  expect(periodText(task(at(11, 10, 14), end(11, 10)))).toBe("오후 2시 ~ 하루 끝");
  expect(periodText(task(at(11, 10, 14), at(11, 10, 17)), "24")).toBe("14:00 ~ 17:00");
  expect(periodText(task(null, end(11, 12)))).toBe("");
  expect(clockRange(at(11, 10, 14), at(11, 10, 17), "12", true)).toBe("오후 2:00 ~ 5:00");
});

test("second line: N 뒤 시작, N 뒤 종료, N 지남 from the end", () => {
  expect(periodLeft(task(at(11, 10, 14), at(11, 10, 17)), NOW)).toEqual({ text: "40분 뒤 시작", tone: "soon" });
  expect(periodLeft(task(at(11, 9), end(11, 12)), NOW)).toEqual({ text: "2일 10시간 뒤 종료", tone: "" });
  expect(periodLeft(task(at(11, 5), at(11, 9, 12)), NOW)).toEqual({ text: "1일 1시간 지남", tone: "over" });
  expect(periodLeft(task(at(11, 9), end(11, 12)), NOW, "simple").text).toBe("2일 뒤 종료");
  expect(periodLeft(task(null, end(11, 12)), NOW)).toBeNull();
});

test("진행: days for several days, percent inside one, 완료 and 지남", () => {
  expect(periodProgress(task(at(11, 9), end(11, 12)), NOW)).toMatchObject({ label: "4일 중 2일째", over: false });
  const day = periodProgress(task(at(11, 10, 12), at(11, 10, 16)), NOW);
  expect(day).toMatchObject({ label: "33% · 2시간 40분 뒤 종료" });
  expect(day.progress).toBeCloseTo(1 / 3);
  expect(periodProgress(task(at(11, 10, 14), at(11, 10, 17)), NOW)).toEqual({ progress: 0, label: "40분 뒤 시작", over: false });
  expect(periodProgress(task(at(11, 5), at(11, 9, 12)), NOW)).toEqual({ progress: 1, label: "1일 1시간 지남", over: true });
  expect(periodProgress(task(at(11, 5), at(11, 9, 12)), NOW, true)).toEqual({ progress: 1, label: "완료", over: false });
});

test("detail start, weekly repeat of a period, quick-add chip", () => {
  expect(startDetailText(at(11, 9))).toBe("2026.11.09 · 하루 시작");
  expect(startDetailText(at(11, 9, 9))).toBe("2026.11.09 오전 9:00");
  const sprint = task(at(11, 9, 9), at(11, 13, 18));
  expect(periodRepeatName("week", sprint, at(11, 13, 18))).toBe("매주 · 월 ~ 금");
  expect(periodRepeatName("day", sprint, at(11, 13, 18))).toBe("매일");
  expect(periodRepeatName("week", task(null, at(11, 13, 18)), at(11, 13, 18))).toBe("매주 금요일");
  expect(periodChipText(at(11, 20), end(11, 23))).toBe("11/20 ~ 11/23");
  expect(periodChipText(at(11, 20, 14), at(11, 20, 17))).toBe("11/20 오후 2시 ~ 오후 5시");
  expect(periodChipText(at(11, 20, 14), at(11, 21, 9))).toBe("11/20 오후 2시 ~ 11/21 오전 9시");
});
