import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { Provider } from "react-redux";
import TodoContent from "../TodoContent";
import Task from "../../objects/Task";
import Subtask from "../../objects/Subtask";
import Category from "../../objects/Category";
import IpcSender from "../../utils/IpcSender";
import Toast from "../../molecules/Toast";
import prefsReducer from "../../store/prefsSlice";
import { SecretSessionProvider } from "../../hooks/useSecretSession";
import { useTaskSelection } from "../list/taskSelection";
import { HomeLayoutContext, layoutForWidth } from "../../layouts/homeLayoutContext";
import { usePickedDay } from "./pickedDay";
import { dayTasks, sortByDue } from "./CalendarTab";
import { panelTab } from "./RightPanel";
import { stampText } from "./DetailPanel";

let mockContext;
jest.mock("react-router-dom", () => ({ useOutletContext: () => mockContext }));
jest.mock("../../utils/IpcSender", () => {
  const groups = {};
  return {
    req: new Proxy({}, {
      get: (_, group) => {
        if (!groups[group])
          groups[group] = new Proxy({}, {
            get: (methods, method) => {
              if (!methods[method])
                methods[method] = jest.fn((...args) => {
                  const callback = args.find((value) => typeof value === "function");
                  callback?.({ success: true, data: [] });
                });
              return methods[method];
            },
          });
        return groups[group];
      },
    }),
    vault: { verifyUser: jest.fn(), onLocked: () => () => {} },
    onAll: jest.fn(),
    offAll: jest.fn(),
    off: jest.fn(),
  };
});

const NOW = new Date(2026, 9, 21, 14, 30); // Wednesday
const at = (days, h, m = 0) => { const d = new Date(NOW); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };
let store, publicCategory, secretCategory, tasks;

