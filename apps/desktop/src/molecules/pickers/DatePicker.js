import { useId, useRef, useState } from "react";
import { quickDays } from "utils/dateGroups";
import { dueMs, formatClock, formatMinuteOfDay, hasDueTime } from "utils/timeDisplay";
import { useTimeFormat, useWeekStart } from "utils/timeFormat";
import { CloseIcon } from "./icons";
import MiniMonth from "./MiniMonth";
import Popover from "./Popover";

const WEEKDAYS = "일월화수목금토";
export const END_OF_DAY = 1439; // minutes; a due at 23:59 means "no time"
const PRESETS = [540, 720, 1080, 1260];
const pad = (n) => String(n).padStart(2, "0");
const midnight = (value) => { const d = new Date(value); d.setHours(0, 0, 0, 0); return d; };
const sameDay = (a, b) => midnight(a).getTime() === midnight(b).getTime();

// Opening state: a due with a set time opens with the time switch on at that time; a due at the
// end of the day, or no due (then initialDay, else today), opens with it off at 23:59.
export function datePickerStart(value, initialDay, now = Date.now()) {
  const due = dueMs(value);
  if (due !== null) {
    const d = new Date(due), on = hasDueTime(due);
    return { day: midnight(d), on, minutes: on ? d.getHours() * 60 + d.getMinutes() : END_OF_DAY };
  }
  return { day: midnight(initialDay ?? now), on: false, minutes: END_OF_DAY };
}

// The due timestamp for a day and a time; no time (or 하루 끝) is stored as 23:59:59 like before.
export function composeDue(day, on, minutes) {
  const d = midnight(day);
  const m = on ? minutes : END_OF_DAY;
  if (m === END_OF_DAY) d.setHours(23, 59, 59, 0);
  else d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return d.getTime();
}

// A two-digit number field that accepts typing (the mock's .num box).
// Typing replaces the value digit by digit; a digit that cannot start a valid two-digit value
// completes the field (onFilled moves on). Arrow keys step with wrap-around. Leaving the field
// shows the current value again.
function NumberField({ value, min, max, padded, label, onChange, onFilled, inputRef }) {
  const [text, setText] = useState(null);
  const shown = text ?? (padded ? pad(value) : String(value));
  const commit = (n) => { if (n >= min && n <= max) onChange(n); };
  const onInput = (event) => {
    let digits = event.target.value.replace(/\D/g, "");
    if (digits.length > 2) digits = digits.slice(-1); // typing past two digits starts over
    if (!digits) { setText(""); return; }
    if (digits.length === 2 && +digits > max) digits = digits.slice(-1);
    setText(digits);
    commit(+digits);
    if (digits.length === 2 || +digits * 10 > max) onFilled?.();
  };
  const onKeyDown = (event) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = value + (event.key === "ArrowUp" ? 1 : -1);
      setText(null);
      onChange(next > max ? min : next < min ? max : next);
    } else if (event.key === "Enter") {
      setText(null);
    }
  };
  return (
    <input
      ref={inputRef}
      className="dp-num"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={label}
      value={shown}
      onChange={onInput}
      onKeyDown={onKeyDown}
      onFocus={(event) => event.target.select()}
      onBlur={() => setText(null)}
    />
  );
}

