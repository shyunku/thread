import { useEffect, useLayoutEffect, useRef, useState } from "react";
import useClock from "hooks/UseClock";
import Toast from "molecules/Toast";
import { CategoryPicker, DatePicker, RepeatPicker } from "molecules/pickers";
import { CheckIcon, PlusIcon, ShieldIcon, StarIcon } from "molecules/pickers/icons";
import { categoryColor } from "utils/categoryColors";
import { isOverdue } from "utils/menuFilters";
import { endOfDay, normalRepeat, repeatName } from "utils/repeatRule";
import { dueMs, formatClock, formatDueDetail, hasDueTime } from "utils/timeDisplay";
import { useTaskSelection } from "../list/taskSelection";
import { startOfDay } from "./pickedDay";
import SubtaskList from "./SubtaskList";
import { composing, useInPlaceEdit } from "./inPlaceEdit";

const MEMO_SAVE_DELAY = 800;

// "10월 14일" (another year: "2025년 10월 14일"); today and yesterday with the clock when `clock`.
export function stampText(value, now, timeFormat = "12", clock = false) {
  const ms = dueMs(value);
  if (ms === null) return null;
  const date = new Date(ms), days = Math.round((startOfDay(now) - startOfDay(ms)) / 864e5);
  if (clock && (days === 0 || days === 1)) return `${days === 0 ? "오늘" : "어제"} ${formatClock(date, timeFormat)}`;
  const year = date.getFullYear() !== new Date(now).getFullYear() ? `${date.getFullYear()}년 ` : "";
  return `${year}${date.getMonth() + 1}월 ${date.getDate()}일`;
}

