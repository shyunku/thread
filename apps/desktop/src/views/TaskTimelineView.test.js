import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { Provider } from "react-redux";
import { PickedDayContext, startOfDay } from "components/panel/pickedDay";
import { TaskSelectionContext } from "components/list/taskSelection";
import prefsReducer, { setPrefs } from "store/prefsSlice";
import MiniMonth from "molecules/pickers/MiniMonth";
import TaskTimelineView, { END_OF_DAY_HOUR, hourGroups, stepName, timelineColumns, timelineRows } from "./TaskTimelineView";

const NOW = new Date(2026, 9, 21, 14, 30); // Wednesday
const at = (days, h, m = 0) => { const d = new Date(NOW); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };
const task = (id, title, dueDate, extra = {}) => ({ id, title, dueDate, done: false, categories: {}, subtasks: {}, ...extra });

// The pane width the view measures (ResizeObserver + getBoundingClientRect).
let paneWidth = 1100;
const realRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function rect() {
    if (this.classList?.contains("task-timeline-view")) return { width: paneWidth, height: 800, left: 0, top: 0, right: paneWidth, bottom: 800 };
    return realRect.call(this);
  };
});
afterAll(() => { Element.prototype.getBoundingClientRect = realRect; });

let picked;
const setDone = jest.fn();
const setShownDays = jest.fn();
function Harness({ initialDay = NOW, selectedTaskId = null, ...props }) {
  const [day, setDay] = useState(() => startOfDay(initialDay));
  picked = day;
  return (
    <TaskSelectionContext.Provider value={{ selectedTaskId, setSelectedTaskId: () => {}, openTask: jest.fn(), actions: { setDone } }}>
      <PickedDayContext.Provider value={{ pickedDay: day, setPickedDay: (d) => setDay(startOfDay(d)), setShownDays }}>
        <TaskTimelineView filteredTaskMap={{}} categories={{}} {...props} />
      </PickedDayContext.Provider>
    </TaskSelectionContext.Provider>
  );
}
function setup(props = {}, prefs) {
  const store = configureStore({ reducer: { prefs: prefsReducer } });
  if (prefs) store.dispatch(setPrefs(prefs));
  return render(<Provider store={store}><Harness {...props} /></Provider>);
}
const columns = (container) => [...container.querySelectorAll(".tv-col")];
const column = (container, i) => columns(container)[i];
const bodyText = (col) => [...col.querySelectorAll(".tv-hour, .tv-now, .tv-task .t, .tv-empty")].map((el) => el.textContent);

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); paneWidth = 1100; setDone.mockClear(); });
afterEach(() => { jest.useRealTimers(); });

test("columns fit the pane width: 240px or wider, 12px apart, 1 to 5", () => {
  expect(timelineColumns(0)).toBe(1);
  expect(timelineColumns(64 + 240)).toBe(1);
  expect(timelineColumns(64 + 240 * 2 + 12)).toBe(2);
  expect(timelineColumns(64 + 240 * 2 + 11)).toBe(1);
  expect(timelineColumns(1047)).toBe(3);
  expect(timelineColumns(3000)).toBe(5);
  paneWidth = 1047;
  const { container } = setup();
  expect(columns(container)).toHaveLength(3);
  expect(screen.getByRole("heading", { name: "10월 21일 – 23일" })).toBeInTheDocument();
});

test("each column: date, weekday, 오늘, open count; hours that have tasks, the 지금 line on today", () => {
  const tasks = {
    a: task("a", "아침 회의", at(0, 9)),
    b: task("b", "점심", at(0, 12, 30), { done: true }),
    c: task("c", "보고서", at(0, 16)),
    d: task("d", "검토", at(0, 16, 45)),
    e: task("e", "하루 안에", at(0, 23, 59)),
    f: task("f", "내일 일", at(1, 10)),
  };
  const { container } = setup({ filteredTaskMap: tasks });
  const today = column(container, 0);
  expect(today).toHaveClass("today");
  const head = today.querySelector(".tv-head");
  expect(head.querySelector("b")).toHaveTextContent("21");
  expect(head).toHaveTextContent("수요일");
  expect(head.querySelector("em")).toHaveTextContent("오늘");
  expect(head.querySelector(".cnt")).toHaveTextContent("4");
  expect(bodyText(today)).toEqual(["오전 9시", "아침 회의", "오후 12시", "점심", "지금 오후 2:30", "오후 4시", "보고서", "검토", "하루 끝", "하루 안에"]);
  // Minutes show in the meta; overdue in red; done struck through.
  const row = (title) => [...today.querySelectorAll(".tv-task")].find((el) => el.textContent.includes(title));
  expect(row("검토").querySelector(".meta")).toHaveTextContent("오후 4:45");
  expect(row("점심")).toHaveClass("done");
  expect(row("아침 회의").querySelector(".meta")).toBeNull();
  const tomorrow = column(container, 1);
  expect(tomorrow).not.toHaveClass("today");
  expect(tomorrow.querySelector("em")).toBeNull();
  expect(bodyText(tomorrow)).toEqual(["오전 10시", "내일 일"]);
  expect(bodyText(column(container, 2))).toEqual(["할 일 없음"]);
  expect(container.querySelector(".tc-finding")).toHaveTextContent("4일 · 남은 할 일 5개 · 기한 지난 할 일 1개는 목록에서 볼 수 있어요");
});

