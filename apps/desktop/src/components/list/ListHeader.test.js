import { fireEvent, render, screen } from "@testing-library/react";
import ListHeader from "./ListHeader";

const prefs = { group: "date", noneTop: false, sort: "due", density: "normal", showRemain: true, hideDone: false };

function setup(extra = {}) {
  const onPref = jest.fn(), onView = jest.fn(), onToggle = jest.fn();
  const view = render(
    <ListHeader title="모든 할 일" summary="남은 할 일 3개" view="list" onView={onView} prefs={prefs} onPref={onPref} eye={{ on: false, onToggle }} {...extra} />
  );
  return { onPref, onView, onToggle, ...view };
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
  expect(screen.getByRole("menuitemradio", { name: "날짜별" }).querySelector(".tp-ok svg")).not.toBeNull();
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

test("the eye toggles the secret categories and is left out when not given", () => {
  const { onToggle, rerender } = setup();
  const eye = screen.getByRole("button", { name: "비밀 카테고리 보기" });
  expect(eye).toHaveAttribute("data-tip", "비밀 카테고리 보기");
  fireEvent.click(eye);
  expect(onToggle).toHaveBeenCalled();
  rerender(<ListHeader title="t" summary="" view="list" onView={() => {}} prefs={prefs} onPref={() => {}} eye={{ on: true, onToggle }} />);
  expect(screen.getByRole("button", { name: "비밀 카테고리 숨기기" })).toHaveAttribute("aria-pressed", "true");
  rerender(<ListHeader title="t" summary="" view="list" onView={() => {}} prefs={prefs} onPref={() => {}} eye={null} />);
  expect(screen.queryByRole("button", { name: /비밀 카테고리/ })).toBeNull();
});

test("heading replaces the plain title (the calendar's and timeline's title button)", () => {
  setup({ heading: <h1 className="tc-title"><button type="button">2026년 10월</button></h1> });
  expect(screen.getByRole("heading", { name: "2026년 10월" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "2026년 10월" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "모든 할 일" })).toBeNull();
});
