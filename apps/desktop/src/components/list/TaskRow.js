import "./TaskRow.scss";
import { memo, useEffect, useRef, useState } from "react";
import useClock from "hooks/UseClock";
import { CheckIcon, MemoIcon, RepeatIcon, ShieldIcon, StarIcon, SubtaskIcon } from "molecules/pickers/icons";
import { categoryColor } from "utils/categoryColors";
import { normalRepeat, repeatShortName } from "utils/repeatRule";
import { dueMs, formatTaskTimes } from "utils/timeDisplay";
import { highlightParts } from "./listModel";
import { restoreRow } from "./useTaskCompletion";

const SEP = "\u0001";

// Text with the search matches marked.
export function Highlighted({ text, query }) {
  if (!query) return text;
  return highlightParts(text, query).map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : part.text));
}

// The right column (#102 mock rightCol): due on top in 설정 > 시간 표시's format, the remaining time
// below (muted; left out when 남은 시간 보이기 is off or the task is done). Red when overdue.
// Re-renders only when its text changes (shared clock).
function TimeColumn({ due, done, options }) {
  const text = useClock((now) => {
    const t = formatTaskTimes(due, now, options);
    return [t.due, done ? "" : t.remain ?? "", !done && t.overdue ? "1" : "", due - now < 0 ? "1" : ""].join(SEP);
  });
  const [when, remain, overdue, past] = text.split(SEP);
  return (
    <div className={"rcol" + (remain ? "" : " one")}>
      <span className={"when" + (overdue ? " over" : "")}>{when}</span>
      {remain && <span className={"left" + (past ? " over" : "")}>{remain}</span>}
    </div>
  );
}

