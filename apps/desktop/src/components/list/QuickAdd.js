import "./QuickAdd.scss";
import { useEffect, useMemo, useRef, useState } from "react";
import Task from "objects/Task";
import { CategoryPicker, DatePicker, RepeatPicker, openPopupCount } from "molecules/pickers";
import { CalendarIcon, CloseIcon, PlusIcon, RepeatIcon, ShieldIcon, StarIcon } from "molecules/pickers/icons";
import { categoryColor } from "utils/categoryColors";
import { TODO_MENU_TYPE } from "utils/menuFilters";
import { periodChipText } from "utils/periodDisplay";
import { endOfDay, normalRepeat, repeatName } from "utils/repeatRule";
import { periodOffset } from "utils/taskPeriod";
import { dueMs, formatDueChip } from "utils/timeDisplay";
import { useTimeFormat } from "utils/timeFormat";

// What the chips start with, from the screen (#102): 오늘 and 다음 7일 → today; calendar /
// timeline → the picked day (`day`); a category screen → that category (a secret one only while
// unlocked); 중요 → starred, unless the star cannot be stored yet (canStar false: no sync
// status yet). A day means its end (no time). No period to start with (start, #109).
export function quickAddDefaults({ menuType, category, secretUnlocked = false, day = null, now = Date.now(), canStar = true } = {}) {
  const picked = day !== null && day !== undefined ? endOfDay(day) : null;
  const own = category && category.default === false && category.id != null && (!category.secret || secretUnlocked);
  const todayMenu = menuType === TODO_MENU_TYPE.TODAY || menuType === TODO_MENU_TYPE.NEXT_7_DAYS;
  return {
    due: picked ?? (todayMenu ? endOfDay(now) : null),
    start: null,
    repeat: null,
    categoryIds: own ? [category.id] : [],
    important: canStar && menuType === TODO_MENU_TYPE.IMPORTANT,
  };
}

// The new task. Everything goes in the one addTask entity (task/addTask takes the due, the repeat
// with its anchor, the period's start (#109), the categories and the star together); a repeat
// and a start need a due.
export function buildQuickTask(title, draft) {
  const due = dueMs(draft.due);
  const task = new Task(title, due === null ? null : new Date(due));
  const start = due === null ? null : dueMs(draft.start);
  // A start not before the end cannot be a period: the end stays and the start is left out.
  const offset = start === null || start >= due ? 0 : periodOffset(start, due);
  task.startOffset = offset;
  task.startDate = offset ? due - offset : null;
  task.repeatPeriod = due === null ? null : normalRepeat(draft.repeat);
  for (const cid of draft.categoryIds ?? []) task.categories[cid] = true;
  task.important = !!draft.important;
  return task;
}

const composing = (event) => event.nativeEvent?.isComposing || event.keyCode === 229;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// New defaults on the same screen: each chip still at the old default takes the new one; chips
// the user changed stay (another picked day moves only an untouched date). The date chip is the
// due and the start together (#109): a period the user picked never follows by its end alone.
const followDefaults = (draft, was, next) => {
  const out = { ...draft };
  for (const key of Object.keys(next)) if (same(draft[key], was?.[key])) out[key] = next[key];
  if (!same(draft.due ?? null, was?.due ?? null) || !same(draft.start ?? null, was?.start ?? null)) {
    out.due = draft.due;
    out.start = draft.start;
  }
  return out;
};
// The bar's state { title, draft, base (the defaults the draft follows), screenKey } brought up to
// the screen and defaults it is drawn with: a new screen starts the chips over (the title stays),
// new defaults move only the chips still at the old ones.
const reconcile = (state, screenKey, defaults) => {
  if (!state) return { title: "", draft: defaults, base: defaults, screenKey };
  if (state.screenKey !== screenKey) return { ...state, draft: defaults, base: defaults, screenKey };
  if (!same(state.base, defaults)) return { ...state, draft: followDefaults(state.draft, state.base, defaults), base: defaults };
  return state;
};

