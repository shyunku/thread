import { fireEvent, render, screen } from "@testing-library/react";
import TodoContent from "./TodoContent";
import Task from "../objects/Task";
import Category from "../objects/Category";
import IpcSender from "../utils/IpcSender";

let mockContext;
jest.mock("react-router-dom", () => ({ useOutletContext: () => mockContext }));
jest.mock("react-redux", () => ({
  useSelector: () => ({ uid: "fixture", offlineMode: false }),
}));
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
                      const callback = args.find(
                        (value) => typeof value === "function"
                      );
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
    onAll: jest.fn(),
    offAll: jest.fn(),
    off: jest.fn(),
  };
});

beforeEach(() => {
  window.innerWidth = 1024;
  jest.clearAllMocks();
  const publicCategory = new Category("개발");
  publicCategory.id = "public";
  const secretCategory = new Category("비공개", true);
  secretCategory.id = "secret";
  const first = new Task("리뷰 준비", null);
  first.id = "first";
  first.memo = "문서 초안";
  first.addCategory(publicCategory);
  const second = new Task("배포 완료", null);
  second.id = "second";
  second.done = true;
  const secret = new Task("비공개 작업", null);
  secret.id = "secret-task";
  secret.addCategory(secretCategory);
  first.next = second;
  second.prev = first;
  second.next = secret;
  secret.prev = second;
  mockContext = {
    selectedTodoMenuType: "모든 할일",
    category: { title: "모든 할일", default: true },
    addPromise: jest.fn(),
    hideLeftSidebar: false,
    setHideLeftSidebar: jest.fn(),
    searchQuery: "",
    states: {
      taskMap: { first, second, secret },
      categories: { public: publicCategory, secret: secretCategory },
    },
  };
});

test("list and calendar use the 1100px breakpoint while preserving the selected view", () => {
  const { container } = render(<TodoContent />);
  const resize = (width) => {
    window.innerWidth = width;
    fireEvent(window, new Event("resize"));
  };
  const list = () => container.querySelector(".task-view.list");
  const calendar = () => container.querySelector(".task-view.calendar");
  expect(screen.queryByRole("button", { name: "리스트 | 캘린더" })).toBeNull();
  expect(screen.getByRole("button", { name: "리스트", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(list()).not.toBeNull();
  expect(calendar()).toBeNull();
  resize(1101);
  expect(list()).not.toBeNull();
  expect(calendar()).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "캘린더", exact: true }));
  resize(1100);
  expect(list()).toBeNull();
  expect(calendar()).not.toBeNull();
  resize(1600);
  expect(list()).not.toBeNull();
  expect(calendar()).not.toBeNull();
  resize(900);
  expect(list()).toBeNull();
  expect(calendar()).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "타임라인", exact: true }));
  resize(1600);
  expect(container.querySelector(".task-timeline-view")).not.toBeNull();
  expect(list()).toBeNull();
  expect(calendar()).toBeNull();
});

test("search and completion filters preserve secret-category visibility", () => {
  const { container, rerender } = render(<TodoContent />);
  const rows = () => container.querySelectorAll(".todo-item-wrapper");
  expect(rows()).toHaveLength(2);
  mockContext = { ...mockContext, searchQuery: "문서 초안" };
  rerender(<TodoContent />);
  expect(rows()).toHaveLength(1);
  mockContext = { ...mockContext, searchQuery: "비공개" };
  rerender(<TodoContent />);
  expect(rows()).toHaveLength(0);
  mockContext = { ...mockContext, searchQuery: "" };
  rerender(<TodoContent />);
  fireEvent.click(screen.getByRole("button", { name: "완료됨 1" }));
  expect(rows()).toHaveLength(1);
  expect(rows()[0]).toHaveTextContent("배포 완료");
});

test("quick add and completion keep the existing IPC mutation contract", () => {
  render(<TodoContent />);
  const input = screen.getByRole("textbox", { name: "새 할 일" });
  fireEvent.change(input, { target: { value: "새 작업" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(IpcSender.req.task.addTask).toHaveBeenCalledWith(
    expect.objectContaining({ title: "새 작업" }),
    null
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "할 일 완료", exact: true })
  );
  expect(IpcSender.req.task.updateTaskDone).toHaveBeenCalledWith(
    "first",
    true,
    expect.any(Number),
    null
  );
});
