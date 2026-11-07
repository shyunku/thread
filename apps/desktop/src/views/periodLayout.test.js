import Task from "objects/Task";
import { weekLayout } from "./TaskCalendarView";
import { blockTimeText, hourGroups } from "./TaskTimelineView";
import { barStyle, periodLanes } from "./viewParts";

jest.mock("react-redux", () => ({ useSelector: () => ({}) }));

// #109: the calendar's bars and the timeline's blocks and band.
const at = (m, d, h = 0, min = 0, s = 0) => new Date(2026, m - 1, d, h, min, s).getTime();
const end = (m, d) => at(m, d, 23, 59, 59);
const task = (id, start, due, extra = {}) =>
  Object.assign(Task.fromEntity({ tid: id, title: id, due_date: due, start_offset: start === null ? 0 : due - start }), extra);
const WEEK = at(11, 8); // Sun 11/8 – Sat 11/14

describe("periodLanes", () => {
  test("earlier starts first, then longer ones; a lane is reused once free", () => {
    const tasks = [
      task("short", at(11, 9), end(11, 10)),
      task("long", at(11, 9), end(11, 13)),
      task("after", at(11, 11), end(11, 12)),
      task("before", at(10, 26), end(11, 8)),
      task("one-day", at(11, 9, 9), at(11, 9, 17)),
      task("due", null, end(11, 9)),
    ];
    const { segs, lanes } = periodLanes(tasks, WEEK, 7);
    expect(segs.map((g) => [g.task.id, g.a, g.b, g.lane])).toEqual([
      ["before", 0, 0, 0], ["long", 1, 5, 0], ["short", 1, 2, 1], ["after", 3, 4, 1],
    ]);
    expect(lanes).toBe(2);
  });
});

describe("calendar weekLayout", () => {
  test("bars keep lanes open in the cells; one-day tasks are items; runs and continuation", () => {
    const tasks = [
      task("move", at(10, 26), end(11, 20)),
      task("sprint", at(11, 9, 9), at(11, 13, 18)),
      task("meet", at(11, 10, 14), at(11, 10, 17)),
      task("tax", null, end(11, 13)),
    ];
    const { days, bars } = weekLayout(tasks, WEEK);
    expect(days.map((d) => d.lanes)).toEqual([1, 2, 2, 2, 2, 2, 1]);
    expect(days[2].items.map((t) => t.id)).toEqual(["meet"]);
    expect(days[5].items.map((t) => t.id)).toEqual(["tax"]);
    expect(bars.map((b) => [b.task.id, b.from, b.to, b.lane, b.contL, b.contR, b.endTime])).toEqual([
      ["move", 0, 6, 0, true, true, false],
      ["sprint", 1, 5, 1, false, false, true],
    ]);
  });

  test("short cells: lanes, then items, then …외 N개 (a hidden lane counts)", () => {
    const tasks = [
      task("a", at(11, 8), end(11, 14)),
      task("b", at(11, 9), end(11, 11)),
      task("x", null, at(11, 10, 9)),
      task("y", null, at(11, 10, 10)),
    ];
    // Two lines: one for a bar, one for "…외 N개".
    const { days, bars } = weekLayout(tasks, WEEK, 2);
    expect(days[2]).toMatchObject({ lanes: 1, more: 3, count: 4 });
    expect(days[2].items).toEqual([]);
    expect(days[0]).toMatchObject({ lanes: 1, more: 0 });
    // The lane-1 bar is left out where its lane is not kept.
    expect(bars.map((b) => [b.task.id, b.from, b.to])).toEqual([["a", 0, 6], ["b", 1, 1], ["b", 3, 3]]);
    // Room for three: two lanes and one item, then the rest.
    const roomy = weekLayout(tasks, WEEK, 4).days[2];
    expect(roomy).toMatchObject({ lanes: 2, more: 1 });
    expect(roomy.items.map((t) => t.id)).toEqual(["x"]);
  });

  test("a bar hidden on some days is drawn in runs", () => {
    const tasks = [
      task("a", at(11, 8), end(11, 14)),
      task("b", at(11, 8), end(11, 12)),
      task("x", null, at(11, 10, 9)),
      task("y", null, at(11, 10, 10)),
    ];
    const { bars } = weekLayout(tasks, WEEK, 2);
    expect(bars.filter((b) => b.task.id === "b").map((b) => [b.from, b.to, b.contL, b.contR])).toEqual([[0, 1, false, true], [3, 4, true, false]]);
  });

  test("bar colours: the category mixed in, grey when done", () => {
    expect(barStyle({ color: "#4fc3d9" }, false, [16, 18, 22])).toEqual({ background: "rgb(32,64,73)", boxShadow: "inset 3px 0 0 #4fc3d9" });
    expect(barStyle(null, true)).toEqual({ background: "#20252e", boxShadow: "inset 3px 0 0 #4d5666" });
  });
});

describe("timeline", () => {
  test("a period inside the day is a block of its own at its start's hour", () => {
    const tasks = [
      task("shop", null, at(11, 10, 14, 30)),
      task("meet", at(11, 10, 14), at(11, 10, 17)),
      task("call", null, at(11, 10, 14, 45)),
      task("night", null, end(11, 10)),
    ];
    expect(hourGroups(tasks).map((g) => [g.hour, g.block, g.tasks.map((t) => t.id)])).toEqual([
      [14, true, ["meet"]], [14, false, ["shop", "call"]], [24, false, ["night"]],
    ]);
    expect(blockTimeText(tasks[1])).toBe("오후 2:00 ~ 5:00 · 3시간");
    expect(blockTimeText(task("late", at(11, 10, 21, 30), end(11, 10)))).toBe("오후 9:30 ~ 하루 끝 · 2시간 29분");
  });

  test("the band spans the shown columns", () => {
    const { segs } = periodLanes([task("move", at(10, 26), end(11, 20)), task("trip", at(11, 11), end(11, 14))], at(11, 10), 2);
    expect(segs.map((g) => [g.task.id, g.a, g.b, g.lane])).toEqual([["move", 0, 1, 0], ["trip", 1, 1, 1]]);
  });
});
