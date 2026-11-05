import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Subtask from "objects/Subtask";
import Toast from "molecules/Toast";
import { closeAllPopups } from "molecules/pickers";
import { CheckIcon, CloseIcon, PlusIcon } from "molecules/pickers/icons";
import { categoryMoveAnchor, sortSubtasks } from "utils/categoryOrder";
import { useTaskSelection } from "../list/taskSelection";
import { composing, useAutoHeight, useInPlaceEdit } from "./inPlaceEdit";
import useSubtaskDrag from "./useSubtaskDrag";

// The subtask order (sort_rank, #106) is E2EE-only (canSort), and the legacy and plaintext v2
// paths answer the move with UNSUPPORTED_*. Seen once, the panel stops offering the order for
// the rest of the run.
let orderRefused = false;
export const resetSubtaskOrderForTests = () => {
  orderRefused = false;
};
const isUnsupported = (data) => /^UNSUPPORTED_/.test(data?.code ?? "");

// Whether the synced order has the move: the subtask right after (or before) its anchor.
const hasMove = (ids, { id, anchorId, after }) => {
  const i = ids.indexOf(id), j = ids.indexOf(anchorId);
  return i >= 0 && j >= 0 && i === j + (after ? 1 : -1);
};

const GripIcon = () => (
  <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true" focusable="false">
    <circle cx="2" cy="2" r="1.25" /><circle cx="6" cy="2" r="1.25" />
    <circle cx="2" cy="7" r="1.25" /><circle cx="6" cy="7" r="1.25" />
    <circle cx="2" cy="12" r="1.25" /><circle cx="6" cy="12" r="1.25" />
  </svg>
);

// The name being renamed wraps like the name (#107 mock textarea.rp-sub-in.ml) and grows with it;
// the caret starts at the end.
function RenameField({ edit, onBlur }) {
  const ref = useRef(null);
  useAutoHeight(ref, edit.value);
  useLayoutEffect(() => {
    const el = ref.current;
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      className="rp-sub-in"
      rows={1}
      aria-label="하위 할 일 이름"
      maxLength={500}
      spellCheck={false}
      autoFocus
      {...edit}
      onBlur={onBlur}
    />
  );
}

// One subtask (#102 mock .subt, #107 mock .rp-subt.ml): check, the name (wraps to show all of it;
// click edits it in place: Enter saves, Esc puts it back, line breaks become spaces) and, on
// hover, 삭제. The × keeps its place while hidden, so the name wraps the same on hover and while
// renaming. No due on PC since #107 (a due set on the phone stays stored). Deleting is
// immediate, as before the redesign. sortable adds the grip on hover, outside the box on the
// left, to drag it (#106; no Alt+↑/↓ since #107: the row cannot be focused without starting an
// edit).
function SubtaskRow({ task, subtask, sortable }) {
  const { actions } = useTaskSelection();
  const [editing, setEditing] = useState(false);
  const edit = useInPlaceEdit(subtask.title, (title) => actions.setSubtaskTitle(task.id, subtask.id, title), { singleLine: true });
  const done = !!subtask.done;

  return (
    <div className={"rp-subt" + (done ? " done" : "") + (editing ? " edit" : "")} data-subtask-id={subtask.id}>
      {sortable && !editing && (
        <span className="sgrip" data-tip="끌어서 순서 바꾸기" aria-hidden="true">
          <GripIcon />
        </span>
      )}
      <button
        type="button"
        className={"ck" + (done ? " done" : "")}
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `하위 할 일 완료 취소: ${subtask.title}` : `하위 할 일 완료: ${subtask.title}`}
        onClick={() => actions.setSubtaskDone(task.id, subtask.id, !done)}
      >
        <CheckIcon />
      </button>
      {editing ? (
        <RenameField edit={edit} onBlur={(event) => { edit.onBlur(event); setEditing(false); }} />
      ) : (
        <button
          type="button"
          className="nm"
          data-tip="눌러서 이름 바꾸기"
          onClick={() => setEditing(true)}
        >
          {subtask.title}
        </button>
      )}
      <span className="sacts">
        {!editing && (
          <button type="button" className="rp-ghost" aria-label="하위 할 일 삭제" data-tip="하위 할 일 삭제" onClick={() => actions.deleteSubtask(task.id, subtask.id)}>
            <CloseIcon />
          </button>
        )}
      </span>
    </div>
  );
}

