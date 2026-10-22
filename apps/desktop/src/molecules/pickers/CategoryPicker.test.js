import { act, fireEvent, render, screen } from "@testing-library/react";
import { CATEGORY_PALETTE, nextPaletteColor } from "utils/categoryColors";
import CategoryPicker from "./CategoryPicker";

const CATS = [
  { id: "work", title: "업무", color: "#6294ff" },
  { id: "study", title: "공부", color: "#4fc3d9" },
  { id: "diary", title: "일기", color: "#e57ad6", secret: true },
  { id: "exam", title: "자격증 및 어학 시험 준비 (2026 하반기)", color: null },
];
const setup = (props = {}) => {
  const onToggle = jest.fn(), onClose = jest.fn(), onCreate = jest.fn(async () => "new1");
  render(<CategoryPicker categories={CATS} selectedIds={["study"]} anchor={{ x: 0, y: 0 }} onToggle={onToggle} onClose={onClose} onCreate={onCreate} {...props} />);
  return { onToggle, onClose, onCreate };
};

test("rows with checkboxes, dots and the shield for secret ones", () => {
  setup();
  const rows = screen.getAllByRole("checkbox");
  expect(rows.map((r) => r.textContent)).toEqual(["업무", "공부", "일기", "자격증 및 어학 시험 준비 (2026 하반기)"]);
  expect(screen.getByRole("checkbox", { name: /공부/ })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("checkbox", { name: /업무/ })).toHaveAttribute("aria-checked", "false");
  expect(screen.getByRole("checkbox", { name: /일기/ }).querySelector('[aria-label="비밀 카테고리"]')).not.toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "카테고리 찾기" }));
});

test("search filters, with a line when nothing matches", () => {
  setup();
  fireEvent.change(screen.getByRole("textbox", { name: "카테고리 찾기" }), { target: { value: "시험" } });
  expect(screen.getAllByRole("checkbox").map((r) => r.textContent)).toEqual(["자격증 및 어학 시험 준비 (2026 하반기)"]);
  fireEvent.change(screen.getByRole("textbox", { name: "카테고리 찾기" }), { target: { value: "없는 이름" } });
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  expect(screen.getByText("찾는 카테고리가 없어요.")).toBeInTheDocument();
});

test("toggling keeps the picker open", () => {
  const { onToggle, onClose } = setup();
  fireEvent.click(screen.getByRole("checkbox", { name: /업무/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /공부/ }));
  expect(onToggle.mock.calls).toEqual([["work"], ["study"]]);
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "카테고리" })).toBeInTheDocument();
});

test("new category in place: next palette colour, Enter creates, then it is ticked", async () => {
  const { onCreate, onToggle, onClose } = setup();
  fireEvent.click(screen.getByRole("button", { name: "새 카테고리" }));
  const name = screen.getByRole("textbox", { name: "새 카테고리 이름" });
  expect(document.activeElement).toBe(name);
  expect(screen.getByRole("button", { name: "만들기" })).toBeDisabled();
  expect(screen.getByText(/색은 차례대로 정해져요/)).toBeInTheDocument();
  fireEvent.change(name, { target: { value: "  시험 공부 " } });
  expect(screen.getByRole("button", { name: "만들기" })).toBeEnabled();
  await act(async () => { fireEvent.keyDown(name, { key: "Enter" }); });
  expect(onCreate).toHaveBeenCalledWith("시험 공부", "#44c98b");
  expect(onToggle).toHaveBeenCalledWith("new1");
  expect(screen.queryByRole("textbox", { name: "새 카테고리 이름" })).toBeNull();
  expect(screen.getByRole("button", { name: "새 카테고리" })).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

test("Esc in the name field cancels only the new category", () => {
  const { onClose, onCreate } = setup();
  fireEvent.click(screen.getByRole("button", { name: "새 카테고리" }));
  const name = screen.getByRole("textbox", { name: "새 카테고리 이름" });
  fireEvent.change(name, { target: { value: "임시" } });
  fireEvent.keyDown(name, { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: "새 카테고리 이름" })).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  expect(onCreate).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "카테고리 찾기" }), { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("the search text becomes the name; an empty name does nothing", async () => {
  const { onCreate } = setup();
  fireEvent.change(screen.getByRole("textbox", { name: "카테고리 찾기" }), { target: { value: "운동" } });
  fireEvent.click(screen.getByRole("button", { name: "새 카테고리" }));
  const name = screen.getByRole("textbox", { name: "새 카테고리 이름" });
  expect(name).toHaveValue("운동");
  fireEvent.change(name, { target: { value: "   " } });
  await act(async () => { fireEvent.keyDown(name, { key: "Enter" }); });
  expect(onCreate).not.toHaveBeenCalled();
});

test("a failed create keeps the field", async () => {
  const onCreate = jest.fn(async () => { throw new Error("x"); });
  const { onToggle } = setup({ onCreate });
  fireEvent.click(screen.getByRole("button", { name: "새 카테고리" }));
  fireEvent.change(screen.getByRole("textbox", { name: "새 카테고리 이름" }), { target: { value: "운동" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "만들기" })); });
  expect(onToggle).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "새 카테고리 이름" })).toHaveValue("운동");
});

test("arrow keys go from the search field through the rows", () => {
  setup();
  const search = screen.getByRole("textbox", { name: "카테고리 찾기" });
  fireEvent.keyDown(search, { key: "ArrowDown" });
  expect(document.activeElement).toHaveTextContent("업무");
  fireEvent.keyDown(document.activeElement, { key: "ArrowDown" });
  expect(document.activeElement).toHaveTextContent("공부");
  fireEvent.keyDown(document.activeElement, { key: "ArrowUp" });
  fireEvent.keyDown(document.activeElement, { key: "ArrowUp" });
  expect(document.activeElement).toBe(search);
});

test("next colour: the first unused palette colour, the first one when all are used", () => {
  expect(nextPaletteColor([])).toBe("#6294ff");
  expect(nextPaletteColor({ a: { color: "#6294FF" }, b: { color: "#44c98b" } })).toBe("#4fc3d9");
  expect(nextPaletteColor(CATEGORY_PALETTE.map((color) => ({ color })))).toBe("#6294ff");
});

test("a category saved without a colour shows the fallback dot", () => {
  setup();
  expect(screen.getByRole("checkbox", { name: /자격증/ }).querySelector(".pk-dot").style.background).toBe("rgb(98, 148, 255)");
  expect(screen.getByRole("img", { name: "비밀 카테고리" })).toBeInTheDocument();
});

test("Enter while composing Korean does not create", async () => {
  const { onCreate } = setup();
  fireEvent.click(screen.getByRole("button", { name: "새 카테고리" }));
  const name = screen.getByRole("textbox", { name: "새 카테고리 이름" });
  fireEvent.change(name, { target: { value: "운동" } });
  await act(async () => { fireEvent.keyDown(name, { key: "Enter", keyCode: 229 }); });
  await act(async () => { fireEvent.keyDown(name, { key: "Enter", isComposing: true }); });
  expect(onCreate).not.toHaveBeenCalled();
  await act(async () => { fireEvent.keyDown(name, { key: "Enter" }); });
  expect(onCreate).toHaveBeenCalledWith("운동", "#44c98b");
});

test("after creating, focus is on 새 카테고리 again, not lost to the page", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "새 카테고리" }));
  fireEvent.change(screen.getByRole("textbox", { name: "새 카테고리 이름" }), { target: { value: "운동" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "만들기" })); });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "새 카테고리" }));
});
