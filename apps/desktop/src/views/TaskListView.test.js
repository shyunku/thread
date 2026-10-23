import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider, useDispatch, useSelector } from "react-redux";
import prefsReducer, { prefsSelector, setPrefs } from "store/prefsSlice";
import TaskListView from "./TaskListView";

const NOW = new Date(2026, 9, 21, 14, 30); // Wednesday
const on = (days, h, m = 0) => { const d = new Date(NOW); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };
const task = (id, title, dueDate, extra = {}) => ({ id, title, dueDate, done: false, memo: "", categories: {}, subtasks: {}, createdAt: new Date(2026, 9, 1), ...extra });

function Harness({ tasks, ...rest }) {
  const prefs = useSelector(prefsSelector);
  const dispatch = useDispatch();
  return <TaskListView tasks={tasks} prefs={prefs} onFold={(id, closed) => dispatch(setPrefs({ groupClosed: { [id]: closed } }))} {...rest} />;
}
function setup(tasks, prefs, rest = {}) {
  const store = configureStore({ reducer: { prefs: prefsReducer } });
  if (prefs) store.dispatch(setPrefs(prefs));
  const view = render(<Provider store={store}><Harness tasks={tasks} {...rest} /></Provider>);
  return { store, ...view };
}
const groups = (container) => [...container.querySelectorAll(".tl-group")].map((g) => g.dataset.group);

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
afterEach(() => { jest.useRealTimers(); });

const sample = () => [
  task("over", "주간 보고서", on(-1, 18)),
  task("today", "운동", on(0, 21)),
  task("week", "스터디", on(2, 19)),
  task("none", "책장 정리", null),
  task("done", "장보기", on(0, 12), { done: true, doneAt: on(0, 13) }),
];

test("date groups with counts; 완료됨 is folded by default and folds are remembered in prefs", () => {
  const { container, store } = setup(sample());
  expect(groups(container)).toEqual(["over", "today", "week", "none", "done"]);
  const over = screen.getByRole("button", { name: "기한 지남 1개" });
  expect(over).toHaveClass("over");
  expect(screen.getByRole("button", { name: "완료됨 1개" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("장보기")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "완료됨 1개" }));
  expect(screen.getByText("장보기")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "오늘 1개" }));
  expect(screen.queryByText("운동")).toBeNull();
  expect(store.getState().prefs.groupClosed).toEqual({ done: false, today: true });
});

test("saved folds, 기한 없음 on top, 묶지 않기 and 완료한 할 일 숨기기 come from prefs", () => {
  const { container, unmount } = setup(sample(), { groupClosed: { over: true }, noneTop: true });
  expect(groups(container)).toEqual(["none", "over", "today", "week", "done"]);
  expect(screen.queryByText("주간 보고서")).toBeNull();
  unmount();
  const second = setup(sample(), { group: "none", hideDone: true });
  expect(groups(second.container)).toEqual(["todo"]);
  expect(screen.getByRole("button", { name: "해야 할 일 4개" })).toBeInTheDocument();
  expect([...second.container.querySelectorAll(".task-row .t")].map((t) => t.textContent)).toEqual(["주간 보고서", "운동", "스터디", "책장 정리"]);
});

test("the right column: due on top in the due format, remaining time below unless off or done; overdue in red", () => {
  const { container, unmount } = setup(sample(), { groupClosed: { done: false } });
  const row = (id) => container.querySelector(`[data-task-id="${id}"]`);
  expect(within(row("today")).getByText("오후 9시")).toHaveClass("when");
  expect(row("today").querySelector(".left")).toHaveTextContent("6시간 30분 남음");
  expect(row("over").querySelector(".when")).toHaveTextContent("어제 오후 6시");
  expect(row("over").querySelector(".when")).toHaveClass("over");
  expect(row("over").querySelector(".left")).toHaveClass("over");
  expect(row("week").querySelector(".when")).toHaveTextContent("금 오후 7시");
  expect(row("done").querySelector(".left")).toBeNull();
  expect(row("done").querySelector(".when")).not.toHaveClass("over");
  // A due line alone is centred on the row; with the remaining time below it is not.
  expect(row("done").querySelector(".rcol")).toHaveClass("one");
  expect(row("today").querySelector(".rcol")).not.toHaveClass("one");
  // Always there (min-width 112), so titles line up with or without a due.
  expect(row("none").querySelector(".rcol")).toBeEmptyDOMElement();
  unmount();
  const other = setup(sample(), { showRemain: false, dueFormat: "exact", timeFormat: "24" });
  const today = other.container.querySelector('[data-task-id="today"]');
  expect(today.querySelector(".left")).toBeNull();
  expect(today.querySelector(".when")).toHaveTextContent("26.10.21 21:00");
  expect(today.querySelector(".rcol")).toHaveClass("one");
});

test("the remaining time follows the clock", () => {
  const { container } = setup([task("t", "곧", on(0, 14, 32))]);
  expect(container.querySelector(".left")).toHaveTextContent("2분 남음");
  act(() => { jest.advanceTimersByTime(3 * 60 * 1000); });
  expect(container.querySelector(".left")).toHaveTextContent("지남");
  expect(container.querySelector(".when")).toHaveClass("over");
});