function makeTask(id, title, due, extra = {}) {
  const task = new Task(title, due);
  task.id = id;
  Object.assign(task, extra);
  return task;
}
function makeSub(id, title, due, extra = {}) {
  const sub = new Subtask(title, due);
  sub.id = id;
  Object.assign(sub, extra);
  return sub;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  jest.clearAllMocks();
  IpcSender.vault.verifyUser.mockImplementation((input, cb) => cb({ success: true, data: input.method === "os" ? { verified: true, method: "os" } : { verified: false, method: "password", code: "PASSWORD_REJECTED", osAvailable: true, passwordAvailable: true } }));
  publicCategory = new Category("개발");
  publicCategory.id = "public";
  publicCategory.color = "#44c98b";
  secretCategory = new Category("비공개", true);
  secretCategory.id = "secret";
  secretCategory.color = "#e57ad6";
  const first = makeTask("first", "리뷰 준비", at(0, 18), { memo: "문서 초안", createdAt: at(-7, 9), updatedAt: at(0, 10, 12) });
  first.addCategory(publicCategory);
  first.addSubtask(makeSub("s1", "초안 쓰기", at(-1, 9), { done: true, createdAt: at(-3, 9) }));
  first.addSubtask(makeSub("s2", "검토 받기", at(0, 12), { createdAt: at(-2, 9) }));
  const loose = makeTask("loose", "아이디어 정리", null);
  const secret = makeTask("secret-task", "비공개 작업", at(0, 9));
  secret.addCategory(secretCategory);
  const repeat = makeTask("repeat", "운동", at(0, 8), { repeatPeriod: "week" });
  const done = makeTask("done", "아침 메일", at(0, 7), { done: true });
  const chain = [first, loose, secret, repeat, done];
  chain.forEach((t, i) => { t.prev = chain[i - 1] ?? null; t.next = chain[i + 1] ?? null; });
  tasks = { first, loose, "secret-task": secret, repeat, done };
  store = configureStore({ reducer: { prefs: prefsReducer } });
  mockContext = {
    selectedTodoMenuType: "모든 할일",
    category: { title: "모든 할일", default: true },
    addPromise: jest.fn(),
    searchQuery: "",
    syncStatus: { protocolVersion: 3 },
    states: { taskMap: tasks, categories: { public: publicCategory, secret: secretCategory } },
  };
});
afterEach(() => {
  act(() => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

let probe, dayProbe;
function Probe() {
  probe = useTaskSelection();
  dayProbe = usePickedDay();
  return null;
}

// width: the window; the overlay host and panelOpen work like HomeLayout's.
function Shell({ width }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [overlayEl, setOverlayEl] = useState(null);
  const value = { ...layoutForWidth(width), sideOpen: false, setSideOpen: () => {}, panelOpen, setPanelOpen, overlayEl };
  return (
    <HomeLayoutContext.Provider value={value}>
      <div className="home-layout">
        <TodoContent><Probe /></TodoContent>
        <div className="home-layout__overlay" ref={setOverlayEl} />
      </div>
    </HomeLayoutContext.Provider>
  );
}
const ui = (width = 1440) => (
  <Provider store={store}>
    <SecretSessionProvider uid="fixture">
      <Shell width={width} />
    </SecretSessionProvider>
  </Provider>
);
const view = (width) => render(ui(width));
const panel = () => document.querySelector(".rp");
const inPanel = () => within(panel());
const row = (id) => document.querySelector(`.todo-content [data-task-id="${id}"]`);
const tab = (name) => inPanel().getByRole("tab", { name });
const select = (id) => fireEvent.click(row(id));

test("tab rules: nothing selected → 캘린더 (상세 off), a selection → 상세, × and Esc let go", () => {
  view();
  expect(tab("캘린더")).toHaveAttribute("aria-selected", "true");
  expect(tab("할 일 상세")).toHaveAttribute("aria-disabled", "true");
  expect(tab("할 일 상세")).toHaveAttribute("data-tip", "할 일을 고르면 열려요");
  // Inline, the calendar tab has nothing to close.
  expect(inPanel().queryByRole("button", { name: /닫기/ })).toBeNull();
  fireEvent.click(tab("할 일 상세"));
  expect(tab("캘린더")).toHaveAttribute("aria-selected", "true");

  select("first");
  expect(tab("할 일 상세")).toHaveAttribute("aria-selected", "true");
  expect(inPanel().getByRole("textbox", { name: "할 일 제목" })).toHaveValue("리뷰 준비");
  // 캘린더 for the same task stays until another task is picked.
  fireEvent.click(tab("캘린더"));
  expect(tab("캘린더")).toHaveAttribute("aria-selected", "true");
  expect(probe.selectedTaskId).toBe("first");
  select("repeat");
  expect(tab("할 일 상세")).toHaveAttribute("aria-selected", "true");
  expect(inPanel().getByRole("textbox", { name: "할 일 제목" })).toHaveValue("운동");

  fireEvent.click(inPanel().getByRole("button", { name: "상세 닫기" }));
  expect(probe.selectedTaskId).toBeNull();
  expect(tab("캘린더")).toHaveAttribute("aria-selected", "true");

  select("first");
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(probe.selectedTaskId).toBeNull();
  expect(tab("캘린더")).toHaveAttribute("aria-selected", "true");
});

test("panelTab: the calendar view has only 선택한 날", () => {
  expect(panelTab({ view: "calendar", selectedId: "a", hold: null })).toBe("day");
  expect(panelTab({ view: "timeline", selectedId: null, hold: null })).toBe("calendar");
  expect(panelTab({ view: "list", selectedId: "a", hold: { id: "a", tab: "calendar" } })).toBe("calendar");
  expect(panelTab({ view: "list", selectedId: "b", hold: { id: "a", tab: "calendar" } })).toBe("detail");
  // A hold from the calendar view's 선택한 날 does not apply to the other views' tabs.
  expect(panelTab({ view: "list", selectedId: "a", hold: { id: "a", tab: "day" } })).toBe("detail");
});

test("below 1000px the panel is a drawer: selecting opens it, × closes it, the selection stays", () => {
  const { container } = view(960);
  expect(panel()).toBeNull();
  expect(container.querySelector(".home-splitter")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "패널 열기" }));
  expect(panel().closest(".home-panel")).toHaveClass("drawer");
  fireEvent.click(inPanel().getByRole("button", { name: "패널 닫기" }));
  expect(panel()).toBeNull();

  select("first");
  expect(panel().closest(".home-panel")).toHaveClass("drawer");
  expect(inPanel().getByRole("textbox", { name: "할 일 제목" })).toHaveValue("리뷰 준비");
  fireEvent.click(inPanel().getByRole("button", { name: "패널 닫기" }));
  expect(panel()).toBeNull();
  expect(probe.selectedTaskId).toBe("first");
  // openTask (열기) opens it too.
  act(() => probe.openTask("repeat"));
  expect(inPanel().getByRole("textbox", { name: "할 일 제목" })).toHaveValue("운동");
});

test("wide: inline with the splitter", () => {
  const { container } = view(1180);
  expect(container.querySelector(".home-splitter")).not.toBeNull();
  expect(panel().closest(".home-panel")).not.toHaveClass("drawer");
  expect(panel().closest(".home-panel")).toHaveStyle({ width: "320px" });
});

test("detail rows: 기한 in the detail format, 반복 by the anchor, 카테고리 chips; no remaining time", () => {
  view();
  select("first");
  expect(inPanel().getByRole("button", { name: "기한: 2026.10.21 오후 6:00" })).toBeInTheDocument();
  expect(inPanel().getByRole("button", { name: "반복: 안 함" })).toBeInTheDocument();
  expect(inPanel().getByRole("button", { name: "카테고리: 개발" })).toBeInTheDocument();
  expect(panel()).not.toHaveTextContent("남음");
  select("repeat");
  expect(inPanel().getByRole("button", { name: "반복: 매주 수요일" })).toBeInTheDocument();
  act(() => { store.dispatch({ type: "prefs/setPrefs", payload: { timeFormat: "24" } }); });
  expect(inPanel().getByRole("button", { name: "기한: 2026.10.21 08:00" })).toBeInTheDocument();
});

test("기한 row → date picker below the row → setDue; a second click closes it", () => {
  view();
  select("first");
  const dueRow = inPanel().getByRole("button", { name: /^기한:/ });
  fireEvent.click(dueRow);
  expect(screen.getByRole("dialog", { name: "기한 정하기" })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("dialog", { name: "기한 정하기" })).getByRole("button", { name: "내일" }));
  fireEvent.click(screen.getByRole("button", { name: "정하기" }));
  expect(IpcSender.req.task.updateTaskDueDate).toHaveBeenCalledWith("first", at(1, 18).getTime(), expect.any(Function));
  expect(screen.queryByRole("dialog", { name: "기한 정하기" })).toBeNull();
  fireEvent.click(dueRow);
  expect(screen.getByRole("dialog", { name: "기한 정하기" })).toBeInTheDocument();
  fireEvent.click(dueRow);
  expect(screen.queryByRole("dialog", { name: "기한 정하기" })).toBeNull();
});

