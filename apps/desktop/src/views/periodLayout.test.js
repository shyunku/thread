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
  // The mock's week of 11/8 (#109 "하루짜리로 채움"): bars stay on their lane all week; a day's
  // one-day items fill the lines no bar uses, an emptied lane too.
  const week = () => [
    task("move", at(10, 26), end(11, 20)),
    task("booth", at(11, 5), at(11, 9, 12)),
    task("sprint", at(11, 9, 9), at(11, 13, 18)),
    task("launch", at(11, 9), end(11, 12)),
    task("meet", at(11, 10, 14), at(11, 10, 17)),
    task("shop", null, at(11, 10, 20)),
    task("words", null, at(11, 10, 22)),
    task("tax", null, end(11, 13)),
  ];
  const ids = (rows) => rows.map((t) => t && t.id);

  test("items fill the free lines; bars stay straight; …외 N개 counts hidden bars and items", () => {
    const { days, bars } = weekLayout(week(), WEEK, 3);
    // 11/10: 이사 준비 / 팀 워크숍 / …외 4개 (two bars and two items hidden).
    expect(days[2]).toMatchObject({ more: 4, count: 6, shown: 2, limit: 2 });
    expect(ids(days[2].rows)).toEqual([null, "meet"]);
    // 11/13: 이사 준비 / 세금 납부 (in the lane 전시회 left) / 주간 스프린트.
    expect(days[5]).toMatchObject({ more: 0, count: 3, limit: 3 });
    expect(ids(days[5].rows)).toEqual([null, "tax", null]);
    expect(bars.map((b) => [b.task.id, b.from, b.to, b.lane, b.contL, b.contR, b.endTime])).toEqual([
      ["move", 0, 6, 0, true, true, false],
      ["booth", 0, 1, 1, true, false, true],
      ["sprint", 5, 5, 2, true, false, false],
    ]);
  });

  test("roomy cells keep three lines; one line shows 할 일 N개 only", () => {
    const roomy = weekLayout(week(), WEEK).days[2];
    expect(roomy).toMatchObject({ more: 3, limit: 3 });
    expect(ids(roomy.rows)).toEqual([null, "meet", null]);
    const tiny = weekLayout(week(), WEEK, 1).days[2];
    expect(tiny).toMatchObject({ rows: [], more: 6, shown: 0 });
  });

  test("a day without bars lists its items from the top; an empty day has no lines", () => {
    const { days } = weekLayout([task("x", null, at(11, 10, 9)), task("y", null, at(11, 10, 10))], WEEK);
    expect(ids(days[2].rows)).toEqual(["x", "y"]);
    expect(days[3]).toMatchObject({ rows: [], more: 0, count: 0 });
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