// "2026.10.21 오후 5:30"; a due without a chosen time (23:59) reads "2026.10.21 · 하루 끝".
export function dueDetailText(due, timeFormat = "12") {
  if (hasDueTime(due)) return formatDueDetail(due, timeFormat);
  const date = new Date(due);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} · 하루 끝`;
}

const fitHeight = (el) => {
  el.style.height = "auto";
  if (el.scrollHeight) el.style.height = `${el.scrollHeight}px`;
};

// Grows a textarea with its text, and again when its width changes (the panel is resized).
function useAutoHeight(ref, value) {
  useLayoutEffect(() => {
    if (ref.current) fitHeight(ref.current);
  }, [ref, value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return; // its own height change
      width = el.clientWidth;
      fitHeight(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}

function TitleField({ task }) {
  const { actions } = useTaskSelection();
  const ref = useRef(null);
  // One line (pasted breaks become spaces); a changed title is saved when the panel moves to
  // another task or the window closes, too.
  const edit = useInPlaceEdit(task.title, (title) => actions.setTitle(task.id, title), { singleLine: true, flushOnExit: true });
  useAutoHeight(ref, edit.value);
  return (
    <textarea
      ref={ref}
      className={"rp-title" + (task.done ? " done" : "")}
      rows={1}
      aria-label="할 일 제목"
      maxLength={500}
      spellCheck={false}
      {...edit}
    />
  );
}

// 메모: saved a moment after typing stops, when leaving the field, when the panel changes task and
// when the window closes.
function MemoField({ task }) {
  const { actions } = useTaskSelection();
  const ref = useRef(null);
  const [draft, setDraft] = useState(task.memo ?? "");
  const saved = useRef(task.memo ?? "");
  const focused = useRef(false);
  const timer = useRef(null);
  const latest = useRef({ draft, id: task.id, setMemo: actions.setMemo });
  latest.current = { draft, id: task.id, setMemo: actions.setMemo };
  useAutoHeight(ref, draft);

  const flush = () => {
    clearTimeout(timer.current);
    timer.current = null;
    const { draft: text, id, setMemo } = latest.current;
    if (text === saved.current) return;
    saved.current = text;
    setMemo(id, text);
  };
  // A memo synced from elsewhere shows unless there is typing not saved yet.
  useEffect(() => {
    if (focused.current && latest.current.draft !== saved.current) return;
    saved.current = task.memo ?? "";
    setDraft(task.memo ?? "");
  }, [task.memo]);
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <textarea
      ref={ref}
      className="rp-box rp-memo"
      aria-label="메모"
      placeholder="메모를 적어 두세요"
      value={draft}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; flush(); }}
      onChange={(event) => {
        setDraft(event.target.value);
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, MEMO_SAVE_DELAY);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !composing(event)) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

// 할 일 상세 (#102 mock detailBody): title with the check and the star, 기한 / 반복 / 카테고리
// rows that open their pickers below the row, 하위 할 일, 메모 and the stamp line. No remaining
// time here (decided). canStar false leaves the star out (the plaintext sync and legacy paths
// drop it).
export default function DetailPanel({ task, catsOf, prefs, canStar = true }) {
  const { actions, pickable } = useTaskSelection();
  const tf = prefs?.timeFormat === "24" ? "24" : "12";
  const [open, setOpen] = useState(null); // { kind: "due" | "repeat" | "cat", el }
  const due = dueMs(task.dueDate);
  const repeat = due === null ? null : normalRepeat(task.repeatPeriod);
  const anchorAt = dueMs(task.repeatStartAt) ?? due;
  const over = useClock((now) => isOverdue(task, Math.floor(now / 60000) * 60000));
  const now = useClock((t) => Math.floor(t / 60000) * 60000);
  const cats = catsOf?.(task) ?? [];
  const categoryIds = Object.keys(task.categories ?? {}).filter((id) => task.categories[id]);

  const toggle = (kind) => (event) => {
    const el = event.currentTarget;
    setOpen((current) => (current?.kind === kind ? null : { kind, el }));
  };
  const close = () => setOpen(null);
  const pickerProps = open && { anchor: open.el, placement: "bottom-start", gap: 6, ignoreOutside: [open.el], returnFocus: open.el };

  const setDone = () => {
    const done = !task.done;
    actions.setDone(task.id, done, ({ success } = {}) => {
      if (success === false) Toast.error(done ? "완료하지 못했어요." : "완료를 취소하지 못했어요.");
    });
  };
  // A repeat needs a due: without one, today's end of day is set first, then the repeat.
  const setRepeat = (period) => {
    if (period && due === null) {
      actions.setDue(task.id, endOfDay(Date.now()), ({ success } = {}) => {
        if (success === false) Toast.error("반복을 정하지 못했어요.");
        else actions.setRepeat(task.id, period);
      });
    } else actions.setRepeat(task.id, period);
  };
  const toggleCategory = (cid) => {
    if (task.categories?.[cid]) actions.removeCategory(task.id, cid);
    else actions.addCategory(task.id, cid);
  };
  const rowKey = (kind) => (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle(kind)(event);
  };
  const row = (kind, tip, cls) => ({
    role: "button",
    tabIndex: 0,
    className: `rp-prop click ${cls}` + (open?.kind === kind ? " open" : ""),
    "data-tip": tip,
    "aria-haspopup": "dialog",
    "aria-expanded": open?.kind === kind,
    onClick: toggle(kind),
    onKeyDown: rowKey(kind),
  });

  const created = stampText(task.createdAt, now, tf);
  const updated = stampText(task.updatedAt, now, tf, true);

  return (
    <div className="rp-detail">
      <div className="rp-dt-title">
        <button
          type="button"
          className={"ck" + (task.done ? " done" : "")}
          role="checkbox"
          aria-checked={!!task.done}
          aria-label={task.done ? "완료 취소" : "할 일 완료"}
          onClick={setDone}
        >
          <CheckIcon />
        </button>
        <TitleField task={task} />
        {canStar && (
          <button
            type="button"
            className={"st" + (task.important ? " on" : "")}
            aria-label={task.important ? "중요 해제" : "중요로 표시"}
            aria-pressed={!!task.important}
            data-tip={task.important ? "중요 해제" : "중요로 표시"}
            onClick={() => actions.setImportant(task.id, !task.important)}
          >
            <StarIcon filled={!!task.important} size={20} />
          </button>
        )}
      </div>

      <div className="rp-box">
        <div {...row("due", "기한 정하기", "first")} aria-label={`기한: ${due === null ? "없음" : dueDetailText(due, tf)}`}>
          <span className="k">기한</span>
          <span className={"v" + (over ? " over" : "")}>{due === null ? <span className="sub">없음</span> : dueDetailText(due, tf)}</span>
        </div>
        <div {...row("repeat", "반복 정하기", "mid")} aria-label={`반복: ${repeatName(repeat, anchorAt)}`}>
          <span className="k">반복</span>
          <span className="v">{repeat ? repeatName(repeat, anchorAt) : <span className="sub">안 함</span>}</span>
        </div>
        <div {...row("cat", "카테고리 고르기", "last")} aria-label={`카테고리: ${cats.map((c) => c.title).join(", ") || "없음"}`}>
          <span className="k">카테고리</span>
          <span className="v">
            {cats.map((c) => (
              <span key={c.id} className="rp-chip">
                {c.secret
                  ? <span className="rp-shield" style={{ color: categoryColor(c) }}><ShieldIcon size={12} /></span>
                  : <span className="rp-dot" style={{ background: categoryColor(c) }} />}
                <span className="lb">{c.title}</span>
              </span>
            ))}
            <span className="rp-chip add" aria-hidden="true"><PlusIcon size={14} /></span>
          </span>
        </div>
      </div>

      <SubtaskList task={task} timeFormat={tf} now={now} />

      <div className="rp-block-h">메모</div>
      <MemoField task={task} />

      {created && (
        <div className="rp-stamp">만든 날 {created}{updated ? ` · 마지막 수정 ${updated}` : ""}</div>
      )}

      {open?.kind === "due" && (
        <DatePicker
          {...pickerProps}
          value={due}
          timeFormat={tf}
          weekStart={prefs?.weekStart}
          onChange={(ms) => { actions.setDue(task.id, ms); close(); }}
          onCancel={close}
        />
      )}
      {open?.kind === "repeat" && (
        <RepeatPicker
          {...pickerProps}
          value={repeat}
          base={due}
          repeatStartAt={anchorAt}
          timeFormat={tf}
          onSelect={setRepeat}
          onClose={close}
        />
      )}
      {open?.kind === "cat" && (
        <CategoryPicker
          {...pickerProps}
          categories={pickable}
          selectedIds={categoryIds}
          onToggle={toggleCategory}
          onCreate={actions.createCategory}
          onClose={close}
        />
      )}
    </div>
  );
}