test("24h labels and the 12h default", () => {
  const tasks = { a: task("a", "회의", at(0, 9, 5)), b: task("b", "저녁", at(0, 21)) };
  const { container, unmount } = setup({ filteredTaskMap: tasks });
  expect(bodyText(column(container, 0))).toEqual(["오전 9시", "회의", "지금 오후 2:30", "오후 9시", "저녁"]);
  unmount();
  const second = setup({ filteredTaskMap: tasks }, { timeFormat: "24" });
  expect(bodyText(column(second.container, 0))).toEqual(["09:00", "회의", "지금 14:30", "21:00", "저녁"]);
  expect(second.container.querySelector(".tv-task .meta")).toHaveTextContent("09:05");
});

test("a row: click opens the task, right-click the menu, the check completes it", () => {
  const onOpenTask = jest.fn(), onTaskContextMenu = jest.fn(), onToggleDone = jest.fn();
  const tasks = { a: task("a", "보고서", at(0, 16), { important: true }), b: task("b", "끝", at(0, 17), { done: true }) };
  const { container } = setup({ filteredTaskMap: tasks, onOpenTask, onTaskContextMenu, onToggleDone, selectedTaskId: "a" });
  const row = container.querySelector('[data-task-id="a"]');
  expect(row).toHaveClass("sel");
  expect(within(row).getByRole("img", { name: "중요" })).toBeInTheDocument();
  fireEvent.click(row);
  expect(onOpenTask).toHaveBeenCalledWith("a");
  fireEvent.contextMenu(row, { clientX: 10, clientY: 20 });
  expect(onTaskContextMenu.mock.calls[0][1]).toBe("a");
  fireEvent.click(within(row).getByRole("checkbox", { name: "할 일 완료" }));
  // Done tasks stay in the timeline, so the row does not fall (#107).
  expect(onToggleDone).toHaveBeenCalledWith(tasks.a, row, true, true);
  expect(onOpenTask).toHaveBeenCalledTimes(1);
  fireEvent.click(within(container.querySelector('[data-task-id="b"]')).getByRole("checkbox", { name: "완료 취소" }));
  expect(onToggleDone).toHaveBeenLastCalledWith(tasks.b, expect.anything(), false);
});

test("without onToggleDone the view completes through the selection actions", () => {
  const tasks = { a: task("a", "보고서", at(0, 16)) };
  const { container } = setup({ filteredTaskMap: tasks });
  fireEvent.keyDown(container.querySelector('[data-task-id="a"]'), { key: " " });
  act(() => { jest.advanceTimersByTime(1000); });
  expect(setDone).toHaveBeenCalledWith("a", true, expect.any(Function));
});

test("completing in the timeline: no fall while done tasks stay, the fall when they are hidden (#107)", () => {
  const tasks = { a: task("a", "보고서", at(0, 16)) };
  const shown = setup({ filteredTaskMap: tasks });
  let row = shown.container.querySelector('[data-task-id="a"]');
  fireEvent.click(within(row).getByRole("checkbox", { name: "할 일 완료" }));
  act(() => { jest.advanceTimersByTime(200); });
  expect(document.querySelector(".fall")).toBeNull();
  expect(row.style.visibility).toBe("");
  act(() => { jest.advanceTimersByTime(100); });
  expect(setDone).toHaveBeenCalledWith("a", true, expect.any(Function));
  shown.unmount();
  setDone.mockClear();
  const hidden = setup({ filteredTaskMap: tasks }, { hideDone: true });
  row = hidden.container.querySelector('[data-task-id="a"]');
  fireEvent.click(within(row).getByRole("checkbox", { name: "할 일 완료" }));
  act(() => { jest.advanceTimersByTime(200); });
  expect(document.querySelector(".fall")).not.toBeNull();
  expect(setDone).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(500); });
  expect(setDone).toHaveBeenCalledWith("a", true, expect.any(Function));
});

