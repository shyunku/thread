import { fireEvent, render, screen, within } from "@testing-library/react";
import DatePicker, { composeDue, datePickerStart } from "./DatePicker";
import { monthCells } from "./MiniMonth";

let mockPrefs = { weekStart: 0, timeFormat: "12" };
jest.mock("react-redux", () => ({ useSelector: () => mockPrefs }));
beforeEach(() => { mockPrefs = { weekStart: 0, timeFormat: "12" }; });

const at = (m, d, h = 12, min = 0, s = 0) => new Date(2026, m - 1, d, h, min, s).getTime();
const WED = at(10, 21, 14, 30); // Wed 2026-10-21 14:30
const parts = (ms) => { const d = new Date(ms); return [d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]; };
const chips = () => within(screen.getByRole("dialog").querySelector(".dp-quick")).getAllByRole("button");
const open = (props = {}) => {
  const onChange = jest.fn(), onCancel = jest.fn();
  render(<DatePicker now={WED} anchor={{ x: 10, y: 10 }} onChange={onChange} onCancel={onCancel} {...props} />);
  return { onChange, onCancel };
};
const ok = () => fireEvent.click(screen.getByRole("button", { name: "정하기" }));
const summary = () => document.querySelector(".dp-sum").textContent;
const timeSwitch = () => screen.getByRole("switch");

describe("quick days", () => {
  const labels = (now, ws) => {
    const { unmount } = render(<DatePicker now={now} weekStart={ws} anchor={{ x: 0, y: 0 }} />);
    const out = chips().map((b) => `${b.textContent} ${b.getAttribute("data-tip")}`);
    unmount();
    return out;
  };

  test("Wednesday: this Saturday and next Monday, with date tooltips", () => {
    const expected = ["오늘 10월 21일 (수)", "내일 10월 22일 (목)", "이번 주 토요일 10월 24일 (토)", "다음 주 월요일 10월 26일 (월)"];
    expect(labels(WED, 0)).toEqual(expected);
    expect(labels(WED, 1)).toEqual(expected);
  });

  test("Friday and Saturday leave out a Saturday that is today or tomorrow", () => {
    expect(labels(at(10, 23), 0)).toEqual(["오늘 10월 23일 (금)", "내일 10월 24일 (토)", "다음 주 월요일 10월 26일 (월)"]);
    expect(labels(at(10, 24), 1)).toEqual(["오늘 10월 24일 (토)", "내일 10월 25일 (일)", "다음 주 월요일 10월 26일 (월)"]);
  });

  test("Sunday: Sunday start looks a week ahead, Monday start leaves out a next Monday that is tomorrow", () => {
    expect(labels(at(10, 25), 0)).toEqual(["오늘 10월 25일 (일)", "내일 10월 26일 (월)", "이번 주 토요일 10월 31일 (토)", "다음 주 월요일 11월 2일 (월)"]);
    expect(labels(at(10, 25), 1)).toEqual(["오늘 10월 25일 (일)", "내일 10월 26일 (월)"]);
  });

  test("a quick day picks that day and shows as chosen", () => {
    const { onChange } = open();
    fireEvent.click(screen.getByRole("button", { name: "이번 주 토요일" }));
    expect(screen.getByRole("button", { name: "이번 주 토요일" })).toHaveClass("on");
    ok();
    expect(parts(onChange.mock.calls[0][0])).toEqual([10, 24, 23, 59, 59]);
  });
});