// A row of the list (#102 mock taskRow): check, title, meta line (category, repeat, subtasks,
// memo), the right time column (always there, so titles line up) and the star. No hover buttons;
// the rest is in the task menu. An option of the group's listbox: Enter opens (onSelect), Space
// completes. catsOf(task) gives the categories to show ([{ id, title, color, secret }], hidden
// secret ones already left out); `cats` is the fixed list for callers without it. Completing
// goes through onToggleDone(task, rowElement, done), which animates.
// hidden: a search hit in a hidden secret category (mock hidden-hit): marked, dimmed, and while
// `needsUnlock` every action first waits for onUnlock(task) → Promise<boolean>, and the memo
// snippet stays out (title and category only, like the mock).
function TaskRow({
  task, catsOf, cats: fixedCats, selected = false, compact = false, timeOptions, query = "", snippet: memoSnippet = null,
  hidden = false, needsUnlock = false, onUnlock, onSelect, onToggleDone, onToggleStar, onMenu, onKeyDown,
}) {
  const snippet = needsUnlock ? null : memoSnippet;
  const ref = useRef(null);
  const [pop, setPop] = useState(false);
  const cats = (catsOf ? catsOf(task) : fixedCats) ?? [];
  const due = dueMs(task.dueDate);
  const done = !!task.done;
  const first = cats[0];
  const repeat = due !== null ? repeatShortName(normalRepeat(task.repeatPeriod)) : "";
  const subtasks = Object.values(task.subtasks ?? {});
  const subDone = subtasks.filter((s) => s.done).length;
  const hasMemo = !!String(task.memo ?? "").trim();
  const hasMeta = !!(first || repeat || subtasks.length || hasMemo || snippet);
  const checked = done || pop;

  // A repeating task stays open with its next due: the check goes back once it rolled forward.
  useEffect(() => {
    if (!pop) return undefined;
    const timer = setTimeout(() => setPop(false), 1200);
    return () => clearTimeout(timer);
  }, [pop]);

  // Done and still here (the row stays in the same box, e.g. search results): show it again.
  useEffect(() => {
    if (done && ref.current) restoreRow(ref.current);
  }, [done]);

  // Hidden secret hits ask for the unlock before anything happens.
  const gate = (fn) => {
    if (!needsUnlock) return fn();
    Promise.resolve(onUnlock?.(task)).then((ok) => ok && fn());
    return undefined;
  };

  const completeNow = () => {
    if (done) return onToggleDone?.(task, ref.current, false);
    if (pop) return undefined;
    setPop(true);
    onToggleDone?.(task, ref.current, true);
    return undefined;
  };
  const toggleDone = (event) => {
    event.stopPropagation();
    gate(completeNow);
  };

  return (
    <div
      ref={ref}
      className={
        "task-row" + (done ? " done" : "") + (selected ? " sel" : "") + (compact ? " compact" : "") + (hasMeta ? "" : " no-meta") +
        (hidden ? " hidden-hit" : "")
      }
      data-task-id={task.id}
      tabIndex={0}
      role="option"
      aria-selected={selected}
      aria-label={hidden ? `${task.title} (숨김)` : task.title}
      onClick={() => gate(() => onSelect?.(task))}
      onContextMenu={(event) => {
        event.preventDefault();
        const point = { x: event.clientX, y: event.clientY };
        gate(() => onMenu?.(task, point, ref.current));
      }}
      onKeyDown={(event) => {
        if (event.target === ref.current && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          if (event.repeat) return;
          gate(event.key === "Enter" ? () => onSelect?.(task) : completeNow);
          return;
        }
        onKeyDown?.(event, task, ref.current);
      }}
    >
      <button
        type="button"
        className={"ck" + (checked ? " done" : "") + (pop && !done ? " pop" : "")}
        role="checkbox"
        aria-checked={checked}
        aria-label={done ? "완료 취소" : "할 일 완료"}
        tabIndex={-1}
        onClick={toggleDone}
      >
        <CheckIcon />
      </button>
      <div className="tx">
        <div className="t">
          <i className="ic-cat" style={{ background: first ? categoryColor(first) : "transparent" }} aria-hidden="true" />
          <Highlighted text={task.title} query={query} />
          {hidden && (
            <span className="hid-tag" data-tip={needsUnlock ? "비밀 카테고리 할 일이에요. 열면 본인 확인을 해요" : "비밀 카테고리 할 일이에요"}>
              <ShieldIcon size={11} /><span>숨김</span>
            </span>
          )}
        </div>
        {snippet !== null ? (
          <div className="meta snip"><span><Highlighted text={snippet} query={query} /></span></div>
        ) : hasMeta && (
          <div className="meta">
            {first && (
              <span className="cat">
                {first.secret
                  ? <span className="shield" style={{ color: categoryColor(first) }} role="img" aria-label="비밀 카테고리"><ShieldIcon size={12} /></span>
                  : <span className="dot" style={{ background: categoryColor(first) }} />}
                <b>{first.title}</b>
                {cats.length > 1 && <b className="more" data-tip={cats.map((c) => c.title).join(", ")}>+{cats.length - 1}</b>}
              </span>
            )}
            {repeat && <span className="rep"><RepeatIcon /><i>{repeat}</i></span>}
            {subtasks.length > 0 && <span className="sub" aria-label={`하위 할 일 ${subDone}/${subtasks.length}`}><SubtaskIcon /><i>{subDone}/{subtasks.length}</i></span>}
            {hasMemo && <span className="memo" data-tip="메모 있음" aria-label="메모 있음"><MemoIcon /></span>}
          </div>
        )}
      </div>
      {due !== null ? <TimeColumn due={due} done={done} options={timeOptions} /> : <div className="rcol" />}
      <button
        type="button"
        className={"st" + (task.important ? " on" : "")}
        aria-label={task.important ? "중요 해제" : "중요로 표시"}
        aria-pressed={!!task.important}
        data-tip={task.important ? "중요 해제" : "중요로 표시"}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          gate(() => onToggleStar?.(task));
        }}
      >
        <StarIcon filled={!!task.important} size={19} />
      </button>
    </div>
  );
}

// Rows re-render only when their own props change (selection moves touch two rows).
export default memo(TaskRow);
