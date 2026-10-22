import { useRef, useState } from "react";
import { repeatOptions } from "utils/repeatRule";
import { dueMs, formatClock } from "utils/timeDisplay";
import { useTimeFormat } from "utils/timeFormat";
import { CloseIcon } from "./icons";
import { moveFocus } from "./focusNav";
import Popover from "./Popover";

// 반복 (#102 mock repeatPicker). One choice: 안 함 / 매일 / 매주 X요일 / 매월 N일 / 매년 M월 N일,
// each with the date it comes next. Choosing calls onSelect(period | null) and then onClose().
// base: the task's due date (or the quick-add draft's; ms or Date, 0/null for none); without it
// the note says today's end of day becomes the due date, which the caller sets before the repeat
// (the data model needs a due).
// repeatStartAt: the current rule's anchor, for the current period's next date.
export default function RepeatPicker({
  value = null, base = null, repeatStartAt = null, now, timeFormat, onSelect, onClose,
  anchor, placement = "bottom-start", offset, gap, returnFocus, ignoreOutside,
}) {
  const prefTf = useTimeFormat();
  const tf = timeFormat === "24" || timeFormat === "12" ? timeFormat : prefTf;
  const [at] = useState(() => now ?? Date.now());
  const listRef = useRef(null);
  const options = repeatOptions({ base, value, repeatStartAt, now: at });
  const checked = options.find((o) => o.on) || options[0];
  const firstRef = useRef(null);
  const choose = (period) => { onSelect?.(period); onClose?.(); };
  const end = formatClock(new Date(2000, 0, 1, 23, 59), tf);

  return (
    <Popover
      anchor={anchor}
      placement={placement}
      offset={offset}
      gap={gap}
      returnFocus={returnFocus}
      ignoreOutside={ignoreOutside}
      className="pk"
      label="반복"
      initialFocus={firstRef}
      onClose={() => onClose?.()}
    >
      <div className="dp-h">
        <span>반복</span>
        <button type="button" className="dp-x" aria-label="닫기" data-tip="닫기" onClick={() => onClose?.()}><CloseIcon /></button>
      </div>
      <div role="radiogroup" aria-label="반복" ref={listRef} onKeyDown={(e) => moveFocus(e, listRef.current, ".pk-row")}>
        {options.map((o) => (
          <button
            key={o.period || "none"}
            ref={o === checked ? firstRef : undefined}
            type="button"
            role="radio"
            aria-checked={o.on}
            className={`pk-row${o.on ? " on" : ""}`}
            onClick={() => choose(o.period)}
          >
            <span className="pk-rd" />
            <span className="pk-tx">
              <span className="pk-nm">{o.name}</span>
              <small>{o.sub}</small>
            </span>
          </button>
        ))}
      </div>
      {dueMs(base) === null && <p className="dp-note">기한이 없으면 오늘 {end}{tf === "24" ? "이" : "가"}<br />기한이 돼요.</p>}
    </Popover>
  );
}
