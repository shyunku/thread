import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import TodoContent from "./TodoContent";
import Task from "../objects/Task";
import Category from "../objects/Category";
import IpcSender from "../utils/IpcSender";
import { fromSyncV2View } from "../utils/syncV2View";
import prefsReducer, { setPrefs } from "../store/prefsSlice";
import { SecretSessionProvider, useSecretSession } from "../hooks/useSecretSession";
import { useTaskSelection } from "./list/taskSelection";
import Toast from "../molecules/Toast";
import { HomeLayoutContext, layoutForWidth } from "../layouts/homeLayoutContext";

let mockContext;
jest.mock("react-router-dom", () => ({ useOutletContext: () => mockContext }));
jest.mock("../utils/IpcSender", () => {
  const groups = {};
  return {
    req: new Proxy(
      {},
      {
        get: (_, group) => {
          if (!groups[group])
            groups[group] = new Proxy(
              {},
              {
                get: (methods, method) => {
                  if (!methods[method])
                    methods[method] = jest.fn((...args) => {
                      const callback = args.find((value) => typeof value === "function");
                      callback?.({ success: true, data: [] });
                    });
                  return methods[method];
                },
              }
            );
          return groups[group];
        },
      }
    ),
    vault: { verifyUser: jest.fn(), onLocked: () => () => {} },
    onAll: jest.fn(),
    offAll: jest.fn(),
    off: jest.fn(),
  };
});

const NOW = new Date(2026, 9, 21, 14, 30); // Wednesday
const at = (days, h, m = 0) => { const d = new Date(NOW); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };
let store, publicCategory, secretCategory;

function makeTask(id, title, due, extra = {}) {
  const task = new Task(title, due);
  task.id = id;
  Object.assign(task, extra);
  return task;
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
  const first = makeTask("first", "리뷰 준비", at(0, 18), { memo: "문서 초안" });
  first.addCategory(publicCategory);
  const second = makeTask("second", "배포 완료", null, { done: true });
  const secret = makeTask("secret-task", "비공개 작업", at(1, 9));
  secret.addCategory(secretCategory);
  const repeat = makeTask("repeat", "운동", at(0, 21), { repeatPeriod: "day" });
  const chain = [first, second, secret, repeat];
  chain.forEach((t, i) => { t.prev = chain[i - 1] ?? null; t.next = chain[i + 1] ?? null; });
  store = configureStore({ reducer: { prefs: prefsReducer } });
  mockContext = {
    selectedTodoMenuType: "모든 할일",
    category: { title: "모든 할일", default: true },
    addPromise: jest.fn(),
    searchQuery: "",
    syncStatus: { protocolVersion: 3 },
    states: {
      taskMap: { first, second, "secret-task": secret, repeat },
      categories: { public: publicCategory, secret: secretCategory },
    },
  };
});
afterEach(() => {
  act(() => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
  document.querySelectorAll(".task-row.fall").forEach((el) => el.remove());
});

let selectionProbe;
let secretProbe;
function Probe() {
  selectionProbe = useTaskSelection();
  secretProbe = useSecretSession();
  return null;
}
// The top-bar lock (SecretLock) opens: Hello, then 확인.
async function unlockSecrets() {
  await act(async () => { secretProbe.unlock(); });
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await act(async () => {});
}
const ui = () => (
  <Provider store={store}>
    <SecretSessionProvider uid="fixture">
      <TodoContent><Probe /></TodoContent>
    </SecretSessionProvider>
  </Provider>
);
const view = () => render(ui());
const row = (container, id) => container.querySelector(`[data-task-id="${id}"]`);
const rowIds = (container) => [...container.querySelectorAll(".task-row")].map((r) => r.dataset.taskId);

test("header: title, summary with the overdue count, and the view switch in every menu (no split view)", () => {
  const { container, rerender } = view();
  expect(screen.getByRole("heading", { name: "모든 할 일" })).toBeInTheDocument();
  expect(container.querySelector(".tc-finding")).toHaveTextContent("남은 할 일 2개");
  expect(screen.queryByRole("button", { name: "전체 4" })).toBeNull();
  expect(screen.queryByRole("button", { name: "기한 순" })).toBeNull();
  act(() => { jest.setSystemTime(at(0, 18, 30)); jest.advanceTimersByTime(1000); });
  expect(container.querySelector(".tc-finding")).toHaveTextContent("남은 할 일 2개 · 기한 지남 1개");
  mockContext = { ...mockContext, selectedTodoMenuType: "오늘의 할일", category: { title: "오늘의 할일", default: true } };
  rerender(ui());
  expect(screen.getByRole("heading", { name: "오늘" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "캘린더" }));
  expect(container.querySelector(".task-view.calendar")).not.toBeNull();
  expect(container.querySelector(".task-view.list")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
  expect(container.querySelector(".task-timeline-view")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "목록" }));
  expect(container.querySelector(".task-view.list")).not.toBeNull();
});