test("반복 on a task without a due: today's end of day first, then the repeat", () => {
  IpcSender.req.task.updateTaskDueDate.mockImplementation((tid, due, cb) => cb?.({ success: true }));
  view();
  select("loose");
  fireEvent.click(inPanel().getByRole("button", { name: "반복: 안 함" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "반복" })).getByRole("radio", { name: /매일/ }));
  const due = IpcSender.req.task.updateTaskDueDate, rep = IpcSender.req.task.updateTaskRepeatPeriod;
  expect(due).toHaveBeenCalledWith("loose", new Date(2026, 9, 21, 23, 59, 59).getTime(), expect.any(Function));
  expect(rep).toHaveBeenCalledWith("loose", "day", expect.any(Function));
  expect(due.mock.invocationCallOrder[0]).toBeLessThan(rep.mock.invocationCallOrder[0]);
  // With a due, only the repeat.
  jest.clearAllMocks();
  select("first");
  fireEvent.click(inPanel().getByRole("button", { name: "반복: 안 함" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "반복" })).getByRole("radio", { name: /매주/ }));
  expect(IpcSender.req.task.updateTaskDueDate).not.toHaveBeenCalled();
  expect(IpcSender.req.task.updateTaskRepeatPeriod).toHaveBeenCalledWith("first", "week", expect.any(Function));
});

test("a refused due leaves the repeat unsent", () => {
  IpcSender.req.task.updateTaskDueDate.mockImplementationOnce((tid, due, cb) => cb?.({ success: false }));
  view();
  select("loose");
  fireEvent.click(inPanel().getByRole("button", { name: "반복: 안 함" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "반복" })).getByRole("radio", { name: /매일/ }));
  expect(IpcSender.req.task.updateTaskRepeatPeriod).not.toHaveBeenCalled();
});

test("chained changes: the repeat waits for the due, the tick for the new category; refusals say so", async () => {
  const errors = jest.spyOn(Toast, "error").mockImplementation(() => {});
  const pickRepeat = (name) => {
    fireEvent.click(inPanel().getByRole("button", { name: /^반복:/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "반복" })).getByRole("radio", { name }));
  };
  IpcSender.req.task.updateTaskDueDate.mockImplementation((tid, due, cb) => cb?.({ success: true }));
  IpcSender.req.task.updateTaskRepeatPeriod.mockImplementation((tid, period, cb) => cb?.({ success: true }));
  // A refused due: no repeat, and a toast.
  IpcSender.req.task.updateTaskDueDate.mockImplementationOnce((tid, due, cb) => cb?.({ success: false }));
  view();
  select("loose");
  pickRepeat(/매일/);
  expect(IpcSender.req.task.updateTaskRepeatPeriod).not.toHaveBeenCalled();
  expect(errors).toHaveBeenLastCalledWith("반복을 정하지 못했어요.");
  // The due stored, the repeat refused by a vault that stayed busy: that says so too.
  IpcSender.req.task.updateTaskRepeatPeriod.mockImplementationOnce((tid, period, cb) => cb?.({ success: false, data: { code: "VAULT_BUSY" } }));
  pickRepeat(/매일/);
  expect(IpcSender.req.task.updateTaskRepeatPeriod).toHaveBeenCalledWith("loose", "day", expect.any(Function));
  expect(errors).toHaveBeenLastCalledWith("반복을 정하지 못했어요. 잠시 뒤에 다시 해 주세요.");
  // 새 카테고리: the task gets it only once it is stored.
  let answer;
  IpcSender.req.category.createCategory.mockImplementation((category, cb) => { answer = (reply) => cb(reply); });
  fireEvent.click(inPanel().getByRole("button", { name: /^카테고리/ }));
  const picker = screen.getByRole("dialog", { name: "카테고리" });
  fireEvent.click(within(picker).getByRole("button", { name: /새 카테고리/ }));
  const name = within(picker).getByRole("textbox", { name: "새 카테고리 이름" });
  fireEvent.change(name, { target: { value: "시험" } });
  fireEvent.keyDown(name, { key: "Enter" });
  expect(IpcSender.req.task.addTaskCategory).not.toHaveBeenCalled();
  await act(async () => { answer({ success: false }); });
  expect(IpcSender.req.task.addTaskCategory).not.toHaveBeenCalled();
  expect(errors).toHaveBeenLastCalledWith("카테고리를 만들지 못했어요.");
  fireEvent.keyDown(within(picker).getByRole("textbox", { name: "새 카테고리 이름" }), { key: "Enter" });
  const sent = IpcSender.req.category.createCategory.mock.calls.at(-1)[0];
  await act(async () => { answer({ success: true, data: { syncV2Ack: true } }); });
  expect(IpcSender.req.task.addTaskCategory).toHaveBeenCalledWith("loose", sent.cid, expect.any(Function));
  errors.mockRestore();
});