test("‹ › move a day, 오늘 goes back; the quick add gets the first column's day", () => {
  const renderQuickAdd = jest.fn((day) => <div data-testid="qa">{day}</div>);
  paneWidth = 64 + 240;
  const { container } = setup({ renderQuickAdd });
  expect(columns(container)).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "10월 21일" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "하루 뒤" }));
  fireEvent.click(screen.getByRole("button", { name: "하루 뒤" }));
  expect(picked).toBe(startOfDay(at(2, 0)));
  expect(screen.getByTestId("qa")).toHaveTextContent(String(startOfDay(at(2, 0))));
  expect(column(container, 0)).not.toHaveClass("today");
  expect(column(container, 0).querySelector(".tv-now")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "하루 전" }));
  expect(picked).toBe(startOfDay(at(1, 0)));
  fireEvent.click(screen.getByRole("button", { name: "오늘" }));
  expect(picked).toBe(startOfDay(NOW));
});

test("the range title across months and years", () => {
  paneWidth = 1400;
  const { unmount } = setup({ initialDay: new Date(2026, 9, 30) });
  expect(screen.getByRole("heading", { name: "10월 30일 – 11월 3일" })).toBeInTheDocument();
  unmount();
  setup({ initialDay: new Date(2026, 11, 30) });
  expect(screen.getByRole("heading", { name: "12월 30일 – 2027년 1월 3일" })).toBeInTheDocument();
});

test("hourGroups: by due, only hours with tasks, no time last", () => {
  const list = [task("e", "", at(0, 23, 59)), task("b", "", at(0, 9, 30)), task("a", "", at(0, 9)), task("c", "", at(0, 13))];
  expect(hourGroups(list).map((g) => [g.hour, g.tasks.map((t) => t.id)])).toEqual([[9, ["a", "b"]], [13, ["c"]], [END_OF_DAY_HOUR, ["e"]]]);
});

test("the column count follows the pane when it is resized (the panel dragged wider or narrower)", () => {
  paneWidth = 1400;
  const { container } = setup();
  expect(columns(container)).toHaveLength(5);
  paneWidth = 800;
  act(() => { window.dispatchEvent(new Event("resize")); });
  expect(columns(container)).toHaveLength(2);
  paneWidth = 1047;
  act(() => { window.dispatchEvent(new Event("resize")); });
  expect(columns(container)).toHaveLength(3);
});

test("in search the summary says it shows the results", () => {
  setup({ searchNote: "검색 결과 2개", filteredTaskMap: { a: task("a", "보고서", at(0, 18)) } });
  expect(document.querySelector(".tc-finding")).toHaveTextContent(/^검색 결과 2개 · 4일 · 남은 할 일 1개/);
});

test("‹ › tooltips name the Shift step; Shift+press moves a week", () => {
  paneWidth = 64 + 240;
  setup();
  const prev = screen.getByRole("button", { name: "하루 전" }), next = screen.getByRole("button", { name: "하루 뒤" });
  expect(prev).toHaveAttribute("data-tip", "하루 전 · Shift 한 주 전");
  expect(next).toHaveAttribute("data-tip", "하루 뒤 · Shift 한 주 뒤");
  fireEvent.click(next, { shiftKey: true });
  expect(picked).toBe(startOfDay(at(7, 0)));
  expect(screen.getByRole("heading", { name: "10월 28일" })).toBeInTheDocument();
  fireEvent.click(prev, { shiftKey: true });
  fireEvent.click(prev, { shiftKey: true });
  expect(picked).toBe(startOfDay(at(-7, 0)));
  fireEvent.click(prev);
  expect(picked).toBe(startOfDay(at(-8, 0)));
});

