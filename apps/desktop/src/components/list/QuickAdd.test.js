import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import prefsReducer from "store/prefsSlice";
import { TODO_MENU_TYPE } from "utils/menuFilters";
import QuickAdd, { buildQuickTask, quickAddDefaults } from "./QuickAdd";

const NOW = new Date(2026, 9, 21, 14, 30); // Wednesday
const endOf = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 0); return x.getTime(); };
const cats = [{ id: "work", title: "업무", color: "#6294ff" }, { id: "diary", title: "일기", color: "#e57ad6", secret: true }];

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
afterEach(() => { jest.useRealTimers(); });

function setup(defaults, props = {}) {
  const store = configureStore({ reducer: { prefs: prefsReducer } });
  const onAdd = jest.fn();
  const view = render(<Provider store={store}><QuickAdd defaults={defaults} categories={cats} onAdd={onAdd} {...props} /></Provider>);
  return { onAdd, ...view, input: screen.getByRole("textbox", { name: "새 할 일" }) };
}
const chipOf = (name) => screen.getByRole("button", { name }).closest(".qa-chip");
const type = (input, value) => { fireEvent.change(input, { target: { value } }); fireEvent.keyDown(input, { key: "Enter" }); };

test("defaults follow the screen", () => {
  const work = { id: "work", default: false, secret: false };
  const diary = { id: "diary", default: false, secret: true };
  expect(quickAddDefaults({ menuType: TODO_MENU_TYPE.ALL, now: NOW })).toEqual({ due: null, repeat: null, categoryIds: [], important: false });
  expect(quickAddDefaults({ menuType: TODO_MENU_TYPE.TODAY, now: NOW }).due).toBe(endOf(NOW));
  expect(quickAddDefaults({ menuType: TODO_MENU_TYPE.IMPORTANT, now: NOW }).important).toBe(true);
  // 다음 7일 starts at today too; no star where it cannot be stored.
  expect(quickAddDefaults({ menuType: TODO_MENU_TYPE.NEXT_7_DAYS, now: NOW }).due).toBe(endOf(NOW));
  expect(quickAddDefaults({ menuType: TODO_MENU_TYPE.IMPORTANT, now: NOW, canStar: false }).important).toBe(false);
  expect(quickAddDefaults({ menuType: "work", category: work }).categoryIds).toEqual(["work"]);
  expect(quickAddDefaults({ menuType: "diary", category: diary }).categoryIds).toEqual([]);
  expect(quickAddDefaults({ menuType: "diary", category: diary, secretUnlocked: true }).categoryIds).toEqual(["diary"]);
  // Calendar / timeline: the picked day, also over 오늘's today.
  const picked = new Date(2026, 9, 30, 8);
  expect(quickAddDefaults({ menuType: TODO_MENU_TYPE.TODAY, day: picked, now: NOW }).due).toBe(endOf(picked));
});

test("the task carries the due, the repeat with its anchor, the categories and the star in one entity", () => {
  const due = new Date(2026, 9, 25, 20).getTime();
  const entity = buildQuickTask("회의", { due, repeat: "week", categoryIds: ["work", "diary"], important: true }).toEntity();
  expect(entity).toMatchObject({ title: "회의", due_date: due, repeat_period: "week", repeat_start_at: due, categories: { work: true, diary: true }, important: true, done: false });
  // No due, no repeat.
  expect(buildQuickTask("x", { due: null, repeat: "day" }).toEntity()).toMatchObject({ due_date: null, repeat_period: null });
});

test("Enter adds (empty and IME composition ignored), then the chips go back to the defaults", () => {
  const { onAdd, input } = setup({ due: endOf(NOW), repeat: null, categoryIds: ["work"], important: false });
  expect(input).toHaveAttribute("placeholder", "할 일 추가");
  expect(chipOf("기한 10월 21일")).toHaveClass("on");
  expect(chipOf("카테고리 업무")).toHaveClass("on");
  type(input, "   ");
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "운동" } });
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "중요" }));
  expect(screen.getByRole("button", { name: "중요" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onAdd).toHaveBeenCalledTimes(1);
  expect(onAdd.mock.calls[0][0].toEntity()).toMatchObject({ title: "운동", due_date: endOf(NOW), categories: { work: true }, important: true });
  expect(input).toHaveValue("");
  expect(screen.getByRole("button", { name: "중요" })).toHaveAttribute("aria-pressed", "false");
});

test("날짜 opens the date picker above the bar; 정하기 sets the chip", () => {
  const { onAdd, input } = setup(quickAddDefaults({ menuType: TODO_MENU_TYPE.ALL }));
  fireEvent.click(screen.getByRole("button", { name: "기한 정하기" }));
  const picker = screen.getByRole("dialog", { name: "기한 정하기" });
  fireEvent.click(screen.getByRole("button", { name: "내일" }));
  fireEvent.click(screen.getByRole("switch", { name: "시간" }));
  fireEvent.click(screen.getByRole("button", { name: "오후 9:00" }));
  fireEvent.click(screen.getByRole("button", { name: "정하기" }));
  expect(picker).not.toBeInTheDocument();
  expect(chipOf("기한 10월 22일 오후 9시")).toHaveClass("on");
  type(input, "산책");
  expect(onAdd.mock.calls[0][0].toEntity().due_date).toBe(new Date(2026, 9, 22, 21).getTime());
});