// 하위 할 일 (#102 mock): the count and a progress bar, the rows, and 하위 할 일 추가 (Enter adds
// and stays for the next one; Esc leaves). Rows follow the synced order (#106: sort_rank, then
// created_at); with canSort they can be dragged by the grip.
export default function SubtaskList({ task, canSort = true }) {
  const { actions } = useTaskSelection();
  const [title, setTitle] = useState("");
  const boxRef = useRef(null);
  const [, setRefused] = useState(orderRefused);
  const sortable = canSort && !orderRefused;
  const synced = sortSubtasks(Object.values(task.subtasks ?? {}));
  const syncedKey = synced.map((s) => s.id).join("\n");

  // The dropped order, shown until the synced order has the move. Each move has a number, so
  // the reply of an older move does not end a newer one.
  const [pending, setPending] = useState(null); // { seq, ids, move, acked }
  const moveSeq = useRef(0);
  const lastKey = useRef(syncedKey);
  useEffect(() => {
    const changed = lastKey.current !== syncedKey;
    lastKey.current = syncedKey;
    // The synced order has the move, or the state after the reply came (the truth now).
    if (pending && (hasMove(syncedKey.split("\n"), pending.move) || (changed && pending.acked))) setPending(null);
  }, [syncedKey, pending]);
  let subtasks = synced;
  if (pending) {
    const byId = Object.fromEntries(synced.map((s) => [s.id, s]));
    subtasks = [...pending.ids.map((id) => byId[id]).filter(Boolean), ...synced.filter((s) => !pending.ids.includes(s.id))];
  }
  const doneCount = subtasks.filter((s) => s.done).length;

  // Puts `id` at index `to` of the shown order.
  const move = (id, to) => {
    const ids = subtasks.map((s) => s.id);
    const anchor = categoryMoveAnchor(ids, id, to);
    if (!anchor) return;
    const next = ids.filter((x) => x !== id);
    next.splice(next.indexOf(anchor.anchorId) + (anchor.after ? 1 : 0), 0, id);
    const seq = ++moveSeq.current;
    setPending({ seq, ids: next, move: { id, ...anchor }, acked: false });
    actions.moveSubtask(task.id, id, anchor.anchorId, anchor.after, ({ success, data } = {}) => {
      setPending((p) => (p?.seq !== seq ? p : success ? { ...p, acked: true } : null));
      if (success) return;
      if (isUnsupported(data)) {
        orderRefused = true;
        setRefused(true);
        Toast.warn("이 계정에서는 하위 할 일 순서를 바꿀 수 없어요.");
      } else Toast.warn("하위 할 일 순서를 바꾸지 못했어요.");
    });
  };

  useSubtaskDrag(boxRef, {
    enabled: sortable && subtasks.length > 1,
    // A lifted row closes the open pickers.
    onLift: () => closeAllPopups(),
    onDrop: (id, from, to) => move(id, to),
  });

  const add = () => {
    const text = title.trim();
    if (!text) return;
    actions.addSubtask(task.id, new Subtask(text, null));
    setTitle("");
  };

  return (
    <>
      <div className="rp-block-h">
        하위 할 일
        {subtasks.length > 0 && <span>{doneCount}/{subtasks.length}</span>}
      </div>
      <div ref={boxRef} className={"rp-box rp-subs" + (sortable ? " sortable" : "")}>
        {subtasks.length > 0 && (
          <div className="rp-bar" role="progressbar" aria-label="하위 할 일 진행" aria-valuemin={0} aria-valuemax={subtasks.length} aria-valuenow={doneCount}>
            <i style={{ width: `${(doneCount / subtasks.length) * 100}%` }} />
          </div>
        )}
        {subtasks.map((s) => (
          <SubtaskRow key={s.id} task={task} subtask={s} sortable={sortable} />
        ))}
        <label className="rp-subt add">
          <i><PlusIcon size={14} /></i>
          <input
            type="text"
            aria-label="하위 할 일 추가"
            placeholder="하위 할 일 추가"
            maxLength={500}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !composing(e)) {
                e.preventDefault();
                add();
              } else if (e.key === "Escape" && !composing(e)) {
                e.preventDefault();
                setTitle("");
                e.currentTarget.blur();
              }
            }}
          />
        </label>
      </div>
    </>
  );
}