test("secret tasks: hidden while locked, shown everywhere once the lock opens, with the shield", async () => {
  const { container } = view();
  expect(row(container, "secret-task")).toBeNull();
  // The lock is in the top bar now, not in the header.
  expect(screen.queryByRole("button", { name: /비밀 카테고리/ })).toBeNull();
  await unlockSecrets();
  expect(row(container, "secret-task")).not.toBeNull();
  expect(row(container, "secret-task").querySelector(".meta .shield")).not.toBeNull();
  act(() => secretProbe.lock());
  expect(row(container, "secret-task")).toBeNull();
});

test("a locked secret category shows the locked state, which unlocks", async () => {
  mockContext = { ...mockContext, selectedTodoMenuType: "secret", category: secretCategory };
  const { container } = view();
  expect(screen.getByText("이 카테고리는 잠겨 있어요")).toBeInTheDocument();
  expect(container.querySelector(".tc-finding")).toHaveTextContent("비밀 카테고리");
  expect(screen.queryByRole("textbox", { name: "새 할 일" })).toBeNull();
  expect(screen.queryByRole("button", { name: /비밀 카테고리 보기/ })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Windows Hello로 열기" })); });
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await act(async () => {});
  expect(rowIds(container)).toEqual(["secret-task"]);
  // Inside its own category the secret name shows; the quick add starts with it.
  expect(row(container, "secret-task").querySelector(".meta .cat b")).toHaveTextContent("비공개");
  expect(screen.getByRole("button", { name: "카테고리 비공개" })).toBeInTheDocument();
});

test("search covers every task whatever the menu and groups the results", () => {
  mockContext = { ...mockContext, selectedTodoMenuType: "오늘의 할일", category: { title: "오늘의 할일", default: true } };
  const { container, rerender } = view();
  mockContext = { ...mockContext, searchQuery: "문서" };
  rerender(ui());
  expect(screen.getByRole("heading", { name: "검색" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "메모에서 1개" })).toBeInTheDocument();
  expect(screen.getByText("제목 0개 · 메모 1개 · 카테고리 0개")).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "새 할 일" })).toBeNull();
  // Not due today and done: still found from 오늘.
  mockContext = { ...mockContext, searchQuery: "배포" };
  rerender(ui());
  expect(rowIds(container)).toEqual(["second"]);
  mockContext = { ...mockContext, searchQuery: "개발" };
  rerender(ui());
  expect(rowIds(container)).toEqual(["first"]);
});

test("search while locked leaves secret tasks and secret category names out; unlocked they are plain results", async () => {
  const { container, rerender } = view();
  mockContext = { ...mockContext, searchQuery: "비공개" };
  rerender(ui());
  expect(rowIds(container)).toEqual([]);
  expect(screen.getByText("제목 0개 · 메모 0개 · 카테고리 0개")).toBeInTheDocument();
  await unlockSecrets();
  expect(rowIds(container)).toEqual(["secret-task"]);
  expect(row(container, "secret-task")).not.toHaveClass("hidden-hit");
  fireEvent.click(row(container, "secret-task"));
  expect(selectionProbe.selectedTaskId).toBe("secret-task");
});

