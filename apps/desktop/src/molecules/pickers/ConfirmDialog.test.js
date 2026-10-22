import { fireEvent, render, screen } from "@testing-library/react";
import ConfirmDialog from "./ConfirmDialog";
import Popover from "./Popover";
import { categoryDeleteConfirm, objectParticle, taskDeleteConfirm } from "./deleteConfirm";

const del = [{ id: "delete", label: "삭제", danger: true }];

test("title, body, 취소 + one choice; the choice has focus", () => {
  const onChoose = jest.fn(), onCancel = jest.fn();
  render(<ConfirmDialog title="삭제할까요?" body="주간 보고서 제출" choices={del} onChoose={onChoose} onCancel={onCancel} />);
  const dialog = screen.getByRole("alertdialog", { name: "삭제할까요?" });
  expect(dialog).toHaveAccessibleDescription("주간 보고서 제출");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
  expect(onChoose).toHaveBeenCalledWith("delete", undefined);
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("Enter picks the default choice, Esc and the backdrop cancel", () => {
  const onChoose = jest.fn(), onCancel = jest.fn();
  render(<ConfirmDialog title="삭제할까요?" choices={del} onChoose={onChoose} onCancel={onCancel} />);
  const dialog = screen.getByRole("alertdialog");
  fireEvent.keyDown(dialog, { key: "Enter" });
  expect(onChoose).toHaveBeenCalledWith("delete", undefined);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
  fireEvent.mouseDown(document.querySelector(".tp-scrim"));
  expect(onCancel).toHaveBeenCalledTimes(2);
});

test("two choices with notes, the default one focused; 취소 is the third row; Tab stays inside", () => {
  const onChoose = jest.fn();
  render(
    <ConfirmDialog
      title="'일기' 카테고리를 지울까요?"
      choices={[
        { id: "category", label: "카테고리만 지우기", note: "할 일 3개는 다른 화면에도 보여요" },
        { id: "tasks", label: "할 일까지 지우기", danger: true },
      ]}
      defaultId="category"
      onChoose={onChoose}
      onCancel={() => {}}
    />
  );
  const buttons = screen.getAllByRole("button");
  expect(buttons.map((b) => b.textContent)).toEqual(["카테고리만 지우기할 일 3개는 다른 화면에도 보여요", "할 일까지 지우기", "취소"]);
  expect(buttons.map((b) => b.className)).toEqual(["tp-dbtn pri", "tp-dbtn danger", "tp-dbtn"]);
  expect(document.activeElement).toBe(buttons[0]);
  buttons[2].focus();
  fireEvent.keyDown(buttons[2], { key: "Tab" });
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(buttons[0], { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(buttons[2]);
  fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });
  expect(onChoose).toHaveBeenCalledWith("category", undefined);
});

test("over an open popup, Esc and presses go to the dialog only", () => {
  const onPopClose = jest.fn(), onCancel = jest.fn();
  render(
    <>
      <Popover anchor={{ x: 0, y: 0 }} label="메뉴" onClose={onPopClose}>메뉴</Popover>
      <ConfirmDialog title="삭제할까요?" choices={del} onChoose={() => {}} onCancel={onCancel} />
    </>
  );
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
  fireEvent.mouseDown(document.querySelector(".tp-scrim"));
  expect(onPopClose).not.toHaveBeenCalled();
});

test("focus goes back to the opener, or to returnFocus when given", () => {
  const opener = document.createElement("button");
  const row = document.createElement("button");
  document.body.append(opener, row);
  opener.focus();
  const first = render(<ConfirmDialog title="삭제할까요?" choices={del} onChoose={() => {}} onCancel={() => {}} />);
  expect(document.activeElement).not.toBe(opener);
  first.unmount();
  expect(document.activeElement).toBe(opener);
  // Opened from a menu item that is gone by the time it closes: back to the row.
  const second = render(<ConfirmDialog title="삭제할까요?" choices={del} returnFocus={row} onChoose={() => {}} onCancel={() => {}} />);
  second.unmount();
  expect(document.activeElement).toBe(row);
  opener.remove();
  row.remove();
});

test("its events do not reach the React parents", () => {
  const onParentKey = jest.fn(), onParentClick = jest.fn();
  render(
    <div onKeyDown={onParentKey} onClick={onParentClick}>
      <ConfirmDialog title="삭제할까요?" choices={del} onChoose={() => {}} onCancel={() => {}} />
    </div>
  );
  fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Delete" });
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(onParentKey).not.toHaveBeenCalled();
  expect(onParentClick).not.toHaveBeenCalled();
});

test("icons: the trash tile at 26px, the shield at 28px, in the given colour", () => {
  const { rerender } = render(<ConfirmDialog icon="trash" iconColor="#f0838b" title="삭제할까요?" choices={del} />);
  let tile = document.querySelector(".tp-dialog-i");
  expect(tile.style.color).toBe("rgb(240, 131, 139)");
  expect(tile.querySelector("svg")).toHaveAttribute("width", "26");
  rerender(<ConfirmDialog icon="shield" iconColor="#e57ad6" title="볼까요?" choices={del} />);
  tile = document.querySelector(".tp-dialog-i");
  expect(tile.style.color).toBe("rgb(229, 122, 214)");
  expect(tile.querySelector("svg")).toHaveAttribute("width", "28");
  rerender(<ConfirmDialog icon="trash" iconSize={20} title="삭제할까요?" choices={del} />);
  expect(document.querySelector(".tp-dialog-i svg")).toHaveAttribute("width", "20");
});

describe("with a password field", () => {
  const input = { type: "password", label: "보관함 비밀번호", placeholder: "보관함 비밀번호" };
  const ok = [{ id: "confirm", label: "확인" }];

  test("the field has focus; 확인 waits for a value; Enter gives the value (not while composing)", () => {
    const onChoose = jest.fn();
    render(<ConfirmDialog title="비밀 카테고리를 볼까요?" input={input} choices={ok} onChoose={onChoose} onCancel={() => {}} />);
    const field = screen.getByLabelText("보관함 비밀번호");
    expect(field).toHaveAttribute("type", "password");
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole("button", { name: "확인" })).toBeDisabled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "비밀" } });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChoose).toHaveBeenCalledWith("confirm", "비밀");
  });

  test("busy holds the field and 확인; a check that ends with an error starts the field over", () => {
    const { rerender } = render(<ConfirmDialog title="t" input={input} choices={ok} onChoose={() => {}} onCancel={() => {}} />);
    const field = screen.getByLabelText("보관함 비밀번호");
    fireEvent.change(field, { target: { value: "틀림" } });
    rerender(<ConfirmDialog title="t" input={input} choices={ok} busy onChoose={() => {}} onCancel={() => {}} />);
    expect(field).toBeDisabled();
    expect(screen.getByRole("button", { name: "확인" })).toBeDisabled();
    expect(screen.getByRole("alertdialog")).toHaveAttribute("aria-busy", "true");
    rerender(<ConfirmDialog title="t" input={input} choices={ok} error="비밀번호가 맞지 않아요." onChoose={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("비밀번호가 맞지 않아요.");
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(field);
  });

  test("closing wipes the typed password from the field", () => {
    const { unmount } = render(<ConfirmDialog title="t" input={input} choices={ok} onChoose={() => {}} onCancel={() => {}} />);
    const field = screen.getByLabelText("보관함 비밀번호");
    fireEvent.change(field, { target: { value: "비밀" } });
    unmount();
    expect(field.value).toBe("");
  });

  test("Esc closes only the dialog, not a drawer listening on the document", () => {
    const drawer = jest.fn(), onCancel = jest.fn();
    const onKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented) drawer(); };
    document.addEventListener("keydown", onKey);
    render(<ConfirmDialog title="t" input={input} choices={ok} onChoose={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByLabelText("보관함 비밀번호"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(drawer).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onKey);
  });
});

