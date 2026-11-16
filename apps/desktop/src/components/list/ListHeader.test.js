import { fireEvent, render, screen } from "@testing-library/react";
import ListHeader from "./ListHeader";

const prefs = { group: "date", noneTop: false, sort: "due", density: "normal", showRemain: true, hideDone: false };

function setup(extra = {}) {
  const onPref = jest.fn(), onView = jest.fn();
  const view = render(
    <ListHeader title="모든 할 일" summary="남은 할 일 3개" view="list" onView={onView} prefs={prefs} onPref={onPref} {...extra} />
  );
  return { onPref, onView, ...view };
}

test("title, summary and the view switch (목록 / 캘린더 / 타임라인)", () => {
  const { onView } = setup();
  expect(screen.getByRole("heading", { name: "모든 할 일" })).toBeInTheDocument();
  expect(screen.getByText("남은 할 일 3개")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "목록" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "캘린더" }));
  expect(onView).toHaveBeenCalledWith("calendar");
  expect(screen.getByRole("button", { name: "타임라인" })).toHaveAttribute("data-tip", "타임라인");
});

test("the view menu sets every option through prefs and stays open", () => {
  const { onPref } = setup();
  fireEvent.click(screen.getByRole("button", { name: "보기 옵션" }));
  const menu = screen.getByRole("menu", { name: "보기 옵션" });
  expect(screen.getByRole("menuitemradio", { name: "날짜별" })).toHaveAttribute("aria-checked", "true");
  // #111: groups with bold heads, a radio mark before choices and a check box before check items.
  expect(menu.querySelectorAll(".vm-g")).toHaveLength(4);
  expect(screen.getByRole("group", { name: "묶기" }).querySelector(".tp-hd")).toHaveTextContent("묶기");
  expect(screen.getByRole("menuitemradio", { name: "날짜별" }).querySelector(".pk-rd")).not.toBeNull();
  expect(screen.getByRole("menuitemradio", { name: "날짜별" }).querySelector(".tp-ok")).toBeNull();
  expect(screen.getByRole("menuitemradio", { name: "맨 아래" }).className).toContain("on");
  const remain = screen.getByRole("menuitemcheckbox", { name: "남은 시간 보이기" });
  expect(remain.querySelector(".pk-cbx.on svg")).not.toBeNull();
  const hide = screen.getByRole("menuitemcheckbox", { name: "완료한 할 일 숨기기" });
  expect(hide.querySelector(".pk-cbx")).not.toBeNull();
  expect(hide.querySelector(".pk-cbx.on")).toBeNull();
  expect(hide.querySelector(".pk-rd")).toBeNull();
  const pick = [["묶지 않기 (기한 순)", { group: "none" }], ["맨 위", { noneTop: true }], ["생성일 순", { sort: "created" }], ["촘촘 (한 줄)", { density: "compact" }]];
  for (const [name, patch] of pick) {
    fireEvent.click(screen.getByRole("menuitemradio", { name }));
    expect(onPref).toHaveBeenLastCalledWith(patch);
  }
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "남은 시간 보이기" }));
  expect(onPref).toHaveBeenLastCalledWith({ showRemain: false });
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "완료한 할 일 숨기기" }));
  expect(onPref).toHaveBeenLastCalledWith({ hideDone: true });
  expect(menu).toBeInTheDocument();
  fireEvent.keyDown(menu, { key: "Escape" });
  expect(screen.queryByRole("menu", { name: "보기 옵션" })).toBeNull();
  // The button toggles it.
  fireEvent.click(screen.getByRole("button", { name: "보기 옵션" }));
  fireEvent.mouseDown(screen.getByRole("button", { name: "보기 옵션" }));
  fireEvent.click(screen.getByRole("button", { name: "보기 옵션" }));
  expect(screen.queryByRole("menu", { name: "보기 옵션" })).toBeNull();
});

test("arrow keys move over the options only, skipping the heads and rules", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "보기 옵션" }));
  const menu = screen.getByRole("menu", { name: "보기 옵션" });
  const items = [...menu.querySelectorAll(".tp-mi")];
  expect(items).toHaveLength(10);
  items[0].focus();
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "묶지 않기 (기한 순)" }));
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "맨 아래" }));
  fireEvent.keyDown(menu, { key: "End" });
  expect(document.activeElement).toBe(screen.getByRole("menuitemcheckbox", { name: "완료한 할 일 숨기기" }));
  fireEvent.keyDown(menu, { key: "ArrowUp" });
  expect(document.activeElement).toBe(screen.getByRole("menuitemcheckbox", { name: "남은 시간 보이기" }));
});

test("heading replaces the plain title (the calendar's and timeline's title button)", () => {
  setup({ heading: <h1 className="tc-title"><button type="button">2026년 10월</button></h1> });
  expect(screen.getByRole("heading", { name: "2026년 10월" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "2026년 10월" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "모든 할 일" })).toBeNull();
});
