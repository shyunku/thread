import { useRef, useState } from "react";
import Subtask from "objects/Subtask";
import { DatePicker } from "molecules/pickers";
import { CalendarIcon, CheckIcon, CloseIcon, PlusIcon } from "molecules/pickers/icons";
import { dueMs, formatDue } from "utils/timeDisplay";
import { useTaskSelection } from "../list/taskSelection";
import { composing, useInPlaceEdit } from "./inPlaceEdit";

const createdMs = (s) => dueMs(s.createdAt) ?? 0;

// 기한 빼기: the calendar struck through (a second × next to 삭제 would read the same).
const NoDueIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M7 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14M21 17V7a2 2 0 0 0-2-2h-8M3 10h4M13 10h8M8 3v2M16 3v4M3 3l18 18" />
  </svg>
);

// One subtask (#102 mock .subt): check, the name (click edits it in place: Enter saves, Esc puts
// it back), a set due small on the right (red when overdue) and, on hover, 기한 / 삭제 (plus
// 기한 빼기 when it has one). Deleting is immediate, as before the redesign.
function SubtaskRow({ task, subtask, timeFormat, now }) {
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
        <button type="button" className="nm" data-tip="눌러서 이름 바꾸기" onClick={() => setEditing(true)}>
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
// and stays for the next one; Esc leaves).
export default function SubtaskList({ task, timeFormat, now }) {
  const { actions } = useTaskSelection();
  const [title, setTitle] = useState("");
  const subtasks = Object.values(task.subtasks ?? {}).sort((a, b) => createdMs(a) - createdMs(b));
  const doneCount = subtasks.filter((s) => s.done).length;

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
      <div className="rp-box rp-subs">
        {subtasks.length > 0 && (
          <div className="rp-bar" role="progressbar" aria-label="하위 할 일 진행" aria-valuemin={0} aria-valuemax={subtasks.length} aria-valuenow={doneCount}>
            <i style={{ width: `${(doneCount / subtasks.length) * 100}%` }} />
          </div>
        )}
        {subtasks.map((s) => (
          <SubtaskRow key={s.id} task={task} subtask={s} timeFormat={timeFormat} now={now} />
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
