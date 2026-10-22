import "./QuickAdd.scss";
import { useEffect, useMemo, useRef, useState } from "react";
import Task from "objects/Task";
import { CategoryPicker, DatePicker, RepeatPicker, openPopupCount } from "molecules/pickers";
import { CalendarIcon, CloseIcon, PlusIcon, RepeatIcon, ShieldIcon, StarIcon } from "molecules/pickers/icons";
import { categoryColor } from "utils/categoryColors";
import { TODO_MENU_TYPE } from "utils/menuFilters";
import { endOfDay, normalRepeat, repeatName } from "utils/repeatRule";
import { dueMs, formatDueChip } from "utils/timeDisplay";
import { useTimeFormat } from "utils/timeFormat";

// What the chips start with, from the screen (#102): 오늘 and 다음 7일 → today; calendar /
// timeline → the picked day (`day`); a category screen → that category (a secret one only while
// unlocked); 중요 → starred, unless the star cannot be stored (canStar false: the plaintext sync
// and legacy paths drop it). A day means its end (no time).
export function quickAddDefaults({ menuType, category, secretUnlocked = false, day = null, now = Date.now(), canStar = true } = {}) {
  const picked = day !== null && day !== undefined ? endOfDay(day) : null;
  const own = category && category.default === false && category.id != null && (!category.secret || secretUnlocked);
  const todayMenu = menuType === TODO_MENU_TYPE.TODAY || menuType === TODO_MENU_TYPE.NEXT_7_DAYS;
  return {
    due: picked ?? (todayMenu ? endOfDay(now) : null),
    repeat: null,
    categoryIds: own ? [category.id] : [],
    important: canStar && menuType === TODO_MENU_TYPE.IMPORTANT,
  };
}

// The new task. Everything goes in the one addTask entity (task/addTask takes the due, the repeat
// with its anchor, the categories and the star together); a repeat needs a due.
export function buildQuickTask(title, draft) {
  const due = dueMs(draft.due);
  const task = new Task(title, due === null ? null : new Date(due));
  task.repeatPeriod = due === null ? null : normalRepeat(draft.repeat);
  for (const cid of draft.categoryIds ?? []) task.categories[cid] = true;
  task.important = !!draft.important;
  return task;
}

const composing = (event) => event.nativeEvent?.isComposing || event.keyCode === 229;

