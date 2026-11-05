import { useEffect, useRef, useState } from "react";
import Subtask from "objects/Subtask";
import Toast from "molecules/Toast";
import { DatePicker, closeAllPopups } from "molecules/pickers";
import { CalendarIcon, CheckIcon, CloseIcon, PlusIcon } from "molecules/pickers/icons";
import { categoryMoveAnchor, sortSubtasks } from "utils/categoryOrder";
import { dueMs, formatDue } from "utils/timeDisplay";
import { useTaskSelection } from "../list/taskSelection";
import { composing, useInPlaceEdit } from "./inPlaceEdit";
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

// 기한 빼기: the calendar struck through (a second × next to 삭제 would read the same).
const NoDueIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M7 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14M21 17V7a2 2 0 0 0-2-2h-8M3 10h4M13 10h8M8 3v2M16 3v4M3 3l18 18" />
  </svg>
);

// One subtask (#102 mock .subt): check, the name (click edits it in place: Enter saves, Esc puts
// it back), a set due small on the right (red when overdue) and, on hover, 기한 / 삭제 (plus
// 기한 빼기 when it has one). Deleting is immediate, as before the redesign. sortable adds the
// grip on hover at the left to drag it (#106; no Alt+↑/↓ since #107: the row cannot be focused
// without starting an edit).
function SubtaskRow({ task, subtask, timeFormat, now, sortable }) {
  const { actions } = useTaskSelection();
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(null); // the 기한 button while its picker is open
  const rowRef = useRef(null);
  const edit = useInPlaceEdit(subtask.title, (title) => actions.setSubtaskTitle(task.id, subtask.id, title));
  const due = dueMs(subtask.dueDate);
  const done = !!subtask.done;
  const over = !done && due !== null && due < now;

  return (
    <div ref={rowRef} className={"rp-subt" + (done ? " done" : "") + (editing ? " edit" : "") + (picker ? " hov" : "")} data-subtask-id={subtask.id}>
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
        <input
          className="rp-sub-in"
          type="text"
          aria-label="하위 할 일 이름"
          maxLength={500}
          autoFocus
          {...edit}
          onBlur={(event) => { edit.onBlur(event); setEditing(false); }}
        />
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
      {due !== null && !editing && (
        <span className={"sdue" + (over ? " over" : "")}>{formatDue(due, now, "group", timeFormat)}</span>
      )}
      {!editing && (
        <span className="sacts">
          <button
            type="button"
            className="rp-ghost"
            aria-label={due !== null ? "기한 바꾸기" : "기한 정하기"}
            data-tip={due !== null ? "기한 바꾸기" : "기한 정하기"}
            onClick={(event) => {
              const el = event.currentTarget;
              setPicker((current) => (current ? null : el));
            }}
          >
            <CalendarIcon />
          </button>
          {due !== null && (
            <button type="button" className="rp-ghost" aria-label="기한 빼기" data-tip="기한 빼기" onClick={() => actions.setSubtaskDue(task.id, subtask.id, null)}>
              <NoDueIcon />
            </button>
          )}
          <button type="button" className="rp-ghost" aria-label="하위 할 일 삭제" data-tip="하위 할 일 삭제" onClick={() => actions.deleteSubtask(task.id, subtask.id)}>
            <CloseIcon />
          </button>
        </span>
      )}
      {picker && (
        <DatePicker
          anchor={rowRef}
          placement="bottom-start"
          gap={4}
          ignoreOutside={[picker]}
          returnFocus={picker}
          value={due}
          timeFormat={timeFormat}
          onChange={(ms) => { actions.setSubtaskDue(task.id, subtask.id, ms); setPicker(null); }}
          onCancel={() => setPicker(null)}
        />
      )}
    </div>
  );
}

// 하위 할 일 (#102 mock): the count and a progress bar, the rows, and 하위 할 일 추가 (Enter adds
// and stays for the next one; Esc leaves). Rows follow the synced order (#106: sort_rank, then
// created_at); with canSort they can be dragged by the grip.
export default function SubtaskList({ task, timeFormat, now, canSort = true }) {
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
    // A lifted row closes the open pickers (a subtask's 기한 too).
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
          <SubtaskRow key={s.id} task={task} subtask={s} timeFormat={timeFormat} now={now} sortable={sortable} />
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
