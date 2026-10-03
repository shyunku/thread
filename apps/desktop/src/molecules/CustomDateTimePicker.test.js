import { fireEvent, render, screen } from "@testing-library/react";
import DateTimePicker from "./CustomDateTimePicker";

jest.mock("react-redux", () => ({ useSelector: () => ({ weekStart: 0 }) }));

const day = (n) => screen.getAllByText(String(n)).find((el) => el.className.includes("date-picker-day") && !el.className.includes("not-current"));
const confirm = () => fireEvent.click(screen.getAllByText("확인")[0]);

test("changing the day keeps the time already chosen", () => {
  const onSelect = jest.fn();
  render(<DateTimePicker date={new Date(2026, 9, 4, 14, 30)} onSelect={onSelect} closer={() => {}} />);
  fireEvent.click(day(9));
  confirm();
  expect(onSelect).toHaveBeenCalledWith(new Date(2026, 9, 9, 14, 30, 0));
});

test("a first pick with no time starts at the end of the day", () => {
  const onSelect = jest.fn();
  render(<DateTimePicker date={null} onSelect={onSelect} closer={() => {}} />);
  fireEvent.click(screen.getByText("오늘"));
  confirm();
  const picked = onSelect.mock.calls[0][0];
  expect([picked.getHours(), picked.getMinutes(), picked.getSeconds()]).toEqual([23, 59, 59]);
});

test("closing without a pick does not save an empty date", () => {
  const onSelect = jest.fn(), closer = jest.fn();
  render(<DateTimePicker date={null} onSelect={onSelect} closer={closer} />);
  fireEvent.click(screen.getByText("취소"));
  expect(onSelect).not.toHaveBeenCalled();
  expect(closer).toHaveBeenCalled();
});

test("reopening after a cancelled edit shows the saved value again", () => {
  const onSelect = jest.fn(), saved = new Date(2026, 9, 4, 14, 30);
  const { rerender } = render(<DateTimePicker date={saved} openCount={1} onSelect={onSelect} closer={() => {}} />);
  fireEvent.click(day(20));
  expect(day(20).className).toContain("selected");
  rerender(<DateTimePicker date={saved} openCount={2} onSelect={onSelect} closer={() => {}} />);
  expect(day(20).className).not.toContain("selected");
  expect(day(4).className).toContain("selected");
});