const sameDraft = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The quick-add bar at the bottom of a view (#102 mock quickAdd): "+", the title field (Enter
// adds; Ctrl+N focuses it) and the chips 날짜 / 반복 / 카테고리 / 중요, whose pickers open above
// the bar. A set date or category chip has a × on hover that takes it out (the date also over
// the screen's default). After adding, the chips go back to `defaults` (see quickAddDefaults).
// contextKey: the screen (menu, category, picked day); a new one starts the chips over. When only
// the defaults move (today's date at midnight), untouched chips follow them and changed ones stay.
// Without it every change of `defaults` starts over.
// categories: the ones that can be chosen [{ id, title, color, secret }];
// onAdd(task); onCreateCategory(name, color) → Promise<id> (the picker's 새 카테고리).
// canStar false hides 중요 (the star would be dropped).
export default function QuickAdd({ defaults, contextKey, categories = [], onAdd, onCreateCategory, timeFormat, canStar = true }) {
  const prefTf = useTimeFormat();
  const tf = timeFormat === "24" || timeFormat === "12" ? timeFormat : prefTf;
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState(defaults);
  const [open, setOpen] = useState(null); // { kind: "date" | "repeat" | "cat", el }
  const barRef = useRef(null);
  const inputRef = useRef(null);
  const defaultsKey = JSON.stringify(defaults);
  const screenKey = contextKey ?? defaultsKey;
  const seen = useRef({ screenKey, defaults });

  // A new screen starts the chips over; new defaults on the same screen replace only untouched chips.
  useEffect(() => {
    const was = seen.current;
    seen.current = { screenKey, defaults };
    if (was.screenKey !== screenKey) setDraft(defaults);
    else setDraft((d) => (sameDraft(d, was.defaults) ? defaults : d));
    // defaultsKey stands for defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsKey, screenKey]);

  useEffect(() => {
    const onKey = (event) => {
      // By the key's place, so it works with the Korean layout too (key "ㅜ").
      const isN = event.code === "KeyN" || String(event.key).toLowerCase() === "n";
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || !isN) return;
      if (event.defaultPrevented || openPopupCount() > 0) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const byId = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const chosen = (draft.categoryIds ?? []).map((id) => byId[id]).filter(Boolean);
  const due = dueMs(draft.due);
  const repeat = due === null ? null : normalRepeat(draft.repeat);

  const add = () => {
    const text = title.trim();
    if (!text) return;
    onAdd?.(buildQuickTask(text, { ...draft, important: canStar && draft.important, categoryIds: chosen.map((c) => c.id) }));
    setTitle("");
    setDraft(defaults);
  };

  // el: the chip's button (focus returns to it); box: the chip as drawn (with its ×).
  const toggle = (kind) => (event) => {
    const el = event.currentTarget;
    const box = el.closest(".qa-chip") ?? el;
    setOpen((current) => (current?.kind === kind && current.el === el ? null : { kind, el, box }));
  };
  const close = () => setOpen(null);
  // ×: the date chip goes to no date (and no repeat, which needs one); a category chip leaves.
  const clearDue = () => {
    close();
    setDraft((d) => ({ ...d, due: null, repeat: null }));
    inputRef.current?.focus();
  };
  const dropCategory = (id) => {
    close();
    setDraft((d) => ({ ...d, categoryIds: (d.categoryIds ?? []).filter((x) => x !== id) }));
    inputRef.current?.focus();
  };
  // Above the bar (mock: bottom = the bar's top + 8): the date picker at the bar's left edge, the
  // repeat and category pickers at their chip.
  const anchor = open && {
    getBoundingClientRect() {
      const chip = open.box.getBoundingClientRect(), bar = barRef.current?.getBoundingClientRect() ?? chip;
      const left = open.kind === "date" ? bar.left : chip.left;
      return { left, right: left + chip.width, top: bar.top, bottom: bar.top, width: chip.width, height: 0 };
    },
  };
  const pickerProps = open && { anchor, placement: "top-start", gap: 8, ignoreOutside: [open.box], returnFocus: open.el };

  const chip = (on) => "qa-chip" + (on ? " on" : "");
  return (
    <div className="tc-quick" ref={barRef}>
      <div className="qa-in">
        <button type="button" className="qa-plus" aria-label="할 일 추가" data-tip="할 일 추가" onClick={() => (title.trim() ? add() : inputRef.current?.focus())}>
          <PlusIcon />
        </button>
        <input
          ref={inputRef}
          type="text"
          aria-label="새 할 일"
          placeholder="할 일 추가"
          value={title}
          maxLength={500}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || composing(e)) return;
            e.preventDefault();
            add();
          }}
        />
        <kbd>Ctrl N</kbd>
      </div>
      <div className="qa-chips">
        {due !== null ? (
          <span className="qa-chip on has-x">
            <button type="button" className="qa-hit" aria-label={`기한 ${formatDueChip(due, tf)}`} onClick={toggle("date")}>
              <CalendarIcon /><span>{formatDueChip(due, tf)}</span>
            </button>
            <button type="button" className="qa-x" aria-label="날짜 빼기" data-tip="날짜 빼기" onClick={clearDue}><CloseIcon /></button>
          </span>
        ) : (
          <button type="button" className={chip(false)} aria-label="기한 정하기" onClick={toggle("date")}>
            <CalendarIcon /><span>날짜</span>
          </button>
        )}
        <button type="button" className={chip(!!repeat)} aria-label={repeat ? `반복 ${repeatName(repeat, due)}` : "반복 정하기"} onClick={toggle("repeat")}>
          <RepeatIcon /><span>{repeat ? repeatName(repeat, due) : "반복"}</span>
        </button>
        {chosen.length ? chosen.map((c) => (
          <span key={c.id} className="qa-chip on has-x">
            <button type="button" className="qa-hit" aria-label={`카테고리 ${c.title}`} onClick={toggle("cat")}>
              {c.secret
                ? <span className="qa-shield" style={{ color: categoryColor(c) }}><ShieldIcon size={12} /></span>
                : <span className="qa-dot" style={{ background: categoryColor(c) }} />}
              <span className="qa-lb">{c.title}</span>
            </button>
            <button type="button" className="qa-x" aria-label={`카테고리 빼기: ${c.title}`} data-tip="카테고리 빼기" onClick={() => dropCategory(c.id)}><CloseIcon /></button>
          </span>
        )) : (
          <button type="button" className={chip(false)} aria-label="카테고리 고르기" onClick={toggle("cat")}>
            <span className="qa-dot" style={{ background: "var(--muted)" }} /><span>카테고리</span>
          </button>
        )}
        {canStar && (
          <button type="button" className={chip(!!draft.important)} aria-pressed={!!draft.important} aria-label="중요" onClick={() => setDraft((d) => ({ ...d, important: !d.important }))}>
            <StarIcon filled={!!draft.important} size={13} /><span>중요</span>
          </button>
        )}
      </div>
      {open?.kind === "date" && (
        <DatePicker
          {...pickerProps}
          value={due}
          timeFormat={tf}
          onChange={(ms) => { setDraft((d) => ({ ...d, due: ms })); close(); }}
          onCancel={close}
        />
      )}
      {open?.kind === "repeat" && (
        <RepeatPicker
          {...pickerProps}
          value={repeat}
          base={due}
          timeFormat={tf}
          // A repeat needs a due: without a date, today's end of day becomes it.
          onSelect={(period) => setDraft((d) => ({ ...d, repeat: period, due: period && dueMs(d.due) === null ? endOfDay(Date.now()) : d.due }))}
          onClose={close}
        />
      )}
      {open?.kind === "cat" && (
        <CategoryPicker
          {...pickerProps}
          categories={categories}
          selectedIds={chosen.map((c) => c.id)}
          onToggle={(id) => setDraft((d) => {
            const ids = d.categoryIds ?? [];
            return { ...d, categoryIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] };
          })}
          onCreate={onCreateCategory}
          onClose={close}
        />
      )}
    </div>
  );
}