test("카테고리 row → picker: toggles, secret ones only while unlocked", async () => {
  view();
  select("first");
  fireEvent.click(inPanel().getByRole("button", { name: "카테고리: 개발" }));
  const picker = screen.getByRole("dialog", { name: "카테고리" });
  expect(within(picker).queryByRole("checkbox", { name: /비공개/ })).toBeNull();
  fireEvent.click(within(picker).getByRole("checkbox", { name: /개발/ }));
  expect(IpcSender.req.task.deleteTaskCategory).toHaveBeenCalledWith("first", "public", expect.any(Function));
  fireEvent.keyDown(picker, { key: "Escape" });
  // After the unlock (eye on) the secret one can be picked.
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "비밀 카테고리 보기" })); });
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await act(async () => {});
  fireEvent.click(inPanel().getByRole("button", { name: /^카테고리:/ }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "카테고리" })).getByRole("checkbox", { name: /비공개/ }));
  expect(IpcSender.req.task.addTaskCategory).toHaveBeenCalledWith("first", "secret", expect.any(Function));
});

test("check and star; no star where it cannot be stored", () => {
  const { unmount } = view();
  select("first");
  const title = inPanel().getByRole("textbox", { name: "할 일 제목" }).closest(".rp-dt-title");
  fireEvent.click(within(title).getByRole("checkbox", { name: "할 일 완료" }));
  // The check shows at once; the change goes out after the list row's completion animation.
  expect(within(title).getByRole("checkbox", { name: "완료 취소" })).toBeChecked();
  expect(IpcSender.req.task.updateTaskDone).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(300); });
  expect(document.querySelector(".task-row.fall")).not.toBeNull();
  act(() => { jest.advanceTimersByTime(500); });
  expect(IpcSender.req.task.updateTaskDone).toHaveBeenCalledWith("first", true, expect.any(Number), expect.any(Function));
  fireEvent.click(within(title).getByRole("button", { name: "중요로 표시" }));
  expect(IpcSender.req.task.updateTaskImportant).toHaveBeenCalledWith("first", true, expect.any(Function));
  unmount();
  mockContext = { ...mockContext, syncStatus: { protocolVersion: 2 } };
  view();
  select("first");
  expect(inPanel().queryByRole("button", { name: "중요로 표시" })).toBeNull();
});

test("title: Enter and leaving save, Esc puts it back, Enter while composing does nothing", () => {
  view();
  select("first");
  const title = inPanel().getByRole("textbox", { name: "할 일 제목" });
  fireEvent.focus(title);
  fireEvent.change(title, { target: { value: "리뷰 준비하기" } });
  fireEvent.keyDown(title, { key: "Enter", keyCode: 229 });
  expect(IpcSender.req.task.updateTaskTitle).not.toHaveBeenCalled();
  fireEvent.keyDown(title, { key: "Escape" });
  fireEvent.blur(title);
  expect(IpcSender.req.task.updateTaskTitle).not.toHaveBeenCalled();
  expect(title).toHaveValue("리뷰 준비");
  // Esc in the field does not let go of the task.
  expect(probe.selectedTaskId).toBe("first");
  fireEvent.focus(title);
  fireEvent.change(title, { target: { value: "  리뷰 끝내기 " } });
  fireEvent.keyDown(title, { key: "Enter" });
  fireEvent.blur(title);
  expect(IpcSender.req.task.updateTaskTitle).toHaveBeenCalledWith("first", "리뷰 끝내기", expect.any(Function));
  // Empty goes back.
  jest.clearAllMocks();
  fireEvent.focus(title);
  fireEvent.change(title, { target: { value: "  " } });
  fireEvent.blur(title);
  expect(IpcSender.req.task.updateTaskTitle).not.toHaveBeenCalled();
  expect(title).toHaveValue("리뷰 준비");
});