describe("month grid", () => {
  test("starts on 주 시작 요일 and covers whole weeks", () => {
    const sun = monthCells(2026, 9, 0), mon = monthCells(2026, 9, 1);
    expect([sun[0].getMonth() + 1, sun[0].getDate(), sun.length]).toEqual([9, 27, 35]);
    expect([mon[0].getMonth() + 1, mon[0].getDate(), mon.length]).toEqual([9, 28, 35]);
    expect(monthCells(2026, 7, 0).length).toBe(42); // August 2026 starts on a Saturday
    expect(monthCells(2026, 1, 0).length).toBe(28); // February 2026 fits four weeks
  });

  test("weekday header and weekend colours follow the week start", () => {
    open({ weekStart: 1 });
    const heads = [...document.querySelectorAll(".tp-mm-w")];
    expect(heads.map((h) => h.textContent).join("")).toBe("월화수목금토일");
    expect(heads[5]).toHaveClass("sat");
    expect(heads[6]).toHaveClass("sun");
    const first = document.querySelector(".tp-mm-c");
    expect(first).toHaveAttribute("data-day", "2026-9-28");
    expect(first).toHaveClass("out");
  });

  test("today has the ring, the picked day the fill, both together the halo", () => {
    open({ value: at(10, 28, 23, 59, 59) });
    expect(document.querySelector('[data-day="2026-10-21"]')).toHaveClass("today");
    expect(document.querySelector('[data-day="2026-10-21"]')).not.toHaveClass("picked");
    expect(document.querySelector('[data-day="2026-10-28"]')).toHaveClass("picked");
    fireEvent.click(document.querySelector('[data-day="2026-10-21"]'));
    expect(document.querySelector('[data-day="2026-10-21"]')).toHaveClass("today", "picked");
  });

  test("‹ › change the month; picking an outside day moves to its month", () => {
    open();
    expect(screen.getByText("2026년 10월")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
    expect(screen.getByText("2026년 11월")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
    fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
    expect(screen.getByText("2026년 9월")).toBeInTheDocument();
    fireEvent.click(document.querySelector('[data-day="2026-10-1"]'));
    expect(screen.getByText("2026년 10월")).toBeInTheDocument();
  });

  test("arrow keys move the picked day", () => {
    const { onChange } = open();
    const grid = screen.getByRole("group", { name: "2026년 10월" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    ok();
    expect(parts(onChange.mock.calls[0][0]).slice(0, 2)).toEqual([10, 29]);
  });
});

describe("time", () => {
  test("off by default: the end of the day (23:59:59)", () => {
    const { onChange } = open();
    expect(timeSwitch()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/시간 없이 그날 끝\(오후 11:59\)까지예요/)).toBeInTheDocument();
    expect(summary()).toBe("10월 21일 (수) · 하루 끝까지");
    ok();
    expect(parts(onChange.mock.calls[0][0])).toEqual([10, 21, 23, 59, 59]);
  });

  test("turning it on starts at 23:59", () => {
    open();
    fireEvent.click(timeSwitch());
    expect(screen.getByRole("button", { name: "오후" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "시" })).toHaveValue("11");
    expect(screen.getByRole("textbox", { name: "분" })).toHaveValue("59");
    expect(summary()).toBe("10월 21일 (수) 오후 11:59");
  });

  test("a due with a set time opens with the switch on; 23:59 opens it off", () => {
    const { unmount } = render(<DatePicker now={WED} value={at(10, 25, 14, 32)} anchor={{ x: 0, y: 0 }} />);
    expect(timeSwitch()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("textbox", { name: "시" })).toHaveValue("2");
    expect(screen.getByRole("textbox", { name: "분" })).toHaveValue("32");
    expect(summary()).toBe("10월 25일 (일) 오후 2:32");
    unmount();
    render(<DatePicker now={WED} value={at(10, 25, 23, 59, 59)} anchor={{ x: 0, y: 0 }} />);
    expect(timeSwitch()).toHaveAttribute("aria-checked", "false");
    expect(datePickerStart(at(10, 25, 23, 59, 0), null, WED)).toMatchObject({ on: false, minutes: 1439 });
  });

  test("12h: typing the hour and minute, 오전/오후, invalid digits start over", () => {
    const { onChange } = open();
    fireEvent.click(timeSwitch());
    const hour = screen.getByRole("textbox", { name: "시" }), minute = screen.getByRole("textbox", { name: "분" });
    fireEvent.change(hour, { target: { value: "9" } });
    expect(summary()).toBe("10월 21일 (수) 오후 9:59");
    expect(document.activeElement).toBe(minute); // 9 cannot start a two-digit hour
    fireEvent.change(minute, { target: { value: "0" } });
    fireEvent.change(minute, { target: { value: "05" } });
    fireEvent.click(screen.getByRole("button", { name: "오전" }));
    expect(summary()).toBe("10월 21일 (수) 오전 9:05");
    fireEvent.change(hour, { target: { value: "1" } });
    fireEvent.change(hour, { target: { value: "13" } }); // not an hour: the 3 starts again
    expect(hour).toHaveValue("3");
    fireEvent.change(hour, { target: { value: "12" } });
    expect(summary()).toBe("10월 21일 (수) 오전 12:05");
    ok();
    expect(parts(onChange.mock.calls[0][0])).toEqual([10, 21, 0, 5, 0]);
  });

  test("24h: no 오전/오후, hours 0–23, two-digit fields", () => {
    const { onChange } = open({ timeFormat: "24" });
    fireEvent.click(timeSwitch());
    expect(screen.queryByRole("button", { name: "오전" })).toBeNull();
    const hour = screen.getByRole("textbox", { name: "시" }), minute = screen.getByRole("textbox", { name: "분" });
    expect(hour).toHaveValue("23");
    fireEvent.change(hour, { target: { value: "0" } });
    fireEvent.change(hour, { target: { value: "08" } });
    fireEvent.change(minute, { target: { value: "30" } });
    fireEvent.blur(hour);
    expect(hour).toHaveValue("08");
    expect(summary()).toBe("10월 21일 (수) 08:30");
    ok();
    expect(parts(onChange.mock.calls[0][0])).toEqual([10, 21, 8, 30, 0]);
  });

  test("arrow keys step with wrap-around", () => {
    open({ timeFormat: "24" });
    fireEvent.click(timeSwitch());
    const minute = screen.getByRole("textbox", { name: "분" }), hour = screen.getByRole("textbox", { name: "시" });
    fireEvent.keyDown(minute, { key: "ArrowUp" });
    expect(minute).toHaveValue("00");
    fireEvent.keyDown(hour, { key: "ArrowUp" });
    expect(hour).toHaveValue("00");
    fireEvent.keyDown(hour, { key: "ArrowDown" });
    expect(hour).toHaveValue("23");
  });

  test("presets, 12h and 24h labels", () => {
    const { onChange } = open();
    fireEvent.click(timeSwitch());
    const names = within(document.querySelector(".dp-time")).getAllByRole("button").filter((b) => b.classList.contains("dp-chip")).map((b) => b.textContent);
    expect(names).toEqual(["오전 9:00", "오후 12:00", "오후 6:00", "오후 9:00", "하루 끝"]);
    fireEvent.click(screen.getByRole("button", { name: "오전 9:00" }));
    expect(screen.getByRole("button", { name: "오전 9:00" })).toHaveClass("on");
    ok();
    expect(parts(onChange.mock.calls[0][0])).toEqual([10, 21, 9, 0, 0]);
  });

  test("24h preset labels", () => {
    open({ timeFormat: "24" });
    fireEvent.click(timeSwitch());
    expect(screen.getByRole("button", { name: "09:00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "18:00" })).toBeInTheDocument();
    expect(screen.getByText(/23:59/, { selector: ".dp-sum" })).toBeInTheDocument();
  });

  test("하루 끝 is the end of the day", () => {
    expect(parts(composeDue(new Date(2026, 9, 21), true, 1439))).toEqual([10, 21, 23, 59, 59]);
  });
});

describe("closing", () => {
  test("취소, × and Esc cancel without a change; only 정하기 applies", () => {
    const { onChange, onCancel } = open();
    fireEvent.click(document.querySelector('[data-day="2026-10-30"]'));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("a press outside cancels", () => {
    const { onCancel } = open();
    fireEvent.mouseDown(document.body);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("no value starts on initialDay, else today", () => {
    const { onChange } = open({ initialDay: at(11, 3) });
    expect(summary()).toBe("11월 3일 (화) · 하루 끝까지");
    expect(screen.getByText("2026년 11월")).toBeInTheDocument();
    ok();
    expect(parts(onChange.mock.calls[0][0])).toEqual([11, 3, 23, 59, 59]);
  });

  test("12/24h and week start come from the prefs when not given", () => {
    mockPrefs = { weekStart: 1, timeFormat: "24" };
    open();
    expect(document.querySelector(".tp-mm-w").textContent).toBe("월");
    expect(screen.getByText(/시간 없이 그날 끝\(23:59\)까지예요/)).toBeInTheDocument();
  });
});

describe("unchanged values", () => {
  test("정하기 without a change gives back the original value (an old 23:59:59.999 stays equal)", () => {
    const old = new Date(2026, 9, 28, 23, 59, 59, 999).getTime();
    const { onChange } = open({ value: old });
    ok();
    expect(onChange).toHaveBeenCalledWith(old);
  });

  test("a Date value and a set time come back as the same ms; a change composes a new one", () => {
    const due = new Date(2026, 9, 28, 17, 30, 0, 0);
    const { onChange } = open({ value: due });
    ok();
    expect(onChange).toHaveBeenLastCalledWith(due.getTime());
    fireEvent.click(screen.getByRole("button", { name: "내일" }));
    ok();
    expect(parts(onChange.mock.calls[1][0])).toEqual([10, 22, 17, 30, 0]);
  });

  test("0 means no due: it starts on today with the time off", () => {
    open({ value: 0 });
    expect(summary()).toBe("10월 21일 (수) · 하루 끝까지");
  });
});