test("rows: meta line, +N with the names, no-meta centring and compact density", () => {
  const cats = [{ id: "a", title: "업무", color: "#6294ff" }, { id: "b", title: "공부", color: "#b58cff" }, { id: "s", title: "일기", color: "#e57ad6", secret: true }];
  const tasks = [
    task("m", "회고", on(0, 17, 30), { repeatPeriod: "week", memo: "메모", subtasks: { x: { done: true }, y: { done: false } }, categories: { a: true, b: true } }),
    task("p", "그냥", null),
    task("q", "비밀", on(1, 10), { categories: { s: true } }),
  ];
  const row = { catsOf: (t) => cats.filter((c) => t.categories[c.id]) };
  const { container, unmount } = setup(tasks, null, { row });
  const m = container.querySelector('[data-task-id="m"]');
  expect(m.querySelector(".meta .cat b")).toHaveTextContent("업무");
  expect(m.querySelector(".meta .more")).toHaveTextContent("+1");
  expect(m.querySelector(".meta .more")).toHaveAttribute("data-tip", "업무, 공부");
  expect(m.querySelector(".meta .rep")).toHaveTextContent("매주");
  expect(m.querySelector(".meta .sub")).toHaveTextContent("1/2");
  expect(m.querySelector(".meta .memo")).toHaveAttribute("data-tip", "메모 있음");
  expect(container.querySelector('[data-task-id="p"]')).toHaveClass("no-meta");
  expect(container.querySelector('[data-task-id="q"] .meta .shield')).not.toBeNull();
  expect(container.querySelector("[title]")).toBeNull();
  unmount();
  const compact = setup(tasks, { density: "compact" }, { row });
  const c = compact.container.querySelector('[data-task-id="m"]');
  expect(c).toHaveClass("compact");
  expect(c.querySelector(".ic-cat").style.background).toBe("rgb(98, 148, 255)");
});

test("empty: the message, and 완료한 할 일 N개 보기 unfolds 완료됨 below it", () => {
  const done = [task("d", "끝난 일", on(0, 9), { done: true })];
  const { store, container } = setup(done, null, { emptyTitle: "오늘 할 일을 모두 끝냈어요" });
  expect(screen.getByText("오늘 할 일을 모두 끝냈어요")).toBeInTheDocument();
  expect(screen.getByText(/아래 입력칸에서 바로 추가할 수 있어요/)).toBeInTheDocument();
  expect(groups(container)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "완료한 할 일 1개 보기" }));
  expect(store.getState().prefs.groupClosed.done).toBe(false);
  expect(groups(container)).toEqual(["done"]);
  expect(screen.getByText("끝난 일")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "완료한 할 일 1개 보기" })).toBeNull();
});

test("empty with nothing done has no button; hideDone hides it too", () => {
  setup([task("d", "끝난 일", null, { done: true })], { hideDone: true });
  expect(screen.getByText("할 일이 없어요")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /완료한 할 일/ })).toBeNull();
});