test("a locked secret category shows the locked state in the calendar and timeline too", async () => {
  mockContext = { ...mockContext, selectedTodoMenuType: "secret", category: secretCategory };
  const { container } = view();
  fireEvent.click(screen.getByRole("button", { name: "캘린더" }));
  expect(screen.getByText("이 카테고리는 잠겨 있어요")).toBeInTheDocument();
  expect(container.querySelector(".task-view.calendar")).toBeNull();
  expect(screen.getByRole("button", { name: "캘린더" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "타임라인" }));
  expect(screen.getByText("이 카테고리는 잠겨 있어요")).toBeInTheDocument();
  expect(container.querySelector(".task-timeline-view")).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Windows Hello로 열기" })); });
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await act(async () => {});
  expect(container.querySelector(".task-timeline-view")).not.toBeNull();
  expect(screen.queryByText("이 카테고리는 잠겨 있어요")).toBeNull();
});

test("search: no hidden hits in the calendar; a locked category screen shows the results", async () => {
  mockContext = { ...mockContext, selectedTodoMenuType: "secret", category: secretCategory, searchQuery: "작업" };
  const { container, rerender } = view();
  expect(screen.queryByText("이 카테고리는 잠겨 있어요")).toBeNull();
  // Locked: the secret task is not among the results either.
  expect(rowIds(container)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "캘린더" }));
  expect(container.querySelector(".task-view.calendar")).not.toBeNull();
  expect(screen.queryByText("비공개 작업")).toBeNull();
  // The summary says it shows search results.
  expect(container.querySelector(".tc-finding")).toHaveTextContent(/^검색 결과 0개 · /);
  mockContext = { ...mockContext, searchQuery: "리뷰" };
  rerender(ui());
  expect(screen.getAllByText("리뷰 준비").length).toBeGreaterThan(0);
  expect(container.querySelector(".tc-finding")).toHaveTextContent(/^검색 결과 1개 · /);
});