test("subtasks: count and bar, check, rename in place, due on the right, 기한 / 기한 빼기 / 삭제, add", () => {
  view();
  select("first");
  const p = panel();
  expect(p.querySelector(".rp-block-h")).toHaveTextContent("하위 할 일1/2");
  expect(within(p).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  const rows = [...p.querySelectorAll(".rp-subt[data-subtask-id]")];
  expect(rows.map((r) => r.dataset.subtaskId)).toEqual(["s1", "s2"]);
  // Done ones are not red; the open one past its due is.
  expect(rows[0].querySelector(".sdue")).toHaveTextContent("어제 오전 9시");
  expect(rows[0].querySelector(".sdue")).not.toHaveClass("over");
  expect(rows[1].querySelector(".sdue")).toHaveTextContent("오후 12시");
  expect(rows[1].querySelector(".sdue")).toHaveClass("over");

  fireEvent.click(within(rows[1]).getByRole("checkbox", { name: /하위 할 일 완료/ }));
  expect(IpcSender.req.task.updateSubtaskDone).toHaveBeenCalledWith("first", "s2", true, expect.any(Number), expect.any(Function));

  fireEvent.click(within(rows[1]).getByRole("button", { name: "검토 받기" }));
  let input = within(rows[1]).getByRole("textbox", { name: "하위 할 일 이름" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "검토 끝" } });
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.blur(input);
  expect(IpcSender.req.task.updateSubtaskTitle).not.toHaveBeenCalled();
  expect(within(rows[1]).getByRole("button", { name: "검토 받기" })).toBeInTheDocument();
  expect(probe.selectedTaskId).toBe("first");
  fireEvent.click(within(rows[1]).getByRole("button", { name: "검토 받기" }));
  input = within(rows[1]).getByRole("textbox", { name: "하위 할 일 이름" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "검토 끝" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.blur(input);
  expect(IpcSender.req.task.updateSubtaskTitle).toHaveBeenCalledWith("first", "s2", "검토 끝", expect.any(Function));

  fireEvent.click(within(rows[1]).getByRole("button", { name: "기한 바꾸기" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "기한 정하기" })).getByRole("button", { name: "내일" }));
  fireEvent.click(screen.getByRole("button", { name: "정하기" }));
  expect(IpcSender.req.task.updateSubtaskDueDate).toHaveBeenCalledWith("first", "s2", at(1, 12).getTime(), expect.any(Function));
  fireEvent.click(within(rows[1]).getByRole("button", { name: "기한 빼기" }));
  expect(IpcSender.req.task.updateSubtaskDueDate).toHaveBeenLastCalledWith("first", "s2", null, expect.any(Function));
  fireEvent.click(within(rows[0]).getByRole("button", { name: "하위 할 일 삭제" }));
  expect(IpcSender.req.task.deleteSubtask).toHaveBeenCalledWith("first", "s1", expect.any(Function));

  const add = within(p).getByRole("textbox", { name: "하위 할 일 추가" });
  fireEvent.change(add, { target: { value: "배포" } });
  fireEvent.keyDown(add, { key: "Enter", keyCode: 229 });
  expect(IpcSender.req.task.createSubtask).not.toHaveBeenCalled();
  fireEvent.keyDown(add, { key: "Enter" });
  expect(IpcSender.req.task.createSubtask).toHaveBeenCalledWith(expect.objectContaining({ title: "배포", due_date: null }), "first", expect.any(Function));
  expect(add).toHaveValue("");
});

test("memo: saved after a pause and on leaving, with the placeholder when empty", () => {
  view();
  select("loose");
  const memo = inPanel().getByRole("textbox", { name: "메모" });
  expect(memo).toHaveAttribute("placeholder", "메모를 적어 두세요");
  fireEvent.focus(memo);
  fireEvent.change(memo, { target: { value: "첫 줄" } });
  expect(IpcSender.req.task.updateTaskMemo).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(800); });
  expect(IpcSender.req.task.updateTaskMemo).toHaveBeenCalledWith("loose", "첫 줄", expect.any(Function));
  fireEvent.change(memo, { target: { value: "첫 줄\n둘째 줄" } });
  fireEvent.blur(memo);
  expect(IpcSender.req.task.updateTaskMemo).toHaveBeenLastCalledWith("loose", "첫 줄\n둘째 줄", expect.any(Function));
  expect(IpcSender.req.task.updateTaskMemo).toHaveBeenCalledTimes(2);
  // Switching tasks mid-typing saves to the task it was typed for.
  fireEvent.focus(memo);
  fireEvent.change(memo, { target: { value: "끝" } });
  select("first");
  expect(IpcSender.req.task.updateTaskMemo).toHaveBeenLastCalledWith("loose", "끝", expect.any(Function));
});

