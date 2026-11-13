import { useEffect, useId, useRef, useState } from "react";
import { dayLabel, quickDays } from "utils/dateGroups";
import { hasStartTime } from "utils/taskPeriod";
import { dueMs, formatClock, formatMinuteOfDay, hasDueTime } from "utils/timeDisplay";
import { useTimeFormat, useWeekStart } from "utils/timeFormat";
import { CloseIcon, TickIcon } from "./icons";
import MiniMonth from "./MiniMonth";
import parseDue, { parsePeriod } from "./parseDue";
import Popover from "./Popover";

const WEEKDAYS = "일월화수목금토";
export const END_OF_DAY = 1439; // minutes; a due at 23:59 means "no time"
const PRESETS = [540, 720, 1080, 1260];
const START_PRESETS = [540, 720, 840, 1080];
const START_ON = 540; // the start's time switch turns on at 오전 9시
const BAD_DELAY = 700; // ms of no typing before "not understood" shows
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

// The start field (#109) as it opens: null without a start; a start without a time is 00:00.
export function startFieldOf(start) {
  const ms = dueMs(start);
  if (ms === null) return null;
  const d = new Date(ms), on = hasStartTime(ms);
  return { day: midnight(d), on, minutes: on ? d.getHours() * 60 + d.getMinutes() : 0 };
}

