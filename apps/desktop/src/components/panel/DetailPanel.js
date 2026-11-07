import { useEffect, useRef, useState } from "react";
import useClock from "hooks/UseClock";
import Toast from "molecules/Toast";
import { CategoryPicker, DatePicker, RepeatPicker } from "molecules/pickers";
import { CheckIcon, PlusIcon, ShieldIcon, StarIcon } from "molecules/pickers/icons";
import { AlertBell, AlertPopover } from "molecules/pickers/TaskAlerts";
import { useAlertSettings } from "utils/alertSettings";
import { categoryColor } from "utils/categoryColors";
import { isOverdue } from "utils/menuFilters";
import { periodProgress, periodRepeatName, startDetailText } from "utils/periodDisplay";
import { endOfDay, normalRepeat } from "utils/repeatRule";
import { taskAlerts, taskStart } from "utils/taskPeriod";
import { dueMs, formatClock, formatDueDetail, hasDueTime } from "utils/timeDisplay";
import { useTaskSelection } from "../list/taskSelection";
import { startOfDay } from "./pickedDay";
import SubtaskList from "./SubtaskList";
import { composing, useAutoHeight, useInPlaceEdit } from "./inPlaceEdit";

const MEMO_SAVE_DELAY = 800;
// String length, as the textarea's maxLength counts it (#107).
const MEMO_MAX = 10000;
const num = (n) => n.toLocaleString("en-US");

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
// when the window closes. Up to MEMO_MAX (#107 mock .memo-foot): the count always shows below,
// typing stops at the limit and a paste that goes over keeps what fits and says so until the
// next edit. A longer memo (an older version, the phone) is never cut: it only takes deletions
// (maxLength does that) until it is under.
function MemoField({ task }) {
  const { actions } = useTaskSelection();
  const ref = useRef(null);
  const [draft, setDraft] = useState(task.memo ?? "");
  const [note, setNote] = useState("");
  const pasting = useRef(false); // the change of a cut paste keeps its note
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
    <>
      <textarea
        ref={ref}
        className="rp-box rp-memo"
        aria-label="메모"
        placeholder="메모를 적어 두세요"
        maxLength={MEMO_MAX}
        value={draft}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; flush(); }}
        onPaste={(event) => {
          // The browser inserts only what fits; the line breaks count once, as in the value.
          const text = (event.clipboardData?.getData("text") ?? "").replace(/\r\n?/g, "\n");
          const el = event.currentTarget;
          const room = Math.max(0, MEMO_MAX - (el.value.length - (el.selectionEnd - el.selectionStart)));
          const over = text.length - room;
          // Nothing fits: no change follows, so the note stays without one.
          pasting.current = over > 0 && room > 0;
          if (over > 0) setNote(`넘는 ${num(over)}자는 빼고 붙였어요`);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          if (pasting.current) pasting.current = false;
          else setNote("");
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
      <div className={"rp-memo-foot" + (draft.length >= MEMO_MAX ? " full" : "")}>
        {note && <span className="note">{note}</span>}
        <span className="n">{num(draft.length)} / {num(MEMO_MAX)}</span>
      </div>
    </>
  );
}