test("the title opens the day popup: the month calendar with today ringed and the first day picked", () => {
  paneWidth = 1047;
  setup({ initialDay: at(2, 0) }, { weekStart: 1 });
  const title = screen.getByRole("button", { name: "10월 23일 – 25일" });
  expect(title).toHaveAttribute("data-tip", "날짜로 가기");
  fireEvent.click(title);
  const pop = screen.getByRole("dialog", { name: "날짜로 가기" });
  expect(title).toHaveClass("on");
  expect(within(pop).getByText("2026년 10월")).toBeInTheDocument();
  const weekdays = [...pop.querySelectorAll(".tp-mm-w")].map((el) => el.textContent);
  expect(weekdays).toEqual(["월", "화", "수", "목", "금", "토", "일"]);
  const day = (label) => within(pop).getByRole("button", { name: label });
  expect(day("10월 21일 수요일")).toHaveClass("today");
  expect(day("10월 21일 수요일")).not.toHaveClass("picked");
  expect(day("10월 23일 금요일")).toHaveClass("picked");
  expect(document.activeElement).toBe(day("10월 23일 금요일"));
  expect(within(pop).getByRole("button", { name: "다음 달" })).toHaveAttribute("data-tip", "다음 달");
  fireEvent.click(within(pop).getByRole("button", { name: "다음 달" }));
  expect(within(pop).getByText("2026년 11월")).toBeInTheDocument();
  // A day becomes the first column; the popup closes and focus goes back to the title.
  fireEvent.click(day("11월 4일 수요일"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(picked).toBe(startOfDay(new Date(2026, 10, 4)));
  expect(screen.getByRole("heading", { name: "11월 4일 – 6일" })).toBeInTheDocument();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "11월 4일 – 6일" }));
});

