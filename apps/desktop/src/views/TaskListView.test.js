import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import prefsReducer from "store/prefsSlice";
import TaskListView from "./TaskListView";

jest.mock("components/TaskList", () => ({ taskList }) => <ul>{taskList.map((task) => <li key={task.id}>{task.title}</li>)}</ul>);

const task = (id, title, done) => ({ id, title, done, prev: null, next: null });
function setup(prefs) {
  const a = task("a", "할 일 A", false), b = task("b", "끝난 일 B", true);
  a.next = b; b.prev = a;
  const store = configureStore({ reducer: { prefs: prefsReducer }, preloadedState: prefs ? { prefs } : undefined });
  render(<Provider store={store}><TaskListView taskMap={{ a, b }} filteredTaskMap={{ a, b }} /></Provider>);
  return store;
}

test("to-do is open and done is folded by default; toggles are remembered in prefs", () => {
  const store = setup();
  expect(screen.getByText("할 일 A")).toBeInTheDocument();
  expect(screen.queryByText("끝난 일 B")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "완료됨 (1)" }));
  expect(screen.getByText("끝난 일 B")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "해야할 일 (1)" }));
  expect(screen.queryByText("할 일 A")).not.toBeInTheDocument();
  expect(store.getState().prefs).toMatchObject({ listTodoOpen: false, listDoneOpen: true });
});

test("a saved folded state is restored", () => {
  setup({ startView: "list", weekStart: 0, timeFormat: "12", listTodoOpen: false, listDoneOpen: true });
  expect(screen.queryByText("할 일 A")).not.toBeInTheDocument();
  expect(screen.getByText("끝난 일 B")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "해야할 일 (1)" })).toHaveAttribute("aria-expanded", "false");
});
