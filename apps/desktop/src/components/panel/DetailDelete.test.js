import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { Provider } from "react-redux";
import TodoContent from "../TodoContent";
import Task from "../../objects/Task";
import Category from "../../objects/Category";
import IpcSender from "../../utils/IpcSender";
import prefsReducer from "../../store/prefsSlice";
import { SecretSessionProvider } from "../../hooks/useSecretSession";
import { useTaskSelection } from "../list/taskSelection";
import { HomeLayoutContext, layoutForWidth } from "../../layouts/homeLayoutContext";

// 할 일 삭제 in the right panel head (#111 mock .rp-ic.del).
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

const NOW = new Date(2026, 10, 16, 13, 20);
let store, probe;

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
  // resetMocks (react-scripts) drops the answers of the methods made in an earlier test.
  const answer = (...args) => args.find((value) => typeof value === "function")?.({ success: true, data: [] });
  for (const m of ["deleteTask", "restoreTask", "updateTaskTitle", "updateTaskMemo"]) IpcSender.req.task[m].mockImplementation(answer);
  const cat = new Category("개인");
  cat.id = "home";
  cat.color = "#44c98b";
  const first = makeTask("first", "세탁물 찾기", new Date(2026, 10, 16, 18, 0), { memo: "영수증 챙기기" });
  first.addCategory(cat);
  const second = makeTask("second", "장보기", new Date(2026, 10, 17, 20, 0));
  first.next = second;
  second.prev = first;
  store = configureStore({ reducer: { prefs: prefsReducer } });
  mockContext = {
    selectedTodoMenuType: "모든 할일",
    category: { title: "모든 할일", default: true },
    addPromise: jest.fn(),
    searchQuery: "",
    syncStatus: { protocolVersion: 3 },
    states: { taskMap: { first, second }, categories: { home: cat } },
  };
});
afterEach(() => {
  act(() => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

function Probe() {
  probe = useTaskSelection();
  return null;
}
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
const view = (width = 1440) => render(
  <Provider store={store}>
    <SecretSessionProvider uid="fixture">
      <Shell width={width} />
    </SecretSessionProvider>
  </Provider>
);
const panel = () => document.querySelector(".rp");
const inPanel = () => within(panel());
const select = (id) => fireEvent.click(document.querySelector(`.todo-content [data-task-id="${id}"]`));
const trash = () => inPanel().queryByRole("button", { name: "할 일 삭제" });

test("the bin sits left of × on 할 일 상세 only and deletes with the undo notice", () => {
  view();
  expect(trash()).toBeNull();
  select("first");
  const head = panel().querySelector(".rp-tabs");
  const bin = trash();
  expect(bin).toHaveAttribute("data-tip", "할 일 삭제");
  expect(bin.nextElementSibling).toBe(within(head).getByRole("button", { name: "상세 닫기" }));
  // 캘린더 for the same task: no bin.
  fireEvent.click(inPanel().getByRole("tab", { name: "캘린더" }));
  expect(trash()).toBeNull();
  fireEvent.click(inPanel().getByRole("tab", { name: "할 일 상세" }));

  fireEvent.click(trash());
  expect(IpcSender.req.task.deleteTask).toHaveBeenCalledWith("first", expect.any(Function));
  expect(probe.selectedTaskId).toBeNull();
  expect(inPanel().getByRole("tab", { name: "캘린더" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("status")).toHaveTextContent("지웠어요");
  // 되돌리기 restores it as it was.
  fireEvent.click(screen.getByRole("button", { name: /되돌리기/ }));
  const snapshot = IpcSender.req.task.restoreTask.mock.calls[0][0];
  expect(snapshot).toMatchObject({ title: "세탁물 찾기", memo: "영수증 챙기기", categories: ["home"], nextId: "second" });
});

test("a title and memo being typed are saved before the delete and kept in the undo", () => {
  view();
  select("first");
  const memo = inPanel().getByRole("textbox", { name: "메모" });
  memo.focus();
  fireEvent.change(memo, { target: { value: "영수증 챙기기, 쿠폰도" } });
  const title = inPanel().getByRole("textbox", { name: "할 일 제목" });
  title.focus(); // leaving the memo saves it
  fireEvent.change(title, { target: { value: "세탁물 찾기 (오후)" } });
  fireEvent.click(trash());

  const order = (fn) => fn.mock.invocationCallOrder[0];
  const { updateTaskTitle, updateTaskMemo, deleteTask } = IpcSender.req.task;
  expect(updateTaskMemo).toHaveBeenCalledWith("first", "영수증 챙기기, 쿠폰도", expect.any(Function));
  expect(updateTaskTitle).toHaveBeenCalledWith("first", "세탁물 찾기 (오후)", expect.any(Function));
  expect(order(updateTaskTitle)).toBeLessThan(order(deleteTask));
  expect(order(updateTaskMemo)).toBeLessThan(order(deleteTask));
  // Nothing is sent to the deleted task afterwards (the panel's own save on leaving).
  act(() => { jest.advanceTimersByTime(3000); });
  act(() => { window.dispatchEvent(new Event("pagehide")); });
  expect(updateTaskTitle).toHaveBeenCalledTimes(1);
  expect(updateTaskMemo).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("세탁물 찾기 (오후)");
  fireEvent.click(screen.getByRole("button", { name: /되돌리기/ }));
  expect(IpcSender.req.task.restoreTask.mock.calls[0][0]).toMatchObject({ title: "세탁물 찾기 (오후)", memo: "영수증 챙기기, 쿠폰도" });
});

test("an emptied title is not kept: the task goes with its stored title", () => {
  view();
  select("first");
  const title = inPanel().getByRole("textbox", { name: "할 일 제목" });
  title.focus();
  fireEvent.change(title, { target: { value: "   " } });
  fireEvent.click(trash());
  expect(IpcSender.req.task.updateTaskTitle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /되돌리기/ }));
  expect(IpcSender.req.task.restoreTask.mock.calls[0][0]).toMatchObject({ title: "세탁물 찾기" });
});

test("in the drawer the panel closes after the delete", () => {
  view(960);
  select("first");
  expect(panel().closest(".home-panel")).toHaveClass("drawer");
  fireEvent.click(trash());
  expect(IpcSender.req.task.deleteTask).toHaveBeenCalledWith("first", expect.any(Function));
  expect(panel()).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("지웠어요");
});