// The quick-add bar at the bottom of a view (#102 mock quickAdd): "+", the title field (Enter
// adds; Ctrl+N focuses it) and the chips 날짜 / 반복 / 카테고리 / 중요, whose pickers open above
// the bar. The title is taken as typed (no dates read from it); a period picked in the date
// picker shows as one chip, "11/20 ~ 11/23" (#109). A set date or category chip has a × on hover that takes it out (the date also over
// the screen's default). After adding, the chips go back to `defaults` (see quickAddDefaults).
// contextKey: the screen (menu, category); a new one starts the chips over. When only the
// defaults move (today's date at midnight, another picked day), untouched chips follow them and
// changed ones stay.
// Without it every change of `defaults` starts over.
// store: [state, setState] kept by the screen, so the list, calendar and timeline bars share what
// was typed and chosen (#107); each view's defaults still move the untouched chips. Without it the
// bar keeps its own.
// categories: the ones that can be chosen [{ id, title, color, secret }];
// onAdd(task); onCreateCategory(name, color) → Promise<id> (the picker's 새 카테고리).
// canStar false hides 중요 (the star would be dropped).
export default function QuickAdd({ defaults, contextKey, categories = [], onAdd, onCreateCategory, timeFormat, canStar = true, store }) {
  const prefTf = useTimeFormat();
  const tf = timeFormat === "24" || timeFormat === "12" ? timeFormat : prefTf;
  const own = useState(null);
  const [stored, setStored] = store ?? own;
  const [open, setOpen] = useState(null); // { kind: "date" | "repeat" | "cat", el }
  const barRef = useRef(null);
  const inputRef = useRef(null);
  const screenKey = contextKey ?? JSON.stringify(defaults);
  // Drawn with the state brought up to this screen and its defaults; the store follows.
  const state = reconcile(stored, screenKey, defaults);
  useEffect(() => {
    if (state !== stored) setStored(state);
  });
  const { title, draft } = state;
  const update = (change) => setStored((s) => change(reconcile(s, screenKey, defaults)));
  const setTitle = (text) => update((s) => ({ ...s, title: text }));
  const setDraft = (next) => update((s) => ({ ...s, draft: typeof next === "function" ? next(s.draft) : next }));

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
  const start = due === null ? null : dueMs(draft.start);
  const repeat = due === null ? null : normalRepeat(draft.repeat);
  const dateText = due === null ? "" : start !== null ? periodChipText(start, due, tf) : formatDueChip(due, tf);

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
    // Where the chip sits in the bar: choosing a category re-renders the chips and can replace
    // this one, and a detached chip measures as 0, which threw the picker to the left edge (#106).
    // Measured without the press scale (.qa-chip:active, still easing back on click): its
    // centre with the layout width. The scaled left put the picker 1px off after the first
    // pick, which detaches the plain 카테고리 chip (#107).
    const bar = barRef.current?.getBoundingClientRect(), at = box.getBoundingClientRect();
    const width = box.offsetWidth || at.width, left = (at.left + at.right) / 2 - width / 2;
    const dx = bar ? left - bar.left : 0;
    setOpen((current) => (current?.kind === kind && current.el === el ? null : { kind, el, box, dx, width }));
  };
  const close = () => setOpen(null);
  // ×: the date chip goes to no date (and no repeat, which needs one); a category chip leaves.
  const clearDue = () => {
    close();
    setDraft((d) => ({ ...d, due: null, start: null, repeat: null }));
    inputRef.current?.focus();
  };
  const dropCategory = (id) => {
    close();
    setDraft((d) => ({ ...d, categoryIds: (d.categoryIds ?? []).filter((x) => x !== id) }));
    inputRef.current?.focus();
  };
  // Above the bar (mock: bottom = the bar's top + 8): the date picker at the bar's left edge, the
  // repeat and category pickers at their chip.
  // The chip is measured like in toggle (centre and layout width), so the picker sits in the same
  // place while the chip is still easing back from its press and after a pick replaces it (#107:
  // it moved 2px left on the first pick or unpick).
  const anchor = open && {
    getBoundingClientRect() {
      const rect = open.box.isConnected ? open.box.getBoundingClientRect() : null;
      const liveWidth = rect && (open.box.offsetWidth || rect.width);
      const live = rect && { left: (rect.left + rect.right) / 2 - liveWidth / 2, width: liveWidth, top: rect.top };
      const bar = barRef.current?.getBoundingClientRect() ?? live;
      const width = live?.width ?? open.width;
      const left = open.kind === "date" ? bar.left : live ? live.left : bar.left + open.dx;
      return { left, right: left + width, top: bar.top, bottom: bar.top, width, height: 0 };
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
            <button type="button" className="qa-hit" aria-label={`${start !== null ? "기간" : "기한"} ${dateText}`} onClick={toggle("date")}>
              <CalendarIcon /><span>{dateText}</span>
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
          start={start}
          timeFormat={tf}
          onChange={(ms, from) => { setDraft((d) => ({ ...d, due: ms, start: from ?? null })); close(); }}
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