// The start timestamp for a day and a time; no time is 00:00 (하루 시작).
export function composeStart(day, on, minutes) {
  const d = midnight(day);
  if (on) d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

const sameField = (a, b) => !!a && !!b && sameDay(a.day, b.day) && a.on === b.on && a.minutes === b.minutes;
const monthOf = (day) => ({ year: day.getFullYear(), month: day.getMonth() });

// 기한 · 기간 정하기 (#102 mock duePicker, #109 period mock pickerHtml). Controlled by its caller:
// it shows while rendered, calls onChange on 정하기 and onCancel() on ×, 취소, Esc or a press
// outside. On top are the 시작 and 끝 fields; the active one takes the quick days, the calendar,
// the text field and the time block. A task without a start opens with the start empty (없음)
// and 끝 active; focus "start" opens on the start, "addStart" on the empty start (the detail's
// + 시작). Choosing a start day in the calendar moves on to 끝. 정하기 is off while the start is
// not before the end.
// onChange(due) without a period, onChange(due, start) when the task had one or has one now
// (start null: the period was taken out). 정하기 with a side as it opened gives that side's
// original value back (as ms), so an old "no time" due stored at 23:59:59.999 stays equal and a
// repeating task keeps its anchor.
// value: the due timestamp or null; start: the period's start or null; initialDay: the day to
// start on when there is no due (e.g. the picked calendar day). timeFormat ("12" | "24") and
// weekStart (0 | 1) default to the prefs. anchor/placement/offset/gap: see Popover.
// The text field next to 오늘 · 내일 (#106.7) picks as it is typed: a period ("11/20~23",
// parsePeriod) sets both fields, a date (parseDue) the active one. Picking a chip or a calendar
// day clears it.
export default function DatePicker({
  value = null, start: startValue = null, focus = "end", initialDay, now, timeFormat, weekStart, onChange, onCancel,
  anchor, placement = "bottom-start", offset, gap, returnFocus, ignoreOutside,
}) {
  const prefTf = useTimeFormat(), prefWs = useWeekStart();
  const tf = timeFormat === "24" || timeFormat === "12" ? timeFormat : prefTf;
  const ws = weekStart === 0 || weekStart === 1 ? weekStart : prefWs;
  const [today] = useState(() => (now ?? Date.now()));
  const [opened] = useState(() => {
    const end = datePickerStart(value, initialDay, today), start = dueMs(value) === null ? null : startFieldOf(startValue);
    const active = focus === "addStart" || (focus === "start" && start) ? "start" : "end";
    return { end, start: focus === "addStart" ? null : start, active };
  });
  const [end, setEnd] = useState(opened.end);
  const [start, setStart] = useState(opened.start);
  const [active, setActive] = useState(opened.active);
  const [view, setView] = useState(() => monthOf((opened.active === "start" && opened.start ? opened.start : opened.end).day));
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null); // null | false | { day, minutes } | { start, end }
  const [showBad, setShowBad] = useState(false);
  const badTimer = useRef(null);
  const beforeText = useRef(null); // the fields when typing began; the text applies to them
  const byKey = useRef(false);
  const minuteRef = useRef(null);
  const timeLabel = useId();

  useEffect(() => () => clearTimeout(badTimer.current), []);

  const period = !!start;
  const field = active === "start" ? start : end; // null while the empty start is active
  const startMs = start ? composeStart(start.day, start.on, start.minutes) : null;
  const endMs = composeDue(end.day, end.on, end.minutes);
  const bad = period && startMs >= endMs;

  const apply = () => {
    if (bad) return;
    const original = dueMs(value), originalStart = dueMs(startValue);
    const due = original !== null && sameField(end, opened.end) ? original : endMs;
    if (originalStart === null && !start) { onChange?.(due); return; }
    const from = start && originalStart !== null && sameField(start, opened.start) ? originalStart : startMs;
    onChange?.(due, from);
  };

  const show = (date) => setView(monthOf(midnight(date)));
  const clearText = () => {
    clearTimeout(badTimer.current);
    setText("");
    setParsed(null);
    setShowBad(false);
    beforeText.current = null;
  };
  // A day for the active field (an empty start is made); the other side moves along so the
  // start stays on or before the end. A start picked in the calendar hands over to 끝.
  const pick = (date, fromCalendar = false) => {
    clearText();
    const d = midnight(date);
    if (active === "start") {
      setStart(start ? { ...start, day: d } : { day: d, on: false, minutes: 0 });
      if (d > end.day) setEnd({ ...end, day: d });
      if (fromCalendar) setActive("end");
    } else {
      setEnd({ ...end, day: d });
      if (start && d < start.day) setStart({ ...start, day: d });
    }
    show(d);
  };
  // Choosing a field starts a new text for it: text typed for the other field must not
  // keep applying to that field (it would switch back to it on the next key).
  const choose = (k) => {
    if (k !== active) clearText();
    setActive(k);
    const f = k === "start" ? start : end;
    if (f) show(f.day);
  };
  const removeStart = () => {
    clearText();
    setStart(null);
    setActive("end");
    show(end.day);
  };

  const onText = (event) => {
    const next = event.target.value;
    const base = beforeText.current ?? { end, start, active };
    beforeText.current = base;
    setText(next);
    clearTimeout(badTimer.current);
    const at = now ?? Date.now();
    const p = parsePeriod(next, at, ws);
    if (p === null) {
      // An empty field goes back to how the fields were before typing.
      setParsed(null);
      setShowBad(false);
      setEnd(base.end);
      setStart(base.start);
      setActive(base.active);
      show((base.active === "start" && base.start ? base.start : base.end).day);
      beforeText.current = null;
      return;
    }
    if (p) {
      const s = { day: midnight(p.start), on: p.startMinutes !== null, minutes: p.startMinutes ?? 0 };
      const e = { day: midnight(p.end), on: p.endMinutes !== null, minutes: p.endMinutes ?? END_OF_DAY };
      setShowBad(false);
      setParsed({ start: s, end: e });
      setStart(s);
      setEnd(e);
      setActive("end");
      show(e.day);
      return;
    }
    const r = parseDue(next, at, ws);
    setParsed(r);
    if (r === false) {
      // The last pick stays; the hint waits for a pause so it does not flash while typing.
      if (!showBad) badTimer.current = setTimeout(() => setShowBad(true), BAD_DELAY);
      return;
    }
    setShowBad(false);
    // A text without a time keeps the time setting the field had.
    const side = base.active;
    const was = side === "start" ? base.start ?? { day: r.day, on: false, minutes: 0 } : base.end;
    const f = { day: midnight(r.day), on: r.minutes !== null ? true : was.on, minutes: r.minutes !== null ? r.minutes : was.minutes };
    if (side === "start") {
      setStart(f);
      setEnd(f.day > base.end.day ? { ...base.end, day: f.day } : base.end);
    } else {
      setEnd(f);
      setStart(base.start && f.day < base.start.day ? { ...base.start, day: f.day } : base.start);
    }
    setActive(side);
    show(f.day);
  };
  const onTextKey = (event) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (parsed !== false) apply();
    else { clearTimeout(badTimer.current); setShowBad(true); }
  };
  const moveMonth = (delta) => setView((v) => monthOf(new Date(v.year, v.month + delta, 1)));

  // The time of the active field.
  const setField = (patch) => (active === "start" ? setStart((f) => ({ ...f, ...patch })) : setEnd((f) => ({ ...f, ...patch })));
  const minutes = field?.minutes ?? 0, on = !!field?.on;
  const toggleTime = () => {
    // Turning the end's time on starts at 23:59 (the end of the day it already meant), the
    // start's at 오전 9시; off, the start is 00:00 again.
    if (active === "start") setField(on ? { on: false, minutes: 0 } : { on: true, minutes: START_ON });
    else setField(on ? { on: false } : { on: true, minutes: END_OF_DAY });
  };
  const setMinutes = (value) => setField({ minutes: value });
  const h = Math.floor(minutes / 60), m = minutes % 60, pm = h >= 12, h12 = h % 12 || 12;
  const setHour = (hour) => setMinutes((tf === "24" ? hour : (hour % 12) + (pm ? 12 : 0)) * 60 + m);
  const setMinute = (minute) => setMinutes(h * 60 + minute);
  const setHalf = (toPm) => { if (toPm !== pm) setMinutes(minutes + (toPm ? 720 : -720)); };

  const clockOf = (mins) => formatClock(new Date(2000, 0, 1, Math.floor(mins / 60), mins % 60), tf);
  const shortOf = (mins) => formatMinuteOfDay(mins, tf, true);
  const fieldDay = (f) => `${f.day.getMonth() + 1}/${f.day.getDate()} (${WEEKDAYS[f.day.getDay()]})${f.on ? ` ${shortOf(f.minutes)}` : ""}`;
  const summary = period
    ? `${fieldDay(start)} ~ ${sameDay(start.day, end.day) ? (end.on ? shortOf(end.minutes) : "하루 끝") : fieldDay(end)}`
    : `${dayLabel(end.day)}${end.on ? ` ${clockOf(end.minutes)}` : " · 하루 끝까지"}`;
  // 오늘 · 내일 only: the text field takes the place of the other quick days (#106.7).
  const quick = quickDays(today, ws).filter((q) => q.id === "today" || q.id === "tomorrow");
  const dayText = (d, mins, short) => `${dayLabel(d)}${mins !== null ? ` ${short ? shortOf(mins) : clockOf(mins)}` : ""}`;
  const fieldText = (f) => dayText(f.day, f.on ? f.minutes : null, true);
  const line = parsed === false && showBad
    ? <span>알아듣지 못했어요 · 예: 내일 3시, 11/20, 11/20~11/23</span>
    : parsed?.start ? <><TickIcon size={12} /><span>{fieldText(parsed.start)} ~ {fieldText(parsed.end)}</span></>
      : parsed ? <><TickIcon size={12} /><span>{dayText(parsed.day, parsed.minutes)}</span></>
        : parsed === false ? <span>{field ? dayText(field.day, field.on ? field.minutes : null) : ""}</span>
          : <span>날짜나 기간(~, 부터 · 까지)을 적으면 바로 골라져요</span>;
  const presets = active === "start"
    ? START_PRESETS.map((v) => [v, formatMinuteOfDay(v, tf)])
    : [...PRESETS.map((v) => [v, formatMinuteOfDay(v, tf)]), [END_OF_DAY, "하루 끝"]];
  const title = period ? "기간 정하기" : "기한 정하기";

  const fieldBox = (k) => {
    const f = k === "start" ? start : end, isOn = active === k, name = k === "start" ? "시작" : "끝";
    const keys = (event) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      choose(k);
    };
    if (!f) {
      return (
        <div role="button" tabIndex={0} className={"dp-fd empty" + (isOn ? " on" : "")} aria-pressed={isOn} aria-label="시작 없음" onClick={() => choose(k)} onKeyDown={keys}>
          <small>{name}</small><b>없음</b><span>{isOn ? "달력에서 골라요" : "눌러서 추가"}</span>
        </div>
      );
    }
    const time = f.on ? clockOf(f.minutes) : k === "start" ? "하루 시작" : "하루 끝";
    return (
      <div role="button" tabIndex={0} className={"dp-fd" + (isOn ? " on" : "")} aria-pressed={isOn} aria-label={`${name} ${dayLabel(f.day)} ${time}`} onClick={() => choose(k)} onKeyDown={keys}>
        <small>{name}</small><b>{dayLabel(f.day)}</b><span>{time}</span>
        {k === "start" && (
          <button type="button" className="fx" aria-label="시작 빼기" data-tip="시작 빼기" onClick={(event) => { event.stopPropagation(); removeStart(); }}>
            <CloseIcon size={12} />
          </button>
        )}
      </div>
    );
  };

  return (
    <Popover
      anchor={anchor}
      placement={placement}
      offset={offset}
      gap={gap}
      returnFocus={returnFocus}
      ignoreOutside={ignoreOutside}
      className="dp"
      label={title}
      onClose={() => onCancel?.()}
    >
      <div className="dp-h">
        <span>{title}</span>
        <button type="button" className="dp-x" aria-label="닫기" data-tip="닫기" onClick={() => onCancel?.()}><CloseIcon /></button>
      </div>
      <div className="dp-fields">
        {fieldBox("start")}
        <span className="dp-arrow" aria-hidden="true">~</span>
        {fieldBox("end")}
      </div>
      <div className="dp-quick days">
        {quick.map((q) => {
          const isOn = !!field && sameDay(q.date, field.day);
          return (
            <button key={q.id} type="button" className={`dp-chip${isOn ? " on" : ""}`} aria-pressed={isOn} data-tip={q.tip} onClick={() => pick(q.date)}>
              {q.label}
            </button>
          );
        })}
        <label className="dp-in">
          <input
            type="text"
            value={text}
            placeholder="직접 입력 · 예: 11/20~23"
            spellCheck={false}
            autoComplete="off"
            aria-label="날짜 직접 입력"
            onChange={onText}
            onKeyDown={onTextKey}
          />
        </label>
      </div>
      <p className={`dp-line${parsed ? " got" : parsed === false && showBad ? " bad" : ""}`} aria-live="polite">{line}</p>
      <div onKeyDownCapture={(event) => { byKey.current = event.key.startsWith("Arrow"); }}>
        <MiniMonth
          className="dp-cal"
          minWeeks={6}
          year={view.year}
          month={view.month}
          picked={field?.day ?? null}
          range={[(start ?? end).day, end.day]}
          today={today}
          weekStart={ws}
          onPick={(date) => { const key = byKey.current; byKey.current = false; pick(date, !key); }}
          onMonth={moveMonth}
        />
      </div>
      {field ? (
        <div className="dp-time">
          <div className="dp-row">
            <span id={timeLabel}>{period ? `${active === "start" ? "시작" : "끝"} 시간` : "시간"}</span>
            <button type="button" role="switch" aria-checked={on} aria-labelledby={timeLabel} className={`dp-sw${on ? " on" : ""}`} data-tip="시간 정하기" onClick={toggleTime}><i /></button>
          </div>
          {on ? (
            <>
              <div className="dp-field" key={active}>
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
          ) : active === "start" ? (
            <p className="dp-note">시간 없이 그날 시작({clockOf(0)})부터예요.<br />켜면 시각을 바꿀 수 있어요.</p>
          ) : (
            <p className="dp-note">시간 없이 그날 끝({clockOf(END_OF_DAY)})까지예요.<br />켜면 시각을 바꿀 수 있어요.</p>
          )}
        </div>
      ) : (
        <div className="dp-time"><p className="dp-note only">시작 날을 고르면 시작 시간도 정할 수 있어요.</p></div>
      )}
      {bad && <p className="dp-warn" role="alert">시작이 끝보다 늦어요. 시작이나 끝을 바꿔 주세요.</p>}
      <div className="dp-foot">
        <span className="dp-sum" aria-live="polite">{summary}</span>
        <button type="button" className="dp-btn" onClick={() => onCancel?.()}>취소</button>
        <button type="button" className="dp-btn pri" disabled={bad} onClick={apply}>정하기</button>
      </div>
    </Popover>
  );
}