test("a repeat chosen without a date makes today's end of day the due", () => {
  const { onAdd, input } = setup(quickAddDefaults({ menuType: TODO_MENU_TYPE.ALL }));
  fireEvent.click(screen.getByRole("button", { name: "반복 정하기" }));
  fireEvent.click(screen.getByRole("radio", { name: /매월 21일/ }));
  expect(screen.getByRole("button", { name: "반복 매월 21일" })).toHaveClass("on");
  expect(screen.getByRole("button", { name: "기한 10월 21일" })).toBeInTheDocument();
  type(input, "관리비");
  expect(onAdd.mock.calls[0][0].toEntity()).toMatchObject({ due_date: endOf(NOW), repeat_period: "month", repeat_start_at: endOf(NOW) });
});

test("categories: several at once from the picker", () => {
  const { onAdd, input } = setup(quickAddDefaults({ menuType: TODO_MENU_TYPE.ALL }));
  fireEvent.click(screen.getByRole("button", { name: "카테고리 고르기" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /업무/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /일기/ }));
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(screen.getByRole("button", { name: "카테고리 업무" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "카테고리 일기" })).toBeInTheDocument();
  type(input, "정리");
  expect(onAdd.mock.calls[0][0].toEntity().categories).toEqual({ work: true, diary: true });
});

test("Ctrl+N focuses the field", () => {
  const { input } = setup(quickAddDefaults({}));
  expect(input).not.toHaveFocus();
  fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  expect(input).toHaveFocus();
  input.blur();
  // The Korean layout reports "ㅜ"; the key's place is still KeyN.
  fireEvent.keyDown(window, { key: "ㅜ", code: "KeyN", ctrlKey: true });
  expect(input).toHaveFocus();
});

test("chip ×: the date goes (also the screen's default, and the repeat with it); each category goes", () => {
  const { onAdd, input } = setup({ due: endOf(NOW), repeat: "day", categoryIds: ["work", "diary"], important: false });
  expect(chipOf("기한 10월 21일")).toHaveClass("has-x");
  expect(screen.getByRole("button", { name: "날짜 빼기" })).toHaveAttribute("data-tip", "날짜 빼기");
  fireEvent.click(screen.getByRole("button", { name: "날짜 빼기" }));
  expect(screen.getByRole("button", { name: "기한 정하기" })).not.toHaveClass("on");
  expect(screen.getByRole("button", { name: "반복 정하기" })).not.toHaveClass("on");
  expect(screen.queryByRole("button", { name: "날짜 빼기" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "카테고리 빼기: 업무" }));
  expect(screen.queryByRole("button", { name: "카테고리 업무" })).toBeNull();
  expect(screen.getByRole("button", { name: "카테고리 일기" })).toBeInTheDocument();
  expect(input).toHaveFocus();
  type(input, "기한 없이");
  expect(onAdd.mock.calls[0][0].toEntity()).toMatchObject({ due_date: null, repeat_period: null, categories: { diary: true } });
  // Adding starts the chips over from the screen's defaults; picking a date sets it again.
  expect(chipOf("기한 10월 21일")).toHaveClass("on");
  fireEvent.click(screen.getByRole("button", { name: "날짜 빼기" }));
  fireEvent.click(screen.getByRole("button", { name: "기한 정하기" }));
  fireEvent.click(screen.getByRole("button", { name: "내일" }));
  fireEvent.click(screen.getByRole("button", { name: "정하기" }));
  expect(chipOf("기한 10월 22일")).toHaveClass("on");
});

test("a new day moves untouched chips only; a new screen starts them over", () => {
  const store = configureStore({ reducer: { prefs: prefsReducer } });
  const day = (d) => quickAddDefaults({ menuType: TODO_MENU_TYPE.TODAY, now: d });
  const tomorrow = new Date(2026, 9, 22, 0, 0, 1);
  const ui = (defaults, contextKey) => <Provider store={store}><QuickAdd defaults={defaults} contextKey={contextKey} categories={cats} /></Provider>;
  const { rerender } = render(ui(day(NOW), "today"));
  // Untouched: follows the new day.
  rerender(ui(day(tomorrow), "today"));
  expect(screen.getByRole("button", { name: "기한 10월 22일" })).toBeInTheDocument();
  // Changed (×): stays through midnight.
  fireEvent.click(screen.getByRole("button", { name: "날짜 빼기" }));
  rerender(ui(day(new Date(2026, 9, 23, 0, 0, 1)), "today"));
  expect(screen.getByRole("button", { name: "기한 정하기" })).toBeInTheDocument();
  // Another screen: the chips start over.
  rerender(ui(day(new Date(2026, 9, 23, 0, 0, 1)), "next7"));
  expect(screen.getByRole("button", { name: "기한 10월 23일" })).toBeInTheDocument();
});

test("중요 is left out where the star cannot be stored", () => {
  const { onAdd, input } = setup({ due: null, repeat: null, categoryIds: [], important: true }, { canStar: false });
  expect(screen.queryByRole("button", { name: "중요" })).toBeNull();
  type(input, "별 없음");
  expect(onAdd.mock.calls[0][0].toEntity().important).toBe(false);
});