// 기한 정하기 (#102 mock duePicker). Controlled by its caller: it shows while rendered, calls
// onChange(dueMs) on 정하기 and onCancel() on ×, 취소, Esc or a press outside. 정하기 with the
// day and time as they opened gives the original value back (as ms), so an old "no time" due
// stored at 23:59:59.999 stays equal and a repeating task keeps its anchor.
// value: the due timestamp or null; initialDay: the day to start on when there is none (e.g. the
// picked calendar day). timeFormat ("12" | "24") and weekStart (0 | 1) default to the prefs.
// anchor/placement/offset/gap: see Popover.
export default function DatePicker({
  value = null, initialDay, now, timeFormat, weekStart, onChange, onCancel,
  anchor, placement = "bottom-start", offset, gap, returnFocus, ignoreOutside,
}) {
  const prefTf = useTimeFormat(), prefWs = useWeekStart();
  const tf = timeFormat === "24" || timeFormat === "12" ? timeFormat : prefTf;
  const ws = weekStart === 0 || weekStart === 1 ? weekStart : prefWs;
  const [today] = useState(() => (now ?? Date.now()));
  const [start] = useState(() => datePickerStart(value, initialDay, today));
  const [day, setDay] = useState(start.day);
  const [on, setOn] = useState(start.on);
  const [minutes, setMinutes] = useState(start.minutes);
  const [view, setView] = useState({ year: start.day.getFullYear(), month: start.day.getMonth() });
  const minuteRef = useRef(null);
  const timeLabel = useId();

  const apply = () => {
    const original = dueMs(value);
    const same = original !== null && sameDay(day, start.day) && on === start.on && minutes === start.minutes;
    onChange?.(same ? original : composeDue(day, on, minutes));
  };

  const pick = (date) => {
    const d = midnight(date);
    setDay(d);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  };
  const moveMonth = (delta) => setView((v) => {
    const d = new Date(v.year, v.month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const toggleTime = () => {
    // Turning the time on starts at 23:59 (the end of the day it already meant).
    if (!on) setMinutes(END_OF_DAY);
    setOn(!on);
  };

  const h = Math.floor(minutes / 60), m = minutes % 60, pm = h >= 12, h12 = h % 12 || 12;
  const setHour = (hour) => setMinutes((tf === "24" ? hour : (hour % 12) + (pm ? 12 : 0)) * 60 + m);
  const setMinute = (minute) => setMinutes(h * 60 + minute);
  const setHalf = (toPm) => { if (toPm !== pm) setMinutes(minutes + (toPm ? 720 : -720)); };

  const clockOf = (mins) => formatClock(new Date(2000, 0, 1, Math.floor(mins / 60), mins % 60), tf);
  const summary = `${day.getMonth() + 1}월 ${day.getDate()}일 (${WEEKDAYS[day.getDay()]})${on ? ` ${clockOf(minutes)}` : " · 하루 끝까지"}`;
  const quick = quickDays(today, ws);
  const presets = [...PRESETS.map((v) => [v, formatMinuteOfDay(v, tf)]), [END_OF_DAY, "하루 끝"]];

  return (
    <Popover
      anchor={anchor}
      placement={placement}
      offset={offset}
      gap={gap}
      returnFocus={returnFocus}
      ignoreOutside={ignoreOutside}
      className="dp"
      label="기한 정하기"
      onClose={() => onCancel?.()}
    >
      <div className="dp-h">
        <span>기한 정하기</span>
        <button type="button" className="dp-x" aria-label="닫기" data-tip="닫기" onClick={() => onCancel?.()}><CloseIcon /></button>
      </div>
      <div className="dp-quick">
        {quick.map((q) => (
          <button key={q.id} type="button" className={`dp-chip${sameDay(q.date, day) ? " on" : ""}`} aria-pressed={sameDay(q.date, day)} data-tip={q.tip} onClick={() => pick(q.date)}>
            {q.label}
          </button>
        ))}
      </div>
      <MiniMonth
        className="dp-cal"
        year={view.year}
        month={view.month}
        picked={day}
        today={today}
        weekStart={ws}
        onPick={pick}
        onMonth={moveMonth}
      />
      <div className="dp-time">
        <div className="dp-row">
          <span id={timeLabel}>시간</span>
          <button type="button" role="switch" aria-checked={on} aria-labelledby={timeLabel} className={`dp-sw${on ? " on" : ""}`} data-tip="시간 정하기" onClick={toggleTime}><i /></button>
        </div>
        {on ? (
          <>
            <div className="dp-field">
              {tf !== "24" && (
                <span className="dp-seg" role="group" aria-label="오전 또는 오후">
                  <button type="button" className={pm ? "" : "on"} aria-pressed={!pm} onClick={() => setHalf(false)}>오전</button>
                  <button type="button" className={pm ? "on" : ""} aria-pressed={pm} onClick={() => setHalf(true)}>오후</button>
                </span>
              )}
              {tf === "24"
                ? <NumberField value={h} min={0} max={23} padded label="시" onChange={setHour} onFilled={() => minuteRef.current?.focus()} />
                : <NumberField value={h12} min={1} max={12} label="시" onChange={setHour} onFilled={() => minuteRef.current?.focus()} />}
              <span className="dp-colon">:</span>
              <NumberField value={m} min={0} max={59} padded label="분" onChange={setMinute} inputRef={minuteRef} />
            </div>
            <div className="dp-quick">
              {presets.map(([v, l]) => (
                <button key={v} type="button" className={`dp-chip${minutes === v ? " on" : ""}`} aria-pressed={minutes === v} onClick={() => setMinutes(v)}>{l}</button>
              ))}
            </div>
          </>
        ) : (
          <p className="dp-note">시간 없이 그날 끝({clockOf(END_OF_DAY)})까지예요.<br />켜면 시각을 바꿀 수 있어요.</p>
        )}
      </div>
      <div className="dp-foot">
        <span className="dp-sum" aria-live="polite">{summary}</span>
        <button type="button" className="dp-btn" onClick={() => onCancel?.()}>취소</button>
        <button type="button" className="dp-btn pri" onClick={apply}>정하기</button>
      </div>
    </Popover>
  );
}