test("stamp: 만든 날 · 마지막 수정, left out when unknown", () => {
  view();
  select("first");
  expect(panel().querySelector(".rp-stamp")).toHaveTextContent("만든 날 10월 14일 · 마지막 수정 오늘 오전 10:12");
  expect(stampText(null, NOW.getTime())).toBeNull();
  expect(stampText(new Date(2025, 0, 2), NOW.getTime())).toBe("2025년 1월 2일");
  expect(stampText(at(-1, 21), NOW.getTime(), "24", true)).toBe("어제 21:00");
});

test("calendar tab: mini month and the picked day shared through usePickedDay", () => {
  view();
  const p = panel();
  expect(p.querySelector(".tp-mm-c.today")).toHaveAttribute("data-day", "2026-10-21");
  expect(p.querySelector(".tp-mm-c.picked")).toHaveAttribute("data-day", "2026-10-21");
  // Marks: open tasks today (one overdue: 운동 at 8:00, 9:00 is hidden).
  expect(p.querySelector('[data-day="2026-10-21"] i')).toHaveClass("over");
  expect(p.querySelector(".rp-block-h")).toHaveTextContent("10월 21일 (수) · 오늘");
  fireEvent.click(within(p).getByRole("button", { name: "10월 23일 금요일" }));
  expect(dayProbe.pickedDay).toBe(new Date(2026, 9, 23).getTime());
  expect(p.querySelector(".rp-block-h")).toHaveTextContent("10월 23일 (금)0개 남음");
  expect(p).toHaveTextContent("이날은 할 일이 없어요");
  act(() => dayProbe.setPickedDay(new Date(2026, 10, 3, 15)));
  expect(dayProbe.pickedDay).toBe(new Date(2026, 10, 3).getTime());
  expect(p.querySelector(".tp-mm-title")).toHaveTextContent("2026년 11월");
});

test("day list: open ones by due, then the done ones struck through, hidden secret tasks left out; click opens, right-click the menu keeps the tab", () => {
  view();
  const items = () => [...panel().querySelectorAll(".rp-ai")];
  expect(items().map((el) => el.dataset.taskId)).toEqual(["repeat", "first", "done"]);
  expect(items()[2]).toHaveClass("done");
  expect(panel().querySelector(".rp-block-h")).toHaveTextContent("2개 남음");
  expect(items()[0].querySelector(".rp-tm")).toHaveTextContent("오전 8시");
  expect(items()[0].querySelector(".rp-tm")).toHaveClass("over");

  fireEvent.contextMenu(items()[1], { clientX: 900, clientY: 300 });
  expect(screen.getByRole("menu")).toBeInTheDocument();
  expect(probe.selectedTaskId).toBe("first");
  expect(tab("캘린더")).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

  fireEvent.click(items()[0]);
  expect(probe.selectedTaskId).toBe("repeat");
  expect(tab("할 일 상세")).toHaveAttribute("aria-selected", "true");
});

test("dayTasks / sortByDue", () => {
  const a = makeTask("a", "a", at(0, 20)), b = makeTask("b", "b", at(0, 9)), c = makeTask("c", "c", at(1, 9));
  const d = makeTask("d", "d", at(0, 9), { done: true });
  expect(dayTasks({ a, b, c, d }, NOW.getTime()).map((t) => t.id)).toEqual(["b", "a", "d"]);
  expect(dayTasks({ a, b, c, d }, NOW.getTime(), { hideDone: true }).map((t) => t.id)).toEqual(["b", "a"]);
  expect(sortByDue([makeTask("n", "n", null), a]).map((t) => t.id)).toEqual(["a", "n"]);
});

test("calendar view: the panel shows only 선택한 날; a day item opens the detail beside the list", () => {
  view();
  fireEvent.click(screen.getByRole("button", { name: "캘린더" }));
  expect(inPanel().getAllByRole("tab").map((t) => t.textContent)).toEqual(["선택한 날"]);
  expect(panel().querySelector(".tp-mm")).toBeNull();
  fireEvent.click(panel().querySelector('.rp-ai[data-task-id="first"]'));
  expect(probe.selectedTaskId).toBe("first");
  expect(document.querySelector(".task-view.list")).not.toBeNull();
  expect(tab("할 일 상세")).toHaveAttribute("aria-selected", "true");
});

test("secret visibility: a hidden secret task is never in the panel", async () => {
  view();
  act(() => probe.setSelectedTaskId("secret-task"));
  expect(probe.selectedTask).toBeNull();
  expect(tab("캘린더")).toHaveAttribute("aria-selected", "true");
  expect(panel()).not.toHaveTextContent("비공개 작업");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "비밀 카테고리 보기" })); });
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await act(async () => {});
  expect(panel()).toHaveTextContent("비공개 작업");
  select("secret-task");
  expect(inPanel().getByRole("button", { name: "카테고리: 비공개" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "비밀 카테고리 숨기기" }));
  expect(probe.selectedTaskId).toBeNull();
  expect(panel()).not.toHaveTextContent("비공개 작업");
});

