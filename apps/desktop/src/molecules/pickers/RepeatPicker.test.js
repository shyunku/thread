import { fireEvent, render, screen } from "@testing-library/react";
import RepeatPicker from "./RepeatPicker";

jest.mock("react-redux", () => ({ useSelector: () => ({ weekStart: 0, timeFormat: "12" }) }));
const { nextDue } = require("../../../../../packages/e2ee/src/recurrence");

const at = (m, d, h = 23, min = 59, s = 59) => new Date(2026, m - 1, d, h, min, s).getTime();
const NOW = at(10, 21, 14, 30, 0);
const rows = () => screen.getAllByRole("radio").map((r) => r.textContent);

test("rows from the due date, each with its next date", () => {
  render(<RepeatPicker base={at(10, 21, 17, 30, 0)} value="week" now={NOW} anchor={{ x: 0, y: 0 }} />);
  expect(rows()).toEqual([
    "안 함한 번만",
    "매일다음: 10월 22일 (목)",
    "매주 수요일다음: 10월 28일 (수)",
    "매월 21일다음: 11월 21일 (토)",
    "매년 10월 21일다음: 2027년 10월 21일 (목)",
  ]);
  expect(screen.getByRole("radio", { name: /매주 수요일/ })).toHaveAttribute("aria-checked", "true");
  expect(document.activeElement).toBe(screen.getByRole("radio", { name: /매주 수요일/ }));
  expect(screen.queryByText(/기한이 없으면/)).toBeNull();
});

test("31 October monthly: next is 1 December, the same as recurrence.js", () => {
  render(<RepeatPicker base={at(10, 31)} now={NOW} anchor={{ x: 0, y: 0 }} />);
  expect(screen.getByRole("radio", { name: /매월 31일/ })).toHaveTextContent("다음: 12월 1일 (화)");
  const next = new Date(nextDue(at(10, 31), at(10, 31), "month", NOW));
  expect([next.getMonth() + 1, next.getDate()]).toEqual([12, 1]);
});

test("without a due date: today's end of day, with the note", () => {
  const { unmount } = render(<RepeatPicker base={null} now={NOW} anchor={{ x: 0, y: 0 }} />);
  expect(screen.getByRole("radio", { name: /안 함/ })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByText(/매주 수요일/)).toBeInTheDocument();
  expect(screen.getByText(/기한이 없으면 오늘 오후 11:59가/)).toBeInTheDocument();
  unmount();
  render(<RepeatPicker base={null} now={NOW} timeFormat="24" anchor={{ x: 0, y: 0 }} />);
  expect(screen.getByText(/기한이 없으면 오늘 23:59이/)).toBeInTheDocument();
});

test("choosing calls onSelect with the period, then closes", () => {
  const onSelect = jest.fn(), onClose = jest.fn();
  render(<RepeatPicker base={at(10, 21)} value="day" now={NOW} anchor={{ x: 0, y: 0 }} onSelect={onSelect} onClose={onClose} />);
  fireEvent.click(screen.getByRole("radio", { name: /매월/ }));
  expect(onSelect).toHaveBeenCalledWith("month");
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("radio", { name: /안 함/ }));
  expect(onSelect).toHaveBeenLastCalledWith(null);
});

test("arrow keys move between the rows; Esc closes", () => {
  const onClose = jest.fn();
  render(<RepeatPicker base={at(10, 21)} now={NOW} anchor={{ x: 0, y: 0 }} onClose={onClose} />);
  const group = screen.getByRole("radiogroup");
  fireEvent.keyDown(group, { key: "ArrowDown" });
  expect(document.activeElement).toHaveTextContent("매일");
  fireEvent.keyDown(group, { key: "End" });
  expect(document.activeElement).toHaveTextContent("매년");
  fireEvent.keyDown(group, { key: "ArrowDown" });
  expect(document.activeElement).toHaveTextContent("안 함");
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});
