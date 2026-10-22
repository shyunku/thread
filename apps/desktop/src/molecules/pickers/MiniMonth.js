import { useEffect, useRef } from "react";
import { monthGridStart, weekdayOrder } from "utils/dateGroups";
import { NextIcon, PrevIcon } from "./icons";

const WEEKDAYS = "일월화수목금토";
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const sameDay = (a, b) => !!a && !!b && dayKey(new Date(a)) === dayKey(new Date(b));
const addDays = (value, days) => { const d = new Date(value); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d; };

// Day cells of a month grid starting on 주 시작 요일: whole weeks from the week of the 1st to
// the week of the last day (4 to 6 rows).
export function monthCells(year, month, weekStart = 0) {
  const start = monthGridStart(year, month, weekStart);
  const last = new Date(year, month + 1, 0);
  const span = Math.round((new Date(last).setHours(0, 0, 0, 0) - start.getTime()) / 864e5) + 1;
  const count = Math.ceil(span / 7) * 7;
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

// The small month calendar of the date picker and the panel's calendar tab (#102 mock .mini).
// Today has the accent ring, the picked day the deep blue fill, both together a halo.
// Arrow keys move the pick (onPick) by a day or a week, PageUp/PageDown change the month.
// marks(date) can return "open" or "over" for the 4px dot under a day (calendar tab).
// arrowTips gives the month arrows a tooltip (the timeline's jump popup).
export default function MiniMonth({ year, month, picked, today = new Date(), weekStart = 0, onPick, onMonth, marks, arrowTips = false, className = "" }) {
  const gridRef = useRef(null);
  const cells = monthCells(year, month, weekStart);
  const pickedInView = picked && cells.some((d) => sameDay(d, picked) && d.getMonth() === month);
  const focusKey = pickedInView ? dayKey(new Date(picked)) : dayKey(new Date(year, month, 1));
  const keyboard = useRef(false);

  // After a keyboard move, keep focus on the picked day (it may be in another month now).
  useEffect(() => {
    if (!keyboard.current) return;
    keyboard.current = false;
    gridRef.current?.querySelector(`[data-day="${focusKey}"]`)?.focus({ preventScroll: true });
  });

  const onKeyDown = (event) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (steps[event.key] !== undefined) {
      event.preventDefault();
      keyboard.current = true;
      onPick?.(addDays(picked && pickedInView ? picked : new Date(year, month, 1), steps[event.key]));
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      keyboard.current = true;
      onMonth?.(event.key === "PageUp" ? -1 : 1);
    }
  };

  return (
    <div className={`tp-mm ${className}`}>
      <div className="tp-mm-h">
        <span className="tp-mm-title" aria-live="polite">{year}년 {month + 1}월</span>
        <span className="tp-mm-nav">
          <button type="button" className="tp-mm-arrow" aria-label="이전 달" data-tip={arrowTips ? "이전 달" : undefined} onClick={() => onMonth?.(-1)}><PrevIcon /></button>
          <button type="button" className="tp-mm-arrow" aria-label="다음 달" data-tip={arrowTips ? "다음 달" : undefined} onClick={() => onMonth?.(1)}><NextIcon /></button>
        </span>
      </div>
      <div className="tp-mm-g" role="group" aria-label={`${year}년 ${month + 1}월`} ref={gridRef} onKeyDown={onKeyDown}>
        {weekdayOrder(weekStart).map((wd) => (
          <span key={`w${wd}`} className={`tp-mm-w${wd === 0 ? " sun" : wd === 6 ? " sat" : ""}`} aria-hidden="true">{WEEKDAYS[wd]}</span>
        ))}
        {cells.map((d) => {
          const key = dayKey(d), wd = d.getDay();
          const isToday = sameDay(d, today), isPicked = sameDay(d, picked);
          const mark = marks?.(d);
          const cls = ["tp-mm-c", d.getMonth() !== month && "out", isToday && "today", isPicked && "picked", wd === 0 ? "sun" : wd === 6 ? "sat" : ""].filter(Boolean).join(" ");
          return (
            <button
              key={key}
              type="button"
              className={cls}
              data-day={key}
              aria-pressed={isPicked}
              aria-current={isToday ? "date" : undefined}
              aria-label={`${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[wd]}요일`}
              tabIndex={key === focusKey ? 0 : -1}
              onClick={() => onPick?.(d)}
            >
              <b>{d.getDate()}</b>
              {mark && <i className={mark === "over" ? "over" : ""} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