test("a day-list right-click in the calendar view, then back to the list: a tab is active", () => {
  view();
  fireEvent.click(screen.getByRole("button", { name: "캘린더" }));
  fireEvent.contextMenu(panel().querySelector('.rp-ai[data-task-id="first"]'), { clientX: 900, clientY: 300 });
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(probe.selectedTaskId).toBe("first");
  fireEvent.click(screen.getByRole("button", { name: "목록" }));
  expect(tab("할 일 상세")).toHaveAttribute("aria-selected", "true");
  expect(inPanel().getByRole("textbox", { name: "할 일 제목" })).toHaveValue("리뷰 준비");
});

test("opening the task already selected shows its detail again (row click, day list, 열기)", () => {
  view();
  select("first");
  fireEvent.click(tab("캘린더"));
  select("first");
  expect(tab("할 일 상세")).toHaveAttribute("aria-selected", "true");
  // From the 캘린더 tab's day list: right-click keeps the tab, 열기 shows the detail.
  fireEvent.click(tab("캘린더"));
  fireEvent.contextMenu(panel().querySelector('.rp-ai[data-task-id="first"]'), { clientX: 900, clientY: 300 });
  expect(tab("캘린더")).toHaveAttribute("aria-selected", "true");
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /열기/ }));
  expect(tab("할 일 상세")).toHaveAttribute("aria-selected", "true");
  fireEvent.click(tab("캘린더"));
  fireEvent.click(panel().querySelector('.rp-ai[data-task-id="first"]'));
  expect(tab("할 일 상세")).toHaveAttribute("aria-selected", "true");
});

test("tabs: ids, aria-controls / aria-labelledby, ← → move between the tabs that can open", () => {
  view();
  expect(tab("캘린더")).toHaveAttribute("aria-controls", "rp-tabpanel");
  expect(inPanel().getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tab("캘린더").id);
  // Nothing selected: 상세 cannot open, the arrows stay on 캘린더.
  tab("캘린더").focus();
  fireEvent.keyDown(tab("캘린더"), { key: "ArrowLeft" });
  expect(tab("캘린더")).toHaveAttribute("aria-selected", "true");
  select("first");
  expect(tab("할 일 상세")).toHaveAttribute("tabindex", "0");
  expect(tab("캘린더")).toHaveAttribute("tabindex", "-1");
  tab("할 일 상세").focus();
  fireEvent.keyDown(tab("할 일 상세"), { key: "ArrowRight" });
  expect(tab("캘린더")).toHaveAttribute("aria-selected", "true");
  expect(document.activeElement).toBe(tab("캘린더"));
  expect(inPanel().getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tab("캘린더").id);
  fireEvent.keyDown(tab("캘린더"), { key: "ArrowRight" });
  expect(tab("할 일 상세")).toHaveAttribute("aria-selected", "true");
  expect(document.activeElement).toBe(tab("할 일 상세"));
});

test("title: a title synced while the field only has focus shows, and leaving does not write the old one back", () => {
  const { rerender } = view();
  select("first");
  const title = inPanel().getByRole("textbox", { name: "할 일 제목" });
  fireEvent.focus(title);
  tasks.first.title = "원격에서 바뀐 제목";
  mockContext = { ...mockContext, states: { ...mockContext.states, taskMap: { ...tasks } } };
  rerender(ui());
  expect(title).toHaveValue("원격에서 바뀐 제목");
  fireEvent.blur(title);
  expect(IpcSender.req.task.updateTaskTitle).not.toHaveBeenCalled();
  // The same for a subtask name being edited.
  const sub = panel().querySelector('.rp-subt[data-subtask-id="s2"]');
  fireEvent.click(within(sub).getByRole("button", { name: "검토 받기" }));
  const input = within(sub).getByRole("textbox", { name: "하위 할 일 이름" });
  fireEvent.focus(input);
  tasks.first.subtasks.s2.title = "검토 다시";
  mockContext = { ...mockContext, states: { ...mockContext.states, taskMap: { ...tasks } } };
  rerender(ui());
  expect(input).toHaveValue("검토 다시");
  fireEvent.blur(input);
  expect(IpcSender.req.task.updateSubtaskTitle).not.toHaveBeenCalled();
});

test("title: pasted line breaks become spaces", () => {
  view();
  select("first");
  const title = inPanel().getByRole("textbox", { name: "할 일 제목" });
  fireEvent.focus(title);
  fireEvent.change(title, { target: { value: "리뷰\n준비\r\n 끝" } });
  expect(title).toHaveValue("리뷰 준비 끝");
  fireEvent.blur(title);
  expect(IpcSender.req.task.updateTaskTitle).toHaveBeenCalledWith("first", "리뷰 준비 끝", expect.any(Function));
});