// 진행 (#109 mock progRow): a thin bar and how far the period has gone.
function ProgressRow({ task }) {
  const text = useClock((now) => {
    const p = periodProgress(task, Math.floor(now / 60000) * 60000, !!task.done);
    return p ? `${Math.round(p.progress * 100)}|${p.over ? 1 : ""}|${p.label}` : "";
  });
  if (!text) return null;
  const [pct, over, label] = text.split("|");
  return (
    <div className="rp-prop static rp-prog mid">
      <span className="k">진행</span>
      <span className="v">
        <span className={"pbar" + (over ? " over" : "")} role="progressbar" aria-label="진행" aria-valuenow={Number(pct)} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${pct}%` }} />
        </span>
        <span className={"pl" + (over ? " over" : "")}>{label}</span>
      </span>
    </div>
  );
}

// 할 일 상세 (#102 mock detailBody): title with the check and the star, 기한 / 반복 / 카테고리
// rows that open their pickers below the row, 하위 할 일, 메모 and the stamp line. No remaining
// time here (decided). canStar false leaves the star out (before the sync status comes).
// A period (#109) has 시작 and 끝 rows and 진행 instead of 기한; a due alone has "+ 시작", which
// opens the picker on an empty start. Each side with a time has a bell for its own alert.
export default function DetailPanel({ task, catsOf, prefs, canStar = true }) {
  const { actions, pickable, complete } = useTaskSelection();
  const tf = prefs?.timeFormat === "24" ? "24" : "12";
  // { kind: "due" | "start" | "end" | "addStart" | "repeat" | "cat" | "bell", el, side }
  const [open, setOpen] = useState(null);
  const due = dueMs(task.dueDate);
  const start = due === null ? null : taskStart(task);
  const alertSettings = useAlertSettings();
  const alerts = taskAlerts(task, alertSettings);
  const alertOf = (side) => alerts.find((a) => a.side === side);
  const repeat = due === null ? null : normalRepeat(task.repeatPeriod);
  const anchorAt = dueMs(task.repeatStartAt) ?? due;
  const over = useClock((now) => isOverdue(task, Math.floor(now / 60000) * 60000));
  const now = useClock((t) => Math.floor(t / 60000) * 60000);
  const cats = catsOf?.(task) ?? [];
  const categoryIds = Object.keys(task.categories ?? {}).filter((id) => task.categories[id]);

  const toggle = (kind) => (event) => {
    const el = event.currentTarget.closest(".rp-prop") ?? event.currentTarget;
    setOpen((current) => (current?.kind === kind ? null : { kind, el }));
  };
  const openBell = (side) => (el) => setOpen((current) => (current?.kind === "bell" && current.side === side ? null : { kind: "bell", side, el }));
  const close = () => setOpen(null);
  const pickerProps = open && { anchor: open.el, placement: "bottom-start", gap: 6, ignoreOutside: [open.el], returnFocus: open.el };

  // Completing here runs the list row's completion (its fall animation, then the change), so the
  // check shows the new state at once while the change is on its way.
  const [pendingDone, setPendingDone] = useState(null);
  useEffect(() => setPendingDone(null), [task.id, task.done]);
  const shownDone = pendingDone ?? !!task.done;
  const setDone = () => {
    const done = !shownDone;
    if (complete) { setPendingDone(done); complete(task, done); return; }
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
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    toggle(kind)(event);
  };
  const isOpen = (kind) => open?.kind === kind || (kind === "due" && open?.kind === "addStart");
  const row = (kind, tip, cls) => ({
    role: "button",
    tabIndex: 0,
    className: `rp-prop click ${cls}` + (isOpen(kind) ? " open" : ""),
    "data-tip": tip,
    "aria-haspopup": "dialog",
    "aria-expanded": isOpen(kind),
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
          className={"ck" + (shownDone ? " done" : "")}
          role="checkbox"
          aria-checked={shownDone}
          aria-label={shownDone ? "완료 취소" : "할 일 완료"}
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
        {start !== null ? (
          <>
            <div {...row("start", "시작 정하기", "first")} aria-label={`시작: ${startDetailText(start, tf)}`}>
              <span className="k">시작</span>
              <span className="v">{startDetailText(start, tf)}</span>
              <AlertBell alert={alertOf("start")} open={open?.kind === "bell" && open.side === "start"} onOpen={openBell("start")} />
            </div>
            <div {...row("end", "끝 정하기", "mid")} aria-label={`끝: ${dueDetailText(due, tf)}`}>
              <span className="k">끝</span>
              <span className={"v" + (over ? " over" : "")}>{dueDetailText(due, tf)}</span>
              <AlertBell alert={alertOf("end")} open={open?.kind === "bell" && open.side === "end"} onOpen={openBell("end")} />
            </div>
            <ProgressRow task={task} />
          </>
        ) : (
          <div {...row("due", "기한 정하기", "first")} aria-label={`기한: ${due === null ? "없음" : dueDetailText(due, tf)}`}>
            <span className="k">기한</span>
            <span className={"v" + (over ? " over" : "")}>{due === null ? <span className="sub">없음</span> : dueDetailText(due, tf)}</span>
            {due !== null && (
              <button
                type="button"
                className="rp-addst"
                data-tip="시작을 정해 기간으로"
                onClick={(event) => { event.stopPropagation(); toggle("addStart")(event); }}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <PlusIcon size={12} />시작
              </button>
            )}
            {due !== null && <AlertBell alert={alertOf("end")} open={open?.kind === "bell" && open.side === "end"} onOpen={openBell("end")} />}
          </div>
        )}
        <div {...row("repeat", "반복 정하기", "mid")} aria-label={`반복: ${periodRepeatName(repeat, task, anchorAt)}`}>
          <span className="k">반복</span>
          <span className="v">{repeat ? periodRepeatName(repeat, task, anchorAt) : <span className="sub">안 함</span>}</span>
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

      {/* The subtask order syncs only on the E2EE path, like the star. */}
      <SubtaskList task={task} canSort={canStar} />

      <div className="rp-block-h">메모</div>
      <MemoField task={task} />

      {created && (
        <div className="rp-stamp">만든 날 {created}{updated ? ` · 마지막 수정 ${updated}` : ""}</div>
      )}

      {["due", "start", "end", "addStart"].includes(open?.kind) && (
        <DatePicker
          {...pickerProps}
          value={due}
          start={start}
          focus={open.kind === "start" ? "start" : open.kind === "addStart" ? "addStart" : "end"}
          timeFormat={tf}
          weekStart={prefs?.weekStart}
          onChange={(ms, from) => {
            if (from === undefined) actions.setDue(task.id, ms);
            else actions.setPeriod(task.id, ms, from);
            close();
          }}
          onCancel={close}
        />
      )}
      {open?.kind === "bell" && alertOf(open.side) && (
        <AlertPopover
          alert={alertOf(open.side)}
          anchor={open.el}
          timeFormat={tf}
          onSet={(value) => actions.setAlert?.(task.id, open.side, value)}
          onClose={close}
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