test("the day popup: arrows move the pick without closing, Enter takes it; 오늘로; Esc closes", () => {
  paneWidth = 64 + 240;
  setup({ initialDay: at(5, 0) });
  fireEvent.click(screen.getByRole("button", { name: "10월 26일" }));
  let pop = screen.getByRole("dialog", { name: "날짜로 가기" });
  fireEvent.keyDown(document.activeElement, { key: "ArrowDown" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(picked).toBe(startOfDay(at(5, 0)));
  // A week later is in November: the popup's month follows the pick.
  expect(within(pop).getByText("2026년 11월")).toBeInTheDocument();
  const nov2 = within(pop).getByRole("button", { name: "11월 2일 월요일" });
  expect(nov2).toHaveClass("picked");
  expect(document.activeElement).toBe(nov2);
  fireEvent.keyDown(nov2, { key: "Enter" });
  fireEvent.click(nov2);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(picked).toBe(startOfDay(new Date(2026, 10, 2)));
  fireEvent.click(screen.getByRole("button", { name: "11월 2일" }));
  pop = screen.getByRole("dialog", { name: "날짜로 가기" });
  fireEvent.click(within(pop).getByRole("button", { name: "오늘로" }));
  expect(picked).toBe(startOfDay(NOW));
  expect(screen.queryByRole("dialog")).toBeNull();
  const title = screen.getByRole("button", { name: "10월 21일" });
  fireEvent.click(title);
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(title);
  expect(picked).toBe(startOfDay(NOW));
});

test("periods (#109): a block splitting one hour's tasks, and the band; no duplicate keys", () => {
  const errors = jest.spyOn(console, "error").mockImplementation(() => {});
  const period = (id, title, start, due) => task(id, title, due, { startOffset: due.getTime() - start.getTime() });
  const map = {
    a: task("a", "15시 일", at(0, 15)),
    b: period("b", "블록", at(0, 15, 10), at(0, 16)),
    c: task("c", "15시 반", at(0, 15, 30)),
    d: period("d", "여행", at(-1, 0), at(2, 23, 59)),
  };
  const { container } = setup({ filteredTaskMap: map });
  expect(bodyText(column(container, 0))).toEqual(["지금 오후 2:30", "오후 3시", "15시 일", "오후 3:10 ~ 4시", "블록", "오후 3시", "15시 반"]);
  expect(column(container, 0).querySelector(".tv-task.blk")).toHaveTextContent("오후 3:10 ~ 4:00 · 50분");
  const seg = column(container, 0).querySelector(".tv-band .tv-seg");
  expect(seg).toHaveTextContent("◂여행~10/23");
  expect(seg).toHaveClass("cl", "br");
  expect(errors.mock.calls.filter((c) => String(c[0]).includes("same key"))).toEqual([]);
  errors.mockRestore();
});

describe("two rows (#110)", () => {
  const realHeight = window.innerHeight;
  const tall = (h) => { window.innerHeight = h; act(() => { window.dispatchEvent(new Event("resize")); }); };
  afterEach(() => { window.innerHeight = realHeight; });

  test("the rule: two rows from a 900px window; the step names a row of days", () => {
    expect([timelineRows(768), timelineRows(899), timelineRows(900), timelineRows(1200)]).toEqual([1, 1, 2, 2]);
    expect([stepName(1), stepName(3), stepName(5)]).toEqual(["하루", "3일", "5일"]);
  });

  test("a tall window shows columns × 2 days in a grid; it follows resizes; the panel learns the count", () => {
    paneWidth = 1047;
    const { container } = setup();
    expect(columns(container)).toHaveLength(3);
    expect(setShownDays).toHaveBeenLastCalledWith(3);
    tall(960);
    expect(columns(container)).toHaveLength(6);
    expect(setShownDays).toHaveBeenLastCalledWith(6);
    const grid = container.querySelector(".tv-grid");
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(grid.style.gridTemplateRows).toBe("repeat(2, minmax(0, 1fr))");
    expect(columns(container).map((c) => `${c.style.gridRow}/${c.style.gridColumn}`)).toEqual(["1/1", "1/2", "1/3", "2/1", "2/2", "2/3"]);
    expect(screen.getByRole("heading", { name: "10월 21일 – 26일" })).toBeInTheDocument();
    expect(document.querySelector(".tc-finding")).toHaveTextContent(/^6일 · /);
    // Each cell scrolls inside itself, with the fade after its body.
    for (const c of columns(container)) expect(c.querySelector(".tv-body").nextElementSibling).toHaveClass("scroll-fade");
    tall(800);
    expect(columns(container)).toHaveLength(3);
  });

  test("‹ › move one row of days (Shift a week); the tooltips say so", () => {
    paneWidth = 1047;
    tall(960);
    setup();
    const next = screen.getByRole("button", { name: "3일 뒤" }), prev = screen.getByRole("button", { name: "3일 전" });
    expect(next).toHaveAttribute("data-tip", "3일 뒤 · Shift 한 주 뒤");
    expect(prev).toHaveAttribute("data-tip", "3일 전 · Shift 한 주 전");
    fireEvent.click(next);
    expect(picked).toBe(startOfDay(at(3, 0)));
    fireEvent.click(next, { shiftKey: true });
    expect(picked).toBe(startOfDay(at(10, 0)));
    fireEvent.click(prev);
    expect(picked).toBe(startOfDay(at(7, 0)));
  });

  test("bands per row: a period going on into the second row starts there with ◂", () => {
    paneWidth = 1047;
    tall(960);
    const period = (id, title, start, due) => task(id, title, due, { startOffset: due.getTime() - start.getTime() });
    const { container } = setup({ filteredTaskMap: { m: period("m", "학회", at(1, 0), at(4, 23, 59)) } });
    const segs = (i) => [...column(container, i).querySelectorAll(".tv-band .tv-seg")];
    expect(segs(0)).toHaveLength(0);
    expect(segs(1)[0]).toHaveTextContent("학회~10/25");
    expect(segs(1)[0]).not.toHaveClass("cl");
    expect(segs(2)[0]).toHaveClass("cl", "cr");
    expect(segs(2)[0]).not.toHaveClass("br");
    expect(segs(3)[0]).toHaveTextContent("◂학회~10/25");
    expect(segs(3)[0]).toHaveClass("cl", "br");
    expect(segs(4)[0]).not.toHaveClass("cr");
    expect(column(container, 5).querySelector(".tv-seg")).toBeNull();
    // Every cell of a row with bars keeps the strip, so its rows line up.
    expect(column(container, 0).querySelector(".tv-band")).not.toBeNull();
  });

  test("arrow keys: ←/→ to the next cell across the rows, ↓ past a cell's end into the row below", () => {
    paneWidth = 1047;
    tall(960);
    const map = { a: task("a", "A1", at(2, 9)), b: task("b", "B1", at(3, 9)), c: task("c", "C1", at(5, 9)), d: task("d", "A2", at(2, 10)) };
    setup({ filteredTaskMap: map });
    const row = (name) => screen.getByRole("option", { name });
    row("A2").focus();
    fireEvent.keyDown(row("A2"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(row("B1"));
    fireEvent.keyDown(row("B1"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(row("C1"));
    fireEvent.keyDown(row("C1"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(row("A2"));
    fireEvent.keyDown(row("A2"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("C1"));
    fireEvent.keyDown(row("C1"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(row("B1"));
    // Nothing above (an empty cell): round inside the cell as before.
    fireEvent.keyDown(row("B1"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(row("B1"));
    row("A2").focus();
    fireEvent.keyDown(row("A2"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(row("A1"));
  });

  test("the panel's month tints the shown days", () => {
    render(<MiniMonth year={2026} month={9} picked={at(0, 0)} today={NOW} shownRange={[at(0, 0), at(5, 0)]} />);
    const shown = [...document.querySelectorAll(".tp-mm-c.shown")].map((el) => el.dataset.day);
    expect(shown).toEqual(["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"]);
  });
});
