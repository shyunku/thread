import { render } from "@testing-library/react";
import Task from "../../objects/Task";
import { DayList, dayTime } from "./CalendarTab";
import { PickedDayContext, startOfDay } from "./pickedDay";

// The picked day's list (#111 mock "맨 오른쪽 + 작은 시각"). Synthetic tasks; now is Mon 2026-11-16 13:20.
const NOW = new Date(2026, 10, 16, 13, 20).getTime();
const at = (m, d, h = 23, mi = h === 23 ? 59 : 0) => new Date(2026, m - 1, d, h, mi, h === 23 && mi === 59 ? 59 : 0).getTime();
const day0 = (m, d) => new Date(2026, m - 1, d).getTime();
function task(id, title, end, start = null, extra = {}) {
  const t = new Task(title, new Date(end));
  t.id = id;
  t.startOffset = start === null ? 0 : end - start;
  return Object.assign(t, extra);
}

describe("dayTime", () => {
  const tm = (t, day, prefs) => dayTime(t, day, NOW, "12", prefs);

  test("a due, a period inside the day, a period's last day, a day before its end", () => {
    expect(tm(task("a", "a", at(11, 18, 9)), day0(11, 18))).toEqual({ text: "오전 9시", tone: "" });
    expect(tm(task("a", "a", at(11, 18)), day0(11, 18)).text).toBe("하루 끝");
    expect(tm(task("b", "b", at(11, 18, 21), at(11, 18, 19)), day0(11, 18)).text).toBe("오후 7시 ~ 9시");
    expect(tm(task("b", "b", at(11, 18), at(11, 18, 19)), day0(11, 18)).text).toBe("오후 7시 ~ 하루 끝");
    const visit = task("c", "c", at(11, 20, 18), at(11, 18, 10));
    expect(tm(visit, day0(11, 18)).text).toBe("~11.20");
    expect(tm(visit, day0(11, 19)).text).toBe("~11.20");
    expect(tm(visit, day0(11, 20)).text).toBe("~오후 6시");
    expect(tm(task("d", "d", at(11, 20), day0(11, 19)), day0(11, 20)).text).toBe("~하루 끝");
    expect(dayTime(visit, day0(11, 18), NOW, "24").text).toBe("~11.20");
    expect(dayTime(visit, day0(11, 20), NOW, "24").text).toBe("~18:00");
  });

  test("the numeric date follows the setting, with the year in another year", () => {
    const long = task("e", "e", new Date(2027, 1, 28, 23, 59, 59).getTime(), day0(11, 2));
    expect(tm(long, day0(11, 18)).text).toBe("~27.02.28");
    expect(tm(long, day0(11, 18), { yearDigits: 4, dateSep: "/", datePad: false }).text).toBe("~2027/2/28");
    expect(tm(task("f", "f", at(11, 30, 18), day0(11, 2)), day0(11, 18), { dateSep: "/", datePad: false }).text).toBe("~11/30");
  });

  test("blue only while the period is on now; overdue red; done none", () => {
    expect(tm(task("r", "r", at(11, 16, 15), at(11, 16, 13)), day0(11, 16)).tone).toBe("run");
    expect(tm(task("r", "r", at(11, 20, 18), day0(11, 2)), day0(11, 18)).tone).toBe("run");
    expect(tm(task("s", "s", at(11, 18, 21), at(11, 18, 19)), day0(11, 18)).tone).toBe("");
    expect(tm(task("s", "s", at(11, 20, 18), at(11, 18, 10)), day0(11, 18)).tone).toBe("");
    expect(tm(task("o", "o", at(11, 16, 12), at(11, 16, 10)), day0(11, 16)).tone).toBe("over");
    expect(tm(task("o", "o", at(11, 16, 12)), day0(11, 16)).tone).toBe("over");
    expect(tm(task("d", "d", at(11, 16, 12), at(11, 16, 10), { done: true }), day0(11, 16)).tone).toBe("");
    expect(tm(task("d", "d", at(11, 16, 15), at(11, 16, 13), { done: true }), day0(11, 16)).tone).toBe("");
    // A due alone is never blue.
    expect(tm(task("n", "n", at(11, 16, 15)), day0(11, 16)).tone).toBe("");
  });

  test("a start at 0:00 (stored .001) shows its clock", () => {
    expect(tm(task("z", "z", at(11, 18, 3), day0(11, 18) + 1), day0(11, 18)).text).toBe("오전 12시 ~ 3시");
    expect(tm(task("z", "z", at(11, 18, 3), day0(11, 18)), day0(11, 18)).text).toBe("~오전 3시");
  });
});

describe("the list", () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
  afterEach(() => { jest.useRealTimers(); });

  const draw = (tasks, day, prefs = {}) => render(
    <PickedDayContext.Provider value={{ pickedDay: startOfDay(day), setPickedDay: () => {}, shownDays: 0, setShownDays: () => {} }}>
      <DayList tasks={tasks} catsOf={() => [{ id: "c", title: "업무", color: "#4fc3d9" }]} prefs={prefs} />
    </PickedDayContext.Provider>
  );

  test("dot and name on the left, the time last; texts and tones per row", () => {
    const tasks = {
      c4: task("c4", "부모님 댁 방문", at(11, 20, 18), at(11, 18, 10)),
      c5: task("c5", "분기 예산 검토 회의", at(11, 18, 13, 30), at(11, 18, 11, 30)),
      c1: task("c1", "저녁 약속", at(11, 18, 21), at(11, 18, 19)),
      z2: task("z2", "회의실 예약", at(11, 18, 9), null, { done: true }),
    };
    const { container } = draw(tasks, day0(11, 18));
    const rows = [...container.querySelectorAll(".rp-ai")];
    expect(rows.map((r) => r.dataset.taskId)).toEqual(["c4", "c5", "c1", "z2"]);
    expect([...rows[0].children].map((el) => el.className)).toEqual(["rp-dot", "rp-nm", "rp-tm"]);
    expect(rows.map((r) => r.querySelector(".rp-tm").textContent)).toEqual(["~11.20", "오전 11:30 ~ 오후 1:30", "오후 7시 ~ 9시", "오전 9시"]);
    expect(rows.every((r) => r.querySelector(".rp-tm").className === "rp-tm")).toBe(true);
    expect(rows[3]).toHaveClass("done");
  });

  test("the running period is blue, an overdue one red; the head has the year in another year", () => {
    const tasks = {
      run: task("run", "진행 중", at(11, 16, 15), at(11, 16, 13)),
      over: task("over", "지난 일", at(11, 16, 12)),
    };
    const { container } = draw(tasks, day0(11, 16));
    expect(container.querySelector('[data-task-id="run"] .rp-tm')).toHaveClass("run");
    expect(container.querySelector('[data-task-id="over"] .rp-tm')).toHaveClass("over");
    expect(container.querySelector(".rp-block-h")).toHaveTextContent("11월 16일 (월) · 오늘");
    const other = draw({}, new Date(2027, 11, 30).getTime());
    expect(other.container.querySelector(".rp-block-h")).toHaveTextContent("2027년 12월 30일 (목)");
  });
});