test("a title or memo being typed is saved when the panel changes task or the window closes", () => {
  view();
  select("first");
  const title = inPanel().getByRole("textbox", { name: "할 일 제목" });
  fireEvent.focus(title);
  fireEvent.change(title, { target: { value: "리뷰 준비 2" } });
  select("loose");
  expect(IpcSender.req.task.updateTaskTitle).toHaveBeenCalledWith("first", "리뷰 준비 2", expect.any(Function));
  // Untouched: nothing.
  jest.clearAllMocks();
  select("first");
  select("loose");
  expect(IpcSender.req.task.updateTaskTitle).not.toHaveBeenCalled();

  const memo = inPanel().getByRole("textbox", { name: "메모" });
  fireEvent.focus(memo);
  fireEvent.change(memo, { target: { value: "닫기 직전" } });
  act(() => { window.dispatchEvent(new Event("pagehide")); });
  expect(IpcSender.req.task.updateTaskMemo).toHaveBeenCalledWith("loose", "닫기 직전", expect.any(Function));
  const t2 = inPanel().getByRole("textbox", { name: "할 일 제목" });
  fireEvent.focus(t2);
  fireEvent.change(t2, { target: { value: "아이디어 정리 끝" } });
  act(() => { window.dispatchEvent(new Event("beforeunload")); });
  expect(IpcSender.req.task.updateTaskTitle).toHaveBeenCalledWith("loose", "아이디어 정리 끝", expect.any(Function));
  expect(IpcSender.req.task.updateTaskMemo).toHaveBeenCalledTimes(1);
});

test("the title and memo grow again when the panel width changes", () => {
  const observers = [];
  const Real = window.ResizeObserver;
  window.ResizeObserver = class {
    constructor(cb) { this.cb = cb; this.els = []; observers.push(this); }
    observe(el) { this.els.push(el); }
    disconnect() {}
  };
  try {
    view();
    select("first");
    const title = inPanel().getByRole("textbox", { name: "할 일 제목" });
    const watcher = observers.find((o) => o.els.includes(title));
    expect(watcher).toBeTruthy();
    let width = 300;
    Object.defineProperty(title, "clientWidth", { configurable: true, get: () => width });
    Object.defineProperty(title, "scrollHeight", { configurable: true, get: () => 48 });
    act(() => watcher.cb([]));
    title.style.height = "24px";
    // A change of its own height (same width) is left alone.
    act(() => watcher.cb([]));
    expect(title.style.height).toBe("24px");
    width = 220;
    act(() => watcher.cb([]));
    expect(title.style.height).toBe("48px");
    expect(observers.some((o) => o.els.includes(inPanel().getByRole("textbox", { name: "메모" })))).toBe(true);
  } finally {
    window.ResizeObserver = Real;
  }
});

test("no chosen time (23:59): the detail reads 하루 끝, the day list too; a secret category marks with the shield", async () => {
  const eod = makeTask("eod", "마감 정리", new Date(2026, 9, 21, 23, 59, 59));
  eod.addCategory(publicCategory);
  eod.addCategory(secretCategory);
  eod.prev = tasks.done;
  tasks.done.next = eod;
  mockContext = { ...mockContext, states: { ...mockContext.states, taskMap: { ...tasks, eod } } };
  view();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "비밀 카테고리 보기" })); });
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await act(async () => {});
  const item = panel().querySelector('.rp-ai[data-task-id="eod"]');
  expect(item.querySelector(".rp-tm")).toHaveTextContent("하루 끝");
  // 개발 comes first in sidebar order, but any secret category gives the shield.
  expect(item.querySelector(".rp-shield")).not.toBeNull();
  expect(item.querySelector(".rp-dot")).toBeNull();
  select("eod");
  expect(inPanel().getByRole("button", { name: "기한: 2026.10.21 · 하루 끝" })).toBeInTheDocument();
  act(() => { store.dispatch({ type: "prefs/setPrefs", payload: { timeFormat: "24" } }); });
  expect(inPanel().getByRole("button", { name: "기한: 2026.10.21 · 하루 끝" })).toBeInTheDocument();
});

test("the picked day follows today past midnight until another day is picked", () => {
  jest.setSystemTime(new Date(2026, 9, 21, 23, 59, 58));
  view();
  expect(dayProbe.pickedDay).toBe(new Date(2026, 9, 21).getTime());
  act(() => { jest.advanceTimersByTime(3000); });
  expect(dayProbe.pickedDay).toBe(new Date(2026, 9, 22).getTime());
  act(() => dayProbe.setPickedDay(new Date(2026, 9, 25)));
  jest.setSystemTime(new Date(2026, 9, 22, 23, 59, 58));
  act(() => { jest.advanceTimersByTime(3000); });
  expect(dayProbe.pickedDay).toBe(new Date(2026, 9, 25).getTime());
  // Picking today again follows the date once more.
  act(() => dayProbe.setPickedDay(new Date(2026, 9, 23, 8)));
  jest.setSystemTime(new Date(2026, 9, 23, 23, 59, 58));
  act(() => { jest.advanceTimersByTime(3000); });
  expect(dayProbe.pickedDay).toBe(new Date(2026, 9, 24).getTime());
});
