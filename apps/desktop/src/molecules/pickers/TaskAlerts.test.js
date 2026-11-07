import { fireEvent, render, screen } from "@testing-library/react";
import { taskAlerts } from "utils/taskPeriod";
import { AlertBell, bellLabel } from "./TaskAlerts";

// #109 review: the bell says its state to screen readers.
const DUE = new Date(2026, 10, 10, 17).getTime();
const S = { enabled: true, before: true, minutes: 10, due: true, startBefore: true, startMinutes: 10, startAt: false };
const end = (extra = {}, settings = S) => taskAlerts({ dueDate: DUE, ...extra }, settings)[0];

test("bell labels: follow, set on the task, off by the settings", () => {
  expect(bellLabel(end())).toBe("끝 알림, 전체 설정 따름 (10분 전, 정각)");
  expect(bellLabel(end({}, { ...S, before: false, due: false }))).toBe("끝 알림, 전체 설정 따름 (꺼짐)");
  expect(bellLabel(end({ alertEnd: "off" }))).toBe("끝 알림, 직접 끔");
  expect(bellLabel(end({ alertEnd: "on" }, { ...S, before: false, due: false }))).toBe("끝 알림, 직접 켬 (10분 전)");
});

test("the bell button carries the label; a date-only side is not a button", () => {
  const onOpen = jest.fn();
  const { rerender } = render(<AlertBell alert={end({ alertEnd: "off" })} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: "끝 알림, 직접 끔" }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  rerender(<AlertBell alert={taskAlerts({ dueDate: new Date(2026, 10, 10, 23, 59, 59).getTime() }, S)[0]} onOpen={onOpen} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByRole("img", { name: "끝 알림 없음" })).toHaveAttribute("data-tip", "끝에 시각을 정하면 알림을 받을 수 있어요");
});