test("locked category: the shield tile, one line and the unlock button", () => {
  const onUnlock = jest.fn();
  setup(sample(), null, { locked: { color: "#e57ad6", label: "Windows Hello로 열기", onUnlock } });
  expect(screen.getByText("이 카테고리는 잠겨 있어요")).toBeInTheDocument();
  expect(screen.getByText("열면 할 일이 보이고, 앱을 닫거나 잠그면 다시 잠겨요.")).toHaveClass("tl-one");
  expect(screen.queryByText("운동")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Windows Hello로 열기" }));
  expect(onUnlock).toHaveBeenCalledTimes(1);
});

test("search: 제목에서 / 메모에서 / 카테고리에서 with highlights and the summary line", () => {
  const tasks = [
    task("a", "리뷰 준비", on(1, 9)),
    task("b", "디자인", on(2, 9), { memo: "지난 리뷰 반영" }),
    task("c", "배포", null, { categories: { r: true } }),
    task("d", "상관없음", null),
  ];
  const { container } = setup(tasks, null, { search: true, query: "리뷰", categoryName: (cid) => (cid === "r" ? "리뷰팀" : null) });
  expect(groups(container)).toEqual(["s-title", "s-memo", "s-cat"]);
  expect(container.querySelector('[data-task-id="a"] mark')).toHaveTextContent("리뷰");
  expect(container.querySelector('[data-task-id="b"] .meta.snip mark')).toHaveTextContent("리뷰");
  expect(screen.getByText("제목 1개 · 메모 1개 · 카테고리 1개")).toBeInTheDocument();
  expect(container.querySelector('[data-task-id="d"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "제목에서 1개" }));
  expect(container.querySelector('[data-task-id="a"]')).toBeNull();
});

test("search: a hidden secret memo hit shows no memo text while locked; unlocked it does", () => {
  const cats = [{ id: "s", title: "일기", color: "#e57ad6", secret: true }];
  const tasks = [task("h", "산책", on(2, 22), { memo: "비밀 리뷰 메모", categories: { s: true } })];
  const row = (unlocked) => ({ catsOf: (t) => cats.filter((c) => t.categories[c.id]), isHidden: (t) => !!t.categories.s, unlocked, onUnlock: jest.fn() });
  const { container, unmount } = setup(tasks, null, { search: true, query: "리뷰", row: row(false) });
  const hit = container.querySelector('[data-task-id="h"]');
  expect(groups(container)).toEqual(["s-memo"]);
  expect(hit.querySelector(".meta.snip")).toBeNull();
  expect(hit).not.toHaveTextContent("비밀 리뷰 메모");
  // Title and category, as in the mock.
  expect(hit.querySelector(".meta .cat")).toHaveTextContent("일기");
  unmount();
  const open = setup(tasks, null, { search: true, query: "리뷰", row: row(true) });
  expect(open.container.querySelector('[data-task-id="h"] .meta.snip')).toHaveTextContent("비밀 리뷰 메모");
});

test("rows are options of each group's listbox", () => {
  const { container } = setup(sample(), null, { row: { selectedId: "today" } });
  const today = screen.getByRole("listbox", { name: "오늘" });
  expect(within(today).getByRole("option", { name: "운동" })).toHaveAttribute("aria-selected", "true");
  expect(container.querySelector('[data-task-id="over"]')).toHaveAttribute("aria-selected", "false");
  expect(container.querySelector('.task-row[role="button"]')).toBeNull();
});

test("search: hidden secret hits are marked, counted in the summary and ask for the unlock before acting", async () => {
  const cats = [{ id: "s", title: "일기", color: "#e57ad6", secret: true }];
  const tasks = [task("a", "리뷰 준비", on(1, 9)), task("h", "한 주 리뷰 일기", on(2, 22), { categories: { s: true } })];
  let unlockOk = false;
  const onUnlock = jest.fn(() => Promise.resolve(unlockOk));
  const onSelect = jest.fn();
  const row = { catsOf: (t) => cats.filter((c) => t.categories[c.id]), isHidden: (t) => !!t.categories.s, unlocked: false, onUnlock, onSelect };
  const { container } = setup(tasks, null, { search: true, query: "리뷰", row });
  const hidden = container.querySelector('[data-task-id="h"]');
  expect(hidden).toHaveClass("hidden-hit");
  expect(hidden).toHaveAccessibleName("한 주 리뷰 일기 (숨김)");
  expect(hidden.querySelector(".hid-tag")).toHaveTextContent("숨김");
  expect(hidden.querySelector(".hid-tag")).toHaveAttribute("data-tip", "비밀 카테고리 할 일이에요. 열면 본인 확인을 해요");
  // The mock shows the shield and the secret category's name on the hit.
  expect(hidden.querySelector(".meta .shield")).not.toBeNull();
  expect(hidden.querySelector(".meta .cat b")).toHaveTextContent("일기");
  expect(container.querySelector('[data-task-id="a"]')).not.toHaveClass("hidden-hit");
  expect(screen.getByText("제목 2개 · 메모 0개 · 카테고리 0개 · 숨김 1개 포함")).toBeInTheDocument();
  // Cancelled unlock: nothing happens.
  await act(async () => { fireEvent.click(hidden); });
  expect(onUnlock).toHaveBeenCalledTimes(1);
  expect(onSelect).not.toHaveBeenCalled();
  unlockOk = true;
  await act(async () => { fireEvent.click(hidden); });
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "h" }));
  // A visible hit acts at once.
  fireEvent.click(container.querySelector('[data-task-id="a"]'));
  expect(onUnlock).toHaveBeenCalledTimes(2);
});

test("search wins over the locked state", () => {
  setup([task("a", "리뷰 준비", on(1, 9))], null, { search: true, query: "리뷰", locked: { color: "#e57ad6", label: "열기", onUnlock: () => {} } });
  expect(screen.queryByText("이 카테고리는 잠겨 있어요")).toBeNull();
  expect(screen.getByRole("option", { name: "리뷰 준비" })).toBeInTheDocument();
});

test("rows are memoised: moving the selection re-renders only the two rows involved", () => {
  const renders = {};
  const row = { catsOf: (t) => { renders[t.id] = (renders[t.id] ?? 0) + 1; return []; }, onSelect: () => {} };
  const store = configureStore({ reducer: { prefs: prefsReducer } });
  const prefs = store.getState().prefs;
  const tasks = sample();
  const stable = (selectedId) => (
    <Provider store={store}><TaskListView tasks={tasks} prefs={prefs} onFold={() => {}} row={{ ...row, selectedId }} /></Provider>
  );
  const { rerender } = render(stable(null));
  const before = { ...renders };
  rerender(stable("today"));
  rerender(stable("week"));
  const changed = Object.keys(renders).filter((id) => renders[id] !== before[id]);
  expect(changed.sort()).toEqual(["today", "week"]);
  expect(renders.today - before.today).toBe(2);
  expect(renders.week - before.week).toBe(1);
});
