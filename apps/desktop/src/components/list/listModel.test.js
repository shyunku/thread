import { highlightParts, listSections, memoSnippet, searchSections, storedOrder, taskSorter } from "./listModel";

const WED = new Date(2026, 9, 21, 14, 30); // Wednesday
const SAT = new Date(2026, 9, 24, 14, 30);
const SUN = new Date(2026, 9, 25, 14, 30);
const on = (base, days, h = 12, m = 0) => { const d = new Date(base); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };
let seq = 0;
const task = (title, dueDate, extra = {}) => ({ id: title, title, dueDate, done: false, memo: "", categories: {}, createdAt: new Date(2026, 9, 1, 0, seq++), ...extra });
const ids = (sections) => sections.map((s) => [s.id, s.tasks.map((t) => t.title)]);

test("date groups follow the calendar week by 주 시작 요일 (Sunday start, on a Wednesday)", () => {
  const tasks = [-2, 0, 1, 2, 3, 4, 10, 11].map((d) => task(`d${d}`, on(WED, d))).concat(task("none", null), task("done", on(WED, 0), { done: true }));
  expect(ids(listSections(tasks, { now: WED, weekStart: 0 }))).toEqual([
    ["over", ["d-2"]], ["today", ["d0"]], ["tomorrow", ["d1"]], ["week", ["d2", "d3"]], ["next", ["d4", "d10"]], ["later", ["d11"]], ["none", ["none"]], ["done", ["done"]],
  ]);
  // Monday start: this week runs to Sunday the 25th.
  expect(ids(listSections(tasks, { now: WED, weekStart: 1 })).slice(3, 6)).toEqual([["week", ["d2", "d3", "d4"]], ["next", ["d10", "d11"]], ["none", ["none"]]]);
});

test("on Saturday and Sunday the rest of the week can be empty", () => {
  const sat = [1, 2, 7, 8, 9].map((d) => task(`s${d}`, on(SAT, d)));
  expect(ids(listSections(sat, { now: SAT, weekStart: 0 }))).toEqual([["tomorrow", ["s1"]], ["next", ["s2", "s7"]], ["later", ["s8", "s9"]]]);
  expect(ids(listSections(sat, { now: SAT, weekStart: 1 }))).toEqual([["tomorrow", ["s1"]], ["next", ["s2", "s7", "s8"]], ["later", ["s9"]]]);
  const sun = [1, 2, 6, 7, 8].map((d) => task(`u${d}`, on(SUN, d)));
  expect(ids(listSections(sun, { now: SUN, weekStart: 0 }))).toEqual([["tomorrow", ["u1"]], ["week", ["u2", "u6"]], ["next", ["u7", "u8"]]]);
  expect(ids(listSections(sun, { now: SUN, weekStart: 1 }))).toEqual([["tomorrow", ["u1"]], ["next", ["u2", "u6", "u7"]], ["later", ["u8"]]]);
});

test("기한 없음 on top, 묶지 않기, sort inside groups and 완료한 할 일 숨기기", () => {
  const a = task("a", on(WED, 0, 18)), b = task("b", on(WED, 0, 9)), c = task("c", null), d = task("d", on(WED, 9));
  const done1 = task("x", null, { done: true, doneAt: new Date(2026, 9, 20) }), done2 = task("y", null, { done: true, doneAt: new Date(2026, 9, 21) });
  const all = [a, b, c, d, done1, done2];
  expect(ids(listSections(all, { now: WED, noneTop: true }))).toEqual([["none", ["c"]], ["today", ["b", "a"]], ["next", ["d"]], ["done", ["y", "x"]]]);
  // 생성일 순: newest first inside the group.
  expect(ids(listSections(all, { now: WED, sort: "created" }))[0]).toEqual(["today", ["b", "a"]]);
  const created = listSections([task("old", on(WED, 0, 9)), task("new", on(WED, 0, 18))], { now: WED, sort: "created" });
  expect(ids(created)).toEqual([["today", ["new", "old"]]]);
  expect(ids(listSections(all, { now: WED, group: "none" }))).toEqual([["todo", ["b", "a", "d", "c"]], ["done", ["y", "x"]]]);
  expect(ids(listSections(all, { now: WED, group: "none", noneTop: true }))[0]).toEqual(["todo", ["c", "b", "a", "d"]]);
  expect(listSections(all, { now: WED, hideDone: true }).map((s) => s.id)).not.toContain("done");
  expect(listSections(all, { now: WED })[0].name).toBe("오늘");
  expect(listSections([task("o", on(WED, -1))], { now: WED })[0]).toMatchObject({ id: "over", name: "기한 지남", over: true });
});

test("stored order follows the prev/next chain and keeps strays", () => {
  const a = { id: "a" }, b = { id: "b" }, c = { id: "c" }, stray = { id: "s", prev: c };
  a.prev = null; a.next = b; b.prev = a; b.next = c; c.prev = b; c.next = null;
  expect(storedOrder({ c, stray, a, b }).map((t) => t.id)).toEqual(["a", "b", "c", "s"]);
  expect([task("n", null), task("m", on(WED, 1))].sort(taskSorter("due")).map((t) => t.title)).toEqual(["m", "n"]);
});

test("search: title, then memo only, then category name only; open first", () => {
  const t1 = task("리뷰 준비", on(WED, 2)), t2 = task("디자인", on(WED, 1), { memo: "리뷰 받은 것 반영" });
  const t3 = task("배포", null, { categories: { rev: true } }), t4 = task("코드 리뷰", on(WED, 0), { done: true });
  const name = (cid) => (cid === "rev" ? "리뷰팀" : null);
  const found = searchSections([t1, t2, t3, t4], "리뷰", name);
  expect(found.title.map((t) => t.title)).toEqual(["리뷰 준비", "코드 리뷰"]);
  expect(found.memo.map((t) => t.title)).toEqual(["디자인"]);
  expect(found.category.map((t) => t.title)).toEqual(["배포"]);
  // A hidden (secret) category name finds nothing.
  expect(searchSections([t3], "리뷰", () => null).category).toEqual([]);
  expect(searchSections([t1, t4], "리뷰", name, { hideDone: true }).title).toEqual([t1]);
});

test("matches are split case-insensitively and memo snippets centre on the match", () => {
  expect(highlightParts("Review the REVIEW", "review")).toEqual([
    { text: "Review", hit: true }, { text: " the ", hit: false }, { text: "REVIEW", hit: true },
  ]);
  expect(highlightParts("a.b(c)", ".b(")).toEqual([{ text: "a", hit: false }, { text: ".b(", hit: true }, { text: "c)", hit: false }]);
  expect(highlightParts("plain", "")).toEqual([{ text: "plain", hit: false }]);
  expect(memoSnippet("앞부분이 아주 길게 이어지는 메모에서 리뷰 받은 내용을 정리", "리뷰", 6)).toBe("… 메모에서 리뷰 받은 내용…");
});