describe("delete questions (mock confirmDialog())", () => {
  test("task: trash, the title quoted with straight quotes, 을/를 by the last syllable", () => {
    expect(taskDeleteConfirm("주간 보고서 제출")).toMatchObject({
      icon: "trash",
      iconColor: "var(--danger)",
      title: "할 일을 삭제할까요?",
      body: "'주간 보고서 제출'을 지워요. 되돌릴 수 없어요.",
      choices: [{ id: "delete", label: "삭제", danger: true }],
    });
    expect(taskDeleteConfirm("책장 정리하기").body).toBe("'책장 정리하기'를 지워요. 되돌릴 수 없어요.");
    expect(objectParticle("Report")).toBe("을(를)");
  });

  test("category in use, unused, and secret with two choices", () => {
    expect(categoryDeleteConfirm({ title: "업무" }, 4)).toMatchObject({
      icon: "trash",
      title: "'업무' 카테고리를 지울까요?",
      body: "할 일 4개에서 빠져요. 할 일은 남아요.",
      choices: [{ id: "delete", label: "삭제", danger: true }],
    });
    expect(categoryDeleteConfirm({ title: "시험" }, 0).body).toBe("이 카테고리를 쓰는 할 일은 없어요.");
    const secret = categoryDeleteConfirm({ title: "일기", secret: true, color: "#e57ad6" }, 2);
    expect(secret).toMatchObject({ icon: "shield", iconColor: "#e57ad6", body: "할 일 2개에 쓰이고 있어요.", defaultId: "category" });
    expect(secret.choices).toEqual([
      { id: "category", label: "카테고리만 지우기", note: "할 일 2개는 다른 화면에도 보여요" },
      { id: "tasks", label: "할 일까지 지우기", danger: true },
    ]);
  });
});