test("the selection leaves a task that gets hidden; Del then asks nothing", async () => {
  const { container } = view();
  await unlockSecrets();
  fireEvent.click(row(container, "secret-task"));
  expect(selectionProbe.selectedTask.title).toBe("비공개 작업");
  act(() => secretProbe.lock());
  expect(row(container, "secret-task")).toBeNull();
  expect(selectionProbe.selectedTaskId).toBe(null);
  expect(selectionProbe.selectedTask).toBe(null);
  fireEvent.keyDown(document.body, { key: "Delete" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("the selection is dropped on a menu that does not show the task", () => {
  const { container, rerender } = view();
  fireEvent.click(row(container, "repeat"));
  expect(selectionProbe.selectedTaskId).toBe("repeat");
  mockContext = { ...mockContext, selectedTodoMenuType: "public", category: publicCategory };
  rerender(ui());
  expect(selectionProbe.selectedTaskId).toBe(null);
  fireEvent.keyDown(document.body, { key: "Delete" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("keyboard: Enter opens, Space completes (with the animation), arrows move", () => {
  const { container } = view();
  const first = row(container, "first");
  first.focus();
  fireEvent.keyDown(first, { key: "Enter" });
  expect(selectionProbe.selectedTaskId).toBe("first");
  fireEvent.keyDown(first, { key: " " });
  expect(within(first).getByRole("checkbox")).toHaveClass("pop");
  act(() => { jest.advanceTimersByTime(136 + 425); });
  expect(IpcSender.req.task.updateTaskDone).toHaveBeenCalledWith("first", true, expect.any(Number), expect.any(Function));
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement).not.toBe(first);
  expect(document.activeElement).toHaveClass("task-row");
});

test("a refused completion shows the row again with a toast; success says nothing", () => {
  const errors = jest.spyOn(Toast, "error").mockImplementation(() => {});
  let reply = { success: false };
  IpcSender.req.task.updateTaskDone.mockImplementation((tid, done, at, cb) => cb?.(reply));
  const { container } = view();
  fireEvent.click(within(row(container, "first")).getByRole("checkbox", { name: "할 일 완료" }));
  act(() => { jest.advanceTimersByTime(136 + 425 + 20); });
  expect(row(container, "first").style.visibility).toBe("");
  expect(row(container, "first")).not.toHaveClass("closing");
  expect(errors).toHaveBeenCalledWith("완료하지 못했어요.");
  errors.mockClear();
  // The check goes back once the pop is over.
  act(() => { jest.advanceTimersByTime(1200); });
  expect(within(row(container, "first")).getByRole("checkbox")).not.toHaveClass("done");
  reply = { success: true };
  fireEvent.click(within(row(container, "first")).getByRole("checkbox", { name: "할 일 완료" }));
  act(() => { jest.advanceTimersByTime(136 + 425 + 20); });
  // Waiting for the list to drop it: still hidden, no toast (a slow answer is not a failure).
  act(() => { jest.advanceTimersByTime(2000); });
  expect(row(container, "first").style.visibility).toBe("hidden");
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

test("Esc clears the selection when a stale sideOpen has no drawer; not while the drawer is open", () => {
  const layout = (hideSide) => ({ ...layoutForWidth(hideSide ? 760 : 1440), sideOpen: true, setSideOpen: () => {}, panelOpen: false, setPanelOpen: () => {}, overlayEl: null });
  const withLayout = (hideSide) => (
    <HomeLayoutContext.Provider value={layout(hideSide)}>{ui()}</HomeLayoutContext.Provider>
  );
  const { container, rerender } = render(withLayout(false));
  fireEvent.click(row(container, "first"));
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(selectionProbe.selectedTaskId).toBe(null);
  rerender(withLayout(true));
  fireEvent.click(row(container, "first"));
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(selectionProbe.selectedTaskId).toBe("first");
});

test("a subtask due of null clears it (no NaN)", () => {
  view();
  act(() => { selectionProbe.actions.setSubtaskDue("first", "sub", null); });
  expect(IpcSender.req.task.updateSubtaskDueDate).toHaveBeenLastCalledWith("first", "sub", null, expect.any(Function));
  const due = at(1, 9);
  act(() => { selectionProbe.actions.setSubtaskDue("first", "sub", due); });
  expect(IpcSender.req.task.updateSubtaskDueDate).toHaveBeenLastCalledWith("first", "sub", due.getTime(), expect.any(Function));
});

test("decrypted application view: groups by date with the stored order and category names", () => {
  const viewData = {
    tasks: [
      { tid: "a", title: "Alpha", memo: "", created_at: 300, due_date: at(3, 9).getTime(), next: "b" },
      { tid: "b", title: "Beta", memo: "Needle", created_at: 100, due_date: at(0, 9).getTime(), next: "c" },
      { tid: "c", title: "Gamma", memo: "", created_at: 200, due_date: 0, next: null }],
    categories: [{ cid: "work", title: "검색카테고리", secret: false, locked: false }],
    subtasks: [], relations: [{ tid: "a", cid: "work" }],
  };
  mockContext = { ...mockContext, states: fromSyncV2View(viewData) };
  const { container } = view();
  expect(rowIds(container)).toEqual(["b", "a", "c"]);
  expect(row(container, "a").querySelector(".meta .cat b")).toHaveTextContent("검색카테고리");
  act(() => { store.dispatch(setPrefs({ group: "none", sort: "created" })); });
  expect(rowIds(container)).toEqual(["a", "c", "b"]);
});

test("completing animates first and sends the change once; a repeating task rolls forward without falling", () => {
  const { container } = view();
  const check = within(row(container, "first")).getByRole("checkbox", { name: "할 일 완료" });
  fireEvent.click(check);
  fireEvent.click(check);
  expect(check).toHaveClass("done", "pop");
  expect(IpcSender.req.task.updateTaskDone).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(136); });
  const copy = document.querySelector("body > .task-row.fall");
  expect(copy).not.toBeNull();
  expect(row(container, "first").style.visibility).toBe("hidden");
  act(() => { jest.advanceTimersByTime(425); });
  expect(document.querySelector("body > .task-row.fall")).toBeNull();
  expect(IpcSender.req.task.updateTaskDone).toHaveBeenCalledTimes(1);
  expect(IpcSender.req.task.updateTaskDone).toHaveBeenCalledWith("first", true, expect.any(Number), expect.any(Function));

  fireEvent.click(within(row(container, "repeat")).getByRole("checkbox", { name: "할 일 완료" }));
  act(() => { jest.advanceTimersByTime(136); });
  expect(document.querySelector("body > .task-row.fall")).toBeNull();
  act(() => { jest.advanceTimersByTime(100); });
  expect(IpcSender.req.task.updateTaskDone).toHaveBeenLastCalledWith("repeat", true, expect.any(Number), expect.any(Function));
  expect(IpcSender.req.task.updateTaskDone).toHaveBeenCalledTimes(2);
});

test("un-checking a done task sends it at once; the star toggles", () => {
  store.dispatch(setPrefs({ groupClosed: { done: false } }));
  const { container } = view();
  fireEvent.click(within(row(container, "second")).getByRole("checkbox", { name: "완료 취소" }));
  expect(IpcSender.req.task.updateTaskDone).toHaveBeenCalledWith("second", false, expect.any(Number), expect.any(Function));
  fireEvent.click(within(row(container, "first")).getByRole("button", { name: "중요로 표시" }));
  expect(IpcSender.req.task.updateTaskImportant).toHaveBeenCalledWith("first", true, expect.any(Function));
});

test("selection: click selects (shared through useTaskSelection), Enter opens, Esc clears unless a popup took it", () => {
  const { container } = view();
  fireEvent.click(row(container, "first"));
  expect(row(container, "first")).toHaveClass("sel");
  expect(selectionProbe.selectedTaskId).toBe("first");
  expect(selectionProbe.selectedTask.title).toBe("리뷰 준비");
  // Esc while the task menu is open closes only the menu.
  fireEvent.contextMenu(row(container, "repeat"), { clientX: 300, clientY: 200 });
  expect(selectionProbe.selectedTaskId).toBe("repeat");
  fireEvent.keyDown(screen.getByRole("menu", { name: "할 일 메뉴" }), { key: "Escape" });
  expect(screen.queryByRole("menu", { name: "할 일 메뉴" })).toBeNull();
  expect(selectionProbe.selectedTaskId).toBe("repeat");
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(selectionProbe.selectedTaskId).toBe(null);
  row(container, "first").focus();
  fireEvent.keyDown(row(container, "first"), { key: "Enter" });
  expect(selectionProbe.selectedTaskId).toBe("first");
  // Esc in a text field is the field's own.
  fireEvent.keyDown(screen.getByRole("textbox", { name: "새 할 일" }), { key: "Escape" });
  expect(selectionProbe.selectedTaskId).toBe("first");
});

test("task menu actions go to IPC", () => {
  const { container } = view();
  const open = () => fireEvent.contextMenu(row(container, "first"), { clientX: 300, clientY: 200 });
  const menu = () => screen.getByRole("menu", { name: "할 일 메뉴" });
  open();
  fireEvent.click(within(menu()).getByRole("menuitem", { name: "내일" }));
  expect(IpcSender.req.task.updateTaskDueDate).toHaveBeenLastCalledWith("first", at(1, 18).getTime(), expect.any(Function));
  open();
  fireEvent.click(within(menu()).getByRole("menuitem", { name: "일주일 미루기" }));
  expect(IpcSender.req.task.updateTaskDueDate).toHaveBeenLastCalledWith("first", at(7, 18).getTime(), expect.any(Function));
  open();
  fireEvent.click(within(menu()).getByRole("menuitem", { name: "기한 없애기" }));
  expect(IpcSender.req.task.updateTaskDueDate).toHaveBeenLastCalledWith("first", null, expect.any(Function));
  open();
  fireEvent.click(within(menu()).getByRole("menuitem", { name: "중요로 표시" }));
  expect(IpcSender.req.task.updateTaskImportant).toHaveBeenLastCalledWith("first", true, expect.any(Function));
  open();
  fireEvent.click(within(menu()).getByRole("menuitem", { name: "카테고리" }));
  const sub = screen.getByRole("menu", { name: "카테고리" });
  // Secret categories are offered only while unlocked.
  expect(within(sub).queryByRole("menuitemcheckbox", { name: /비공개/ })).toBeNull();
  fireEvent.click(within(sub).getByRole("menuitemcheckbox", { name: /개발/ }));
  expect(IpcSender.req.task.deleteTaskCategory).toHaveBeenLastCalledWith("first", "public", expect.any(Function));
  expect(screen.getByRole("menu", { name: "카테고리" })).toBeInTheDocument();
  fireEvent.click(within(sub).getByRole("menuitem", { name: "새 카테고리…" }));
  const name = screen.getByRole("textbox", { name: "새 카테고리 이름" });
  fireEvent.change(name, { target: { value: "시험" } });
  fireEvent.keyDown(name, { key: "Enter" });
  expect(IpcSender.req.category.createCategory).toHaveBeenCalledWith(expect.objectContaining({ title: "시험", secret: false, color: expect.any(String), cid: expect.any(String) }), expect.any(Function));
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  open();
  fireEvent.click(within(menu()).getByRole("menuitem", { name: "복제" }));
  expect(IpcSender.req.task.duplicateTask).toHaveBeenCalledWith("first", null, expect.any(Function));
});

test("every refused change says so through one helper; a busy vault adds the try-again hint", () => {
  const errors = jest.spyOn(Toast, "error").mockImplementation(() => {});
  view();
  const refuse = (method, reply) => IpcSender.req.task[method].mockImplementationOnce((...args) => args.find((a) => typeof a === "function")?.(reply));
  const busy = { success: false, data: { syncV2Ack: true, code: "VAULT_BUSY" } };
  const cases = [
    ["deleteTask", () => selectionProbe.actions.deleteTask("first"), "할 일을 삭제하지 못했어요."],
    ["updateTaskTitle", () => selectionProbe.actions.setTitle("first", "x"), "제목을 바꾸지 못했어요."],
    ["updateTaskMemo", () => selectionProbe.actions.setMemo("first", "x"), "메모를 저장하지 못했어요."],
    ["updateTaskDueDate", () => selectionProbe.actions.setDue("first", null), "기한을 바꾸지 못했어요."],
    ["addTaskCategory", () => selectionProbe.actions.addCategory("first", "secret"), "카테고리를 넣지 못했어요."],
    ["deleteTaskCategory", () => selectionProbe.actions.removeCategory("first", "public"), "카테고리를 빼지 못했어요."],
    ["updateTaskRepeatPeriod", () => selectionProbe.actions.setRepeat("first", "day"), "반복을 정하지 못했어요."],
    ["updateTaskImportant", () => selectionProbe.actions.setImportant("first", true), "중요 표시를 바꾸지 못했어요."],
    ["duplicateTask", () => selectionProbe.actions.duplicate("first"), "복제하지 못했어요."],
    ["deleteSubtask", () => selectionProbe.actions.deleteSubtask("first", "s"), "하위 할 일을 삭제하지 못했어요."],
    ["updateSubtaskTitle", () => selectionProbe.actions.setSubtaskTitle("first", "s", "x"), "하위 할 일 이름을 바꾸지 못했어요."],
    ["updateSubtaskDueDate", () => selectionProbe.actions.setSubtaskDue("first", "s", null), "하위 할 일 기한을 바꾸지 못했어요."],
    ["updateSubtaskDone", () => selectionProbe.actions.setSubtaskDone("first", "s", true), "하위 할 일을 완료하지 못했어요."],
  ];
  for (const [method, run, message] of cases) {
    refuse(method, { success: false });
    act(run);
    expect(errors).toHaveBeenLastCalledWith(message);
    refuse(method, busy);
    act(run);
    expect(errors).toHaveBeenLastCalledWith(`${message} 잠시 뒤에 다시 해 주세요.`);
  }
  // Success is silent.
  errors.mockClear();
  act(() => selectionProbe.actions.setTitle("first", "y"));
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

test("the menu's new category is ticked only once it is stored", async () => {
  const errors = jest.spyOn(Toast, "error").mockImplementation(() => {});
  let answer;
  IpcSender.req.category.createCategory.mockImplementation((category, cb) => { answer = cb; });
  const { container } = view();
  fireEvent.contextMenu(row(container, "first"), { clientX: 300, clientY: 200 });
  fireEvent.click(within(screen.getByRole("menu", { name: "할 일 메뉴" })).getByRole("menuitem", { name: "카테고리" }));
  fireEvent.click(within(screen.getByRole("menu", { name: "카테고리" })).getByRole("menuitem", { name: "새 카테고리…" }));
  const name = screen.getByRole("textbox", { name: "새 카테고리 이름" });
  fireEvent.change(name, { target: { value: "시험" } });
  fireEvent.keyDown(name, { key: "Enter" });
  expect(IpcSender.req.task.addTaskCategory).not.toHaveBeenCalled();
  await act(async () => { answer({ success: false, data: { code: "VAULT_BUSY" } }); });
  expect(IpcSender.req.task.addTaskCategory).not.toHaveBeenCalled();
  expect(errors).toHaveBeenCalledWith("카테고리를 만들지 못했어요. 잠시 뒤에 다시 해 주세요.");
  fireEvent.keyDown(screen.getByRole("textbox", { name: "새 카테고리 이름" }), { key: "Enter" });
  const sent = IpcSender.req.category.createCategory.mock.calls.at(-1)[0];
  await act(async () => { answer({ success: true, data: { syncV2Ack: true } }); });
  expect(IpcSender.req.task.addTaskCategory).toHaveBeenCalledWith("first", sent.cid, expect.any(Function));
  errors.mockRestore();
});

test("a new task that the screen hides (secret category, locked) says where it went", async () => {
  const info = jest.spyOn(Toast, "info").mockImplementation(() => {});
  view();
  const secretTask = () => { const t = makeTask("new-secret", "숨은 일", null); t.addCategory(secretCategory); return t; };
  act(() => selectionProbe.actions.addTask(secretTask()));
  expect(info).toHaveBeenCalledWith("비밀 카테고리 할 일은 잠금을 풀면 보여요.");
  // A plain task, or a refused add, gives no such line.
  info.mockClear();
  act(() => selectionProbe.actions.addTask(makeTask("plain", "보이는 일", null)));
  IpcSender.req.task.addTask.mockImplementationOnce((entity, cb) => cb({ success: false }));
  act(() => selectionProbe.actions.addTask(secretTask()));
  expect(info).not.toHaveBeenCalled();
  // Unlocked it shows, so nothing to say.
  await unlockSecrets();
  act(() => selectionProbe.actions.addTask(secretTask()));
  expect(info).not.toHaveBeenCalled();
  info.mockRestore();
});

test("delete asks first, from the menu and with Del on the selected row", async () => {
  const { container } = view();
  fireEvent.contextMenu(row(container, "first"), { clientX: 300, clientY: 200 });
  fireEvent.click(within(screen.getByRole("menu", { name: "할 일 메뉴" })).getByRole("menuitem", { name: /삭제/ }));
  const dialog = screen.getByRole("alertdialog", { name: "할 일을 삭제할까요?" });
  expect(dialog).toHaveTextContent("'리뷰 준비'를 지워요. 되돌릴 수 없어요.");
  expect(IpcSender.req.task.deleteTask).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
  expect(IpcSender.req.task.deleteTask).not.toHaveBeenCalled();
  expect(row(container, "first")).toHaveFocus();

  fireEvent.click(row(container, "repeat"));
  fireEvent.keyDown(row(container, "repeat"), { key: "Delete" });
  const again = screen.getByRole("alertdialog", { name: "할 일을 삭제할까요?" });
  expect(again).toHaveTextContent("'운동'을 지워요.");
  fireEvent.click(within(again).getByRole("button", { name: "삭제" }));
  expect(IpcSender.req.task.deleteTask).toHaveBeenCalledWith("repeat", expect.any(Function));
  expect(selectionProbe.selectedTaskId).toBe(null);
  // Del in a text field is left alone.
  fireEvent.click(row(container, "first"));
  fireEvent.keyDown(screen.getByRole("textbox", { name: "새 할 일" }), { key: "Delete" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("quick add: context defaults per menu and the one addTask call", () => {
  const { rerender } = view();
  const add = (title) => {
    const input = screen.getByRole("textbox", { name: "새 할 일" });
    fireEvent.change(input, { target: { value: title } });
    fireEvent.keyDown(input, { key: "Enter" });
    return IpcSender.req.task.addTask.mock.calls.at(-1);
  };
  expect(add("새 작업")).toEqual([expect.objectContaining({ title: "새 작업", due_date: null, important: false, categories: {} }), expect.any(Function)]);
  mockContext = { ...mockContext, selectedTodoMenuType: "중요한 할일", category: { title: "중요한 할일", default: true } };
  rerender(ui());
  expect(add("별 작업")[0]).toMatchObject({ title: "별 작업", important: true });
  mockContext = { ...mockContext, selectedTodoMenuType: "오늘의 할일", category: { title: "오늘의 할일", default: true } };
  rerender(ui());
  expect(add("오늘 작업")[0]).toMatchObject({ due_date: at(0, 23, 59).getTime() + 59000 });
  mockContext = { ...mockContext, selectedTodoMenuType: "public", category: publicCategory };
  rerender(ui());
  expect(screen.getByRole("button", { name: "카테고리 개발" })).toBeInTheDocument();
  expect(add("개발 작업")[0]).toMatchObject({ categories: { public: true }, due_date: null });
  mockContext = { ...mockContext, selectedTodoMenuType: "다음 7일의 할일", category: { title: "다음 7일의 할일", default: true } };
  rerender(ui());
  expect(add("이번 주 작업")[0]).toMatchObject({ due_date: at(0, 23, 59).getTime() + 59000 });
});

test("quick add without the E2EE star (plaintext sync, legacy): no 중요 chip and no star default", () => {
  mockContext = { ...mockContext, syncStatus: { protocolVersion: 2 }, selectedTodoMenuType: "중요한 할일", category: { title: "중요한 할일", default: true } };
  view();
  expect(screen.queryByRole("button", { name: "중요" })).toBeNull();
  const input = screen.getByRole("textbox", { name: "새 할 일" });
  fireEvent.change(input, { target: { value: "별 없음" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(IpcSender.req.task.addTask.mock.calls.at(-1)[0]).toMatchObject({ important: false });
});

test("quick add: the × on the 오늘 date chip adds without a date", () => {
  mockContext = { ...mockContext, selectedTodoMenuType: "오늘의 할일", category: { title: "오늘의 할일", default: true } };
  view();
  fireEvent.click(screen.getByRole("button", { name: "날짜 빼기" }));
  const input = screen.getByRole("textbox", { name: "새 할 일" });
  fireEvent.change(input, { target: { value: "언젠가" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(IpcSender.req.task.addTask.mock.calls.at(-1)[0]).toMatchObject({ due_date: null });
});

test("Ctrl+N with the Korean layout focuses the quick add", () => {
  view();
  fireEvent.keyDown(window, { key: "ㅜ", code: "KeyN", ctrlKey: true });
  expect(screen.getByRole("textbox", { name: "새 할 일" })).toHaveFocus();
});

test("a click elsewhere in the home screen clears the selection; rows, the panel and the quick add keep it", () => {
  const { container } = render(<div className="home-layout">{ui()}<nav className="side-probe">사이드바</nav></div>);
  fireEvent.click(row(container, "first"));
  expect(selectionProbe.selectedTaskId).toBe("first");
  fireEvent.click(container.querySelector(".tc-quick input"));
  expect(selectionProbe.selectedTaskId).toBe("first");
  fireEvent.click(container.querySelector(".rp") || row(container, "first"));
  expect(selectionProbe.selectedTaskId).toBe("first");
  fireEvent.click(container.querySelector(".side-probe"));
  expect(selectionProbe.selectedTaskId).toBe(null);
  fireEvent.click(row(container, "first"));
  fireEvent.click(container.querySelector(".todo-content"));
  expect(selectionProbe.selectedTaskId).toBe(null);
});
