import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

  test("오늘 · 내일 with date tooltips; the text field takes the other quick days' place", () => {
    const expected = ["오늘 10월 21일 (수)", "내일 10월 22일 (목)"];
    expect(labels(WED, 0)).toEqual(expected);
    expect(labels(WED, 1)).toEqual(expected);
    expect(labels(at(10, 25), 1)).toEqual(["오늘 10월 25일 (일)", "내일 10월 26일 (월)"]);
    expect(screen.queryByRole("button", { name: "이번 주 토요일" })).toBeNull();
  });

  test("a quick day picks that day and shows as chosen", () => {
    const { onChange } = open();
    fireEvent.click(screen.getByRole("button", { name: "내일" }));
    expect(screen.getByRole("button", { name: "내일" })).toHaveClass("on");
    ok();
    expect(parts(onChange.mock.calls[0][0])).toEqual([10, 22, 23, 59, 59]);
  });
});

describe("text field", () => {
  const field = () => screen.getByRole("textbox", { name: "날짜 직접 입력" });
  const type = (value) => fireEvent.change(field(), { target: { value } });
  const line = () => document.querySelector(".dp-line");
  afterEach(() => jest.useRealTimers());

  test("sits on the quick day row; empty, the line gives a hint", () => {
    open();
    expect(field().closest(".dp-quick")).toBe(screen.getByRole("dialog").querySelector(".dp-quick"));
    expect(field()).toHaveAttribute("placeholder", "직접 입력 · 예: 금요일 3시");
    expect(line()).toHaveTextContent("날짜나 시간을 적으면 바로 골라져요");
    expect(line()).not.toHaveClass("got");
  });

  test("typing picks the day and time at once; 정하기 applies it", () => {
    const { onChange } = open();
    type("내일 3시");
    expect(line()).toHaveClass("got");
    expect(line()).toHaveTextContent("10월 22일 (목) 오전 3:00");
    expect(line().querySelector("svg")).not.toBeNull();
    expect(document.querySelector('[data-day="2026-10-22"]')).toHaveClass("picked");
    expect(timeSwitch()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("textbox", { name: "시" })).toHaveValue("3");
    expect(screen.getByRole("button", { name: "오전" })).toHaveAttribute("aria-pressed", "true");
    expect(summary()).toBe("10월 22일 (목) 오전 3:00");
    ok();
    expect(parts(onChange.mock.calls[0][0])).toEqual([10, 22, 3, 0, 0]);
  });

  test("the calendar moves to the typed month; 24h shows 24h", () => {
    open({ timeFormat: "24" });
    type("26.12.24 15시");
    expect(screen.getByText("2026년 12월")).toBeInTheDocument();
    expect(document.querySelector('[data-day="2026-12-24"]')).toHaveClass("picked");
    expect(line()).toHaveTextContent("12월 24일 (목) 15:00");
  });

  test("a text without a time keeps the time setting the picker opened with", () => {
    const { onChange } = open({ value: at(10, 25, 9, 30) });
    type("금요일");
    expect(line()).toHaveTextContent("10월 23일 (금)");
    expect(summary()).toBe("10월 23일 (금) 오전 9:30");
    fireEvent.click(screen.getByRole("button", { name: "오후 6:00" }));
    type("모레");
    expect(summary()).toBe("10월 23일 (금) 오전 9:30");
    ok();
    expect(parts(onChange.mock.calls[0][0])).toEqual([10, 23, 9, 30, 0]);
  });

  test("without a time and with the time off, it stays off", () => {
    const { onChange } = open();
    type("다음 주 수요일");
    expect(timeSwitch()).toHaveAttribute("aria-checked", "false");
    expect(summary()).toBe("10월 28일 (수) · 하루 끝까지");
    ok();
    expect(parts(onChange.mock.calls[0][0])).toEqual([10, 28, 23, 59, 59]);
  });

  test("다음 주 follows the week start", () => {
    open({ now: at(10, 25, 10), weekStart: 1 });
    type("다음 주");
    expect(summary()).toBe("10월 26일 (월) · 하루 끝까지");
  });

  test("not understood: the last pick stays and the hint shows after a pause", () => {
    jest.useFakeTimers();
    open();
    type("내일 3시");
    type("내일 3시 회");
    expect(summary()).toBe("10월 22일 (목) 오전 3:00");
    expect(line()).not.toHaveClass("got");
    expect(line()).toHaveTextContent("10월 22일 (목) 오전 3:00");
    act(() => { jest.advanceTimersByTime(500); });
    type("내일 3시 회의");
    act(() => { jest.advanceTimersByTime(500); });
    expect(line()).not.toHaveTextContent("알아듣지 못했어요"); // each keystroke waits again
    act(() => { jest.advanceTimersByTime(300); });
    expect(line()).toHaveTextContent("알아듣지 못했어요 · 예: 내일 3시, 11/20, 3일 뒤");
    type("내일 4시");
    expect(line()).toHaveTextContent("10월 22일 (목) 오전 4:00");
  });

  test("Enter applies like 정하기; when not understood it shows the hint at once", () => {
    const { onChange } = open();
    type("언젠가");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(line()).toHaveTextContent("알아듣지 못했어요");
    type("11/20 오후 2시");
    fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(parts(onChange.mock.calls[0][0])).toEqual([11, 20, 14, 0, 0]);
  });

  test("Enter on an empty field applies the current pick", () => {
    const { onChange } = open();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(parts(onChange.mock.calls[0][0])).toEqual([10, 21, 23, 59, 59]);
  });

  test("a chip or a calendar day clears the text", () => {
    open();
    type("모레");
    fireEvent.click(screen.getByRole("button", { name: "오늘" }));
    expect(field()).toHaveValue("");
    expect(line()).toHaveTextContent("날짜나 시간을 적으면 바로 골라져요");
    type("모레");
    fireEvent.click(document.querySelector('[data-day="2026-10-30"]'));
    expect(field()).toHaveValue("");
    expect(summary()).toBe("10월 30일 (금) · 하루 끝까지");
  });

  test("clearing the text goes back to how the picker opened", () => {
    open({ value: at(10, 25, 9, 30) });
    type("내일 15시");
    expect(summary()).toBe("10월 22일 (목) 오후 3:00");
    type("");
    expect(summary()).toBe("10월 25일 (일) 오전 9:30");
    expect(line()).toHaveTextContent("날짜나 시간을 적으면 바로 골라져요");
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
