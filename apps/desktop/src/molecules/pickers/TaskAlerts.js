import { alertsLabel } from "utils/taskPeriod";
import { formatClockShort } from "utils/timeDisplay";
import { BellIcon, BellOffIcon, GearIcon, TickIcon } from "./icons";
import Popover from "./Popover";

// Per-task alerts (#109 mock bellBtn, bellPop, alertMenuRows). `alert` is one side of
// taskAlerts(task, settings): { side, time, alertable, mode, direct, on, alerts, offBySettings }.
export const SIDE_NAME = { start: "시작", end: "끝" };

// The bell's tooltip.
export function bellTip(alert) {
  const name = SIDE_NAME[alert.side];
  if (!alert.alertable) return `${name}에 시각을 정하면 알림을 받을 수 있어요`;
  if (alert.direct) return `${name} 알림: 이 할 일만 직접 설정`;
  return `${name} 알림: 전체 설정 따름 (${alert.on ? alertsLabel(alert.alerts, " · ") : "꺼짐"})`;
}

// The bell's name with its state: "끝 알림, 전체 설정 따름 (10분 전)", "끝 알림, 직접 끔".
export function bellLabel(alert) {
  const name = `${SIDE_NAME[alert.side]} 알림`;
  const what = alert.on ? ` (${alertsLabel(alert.alerts)})` : "";
  if (alert.mode === "off") return `${name}, 직접 끔`;
  if (alert.mode === "on") return `${name}, 직접 켬${what}`;
  return `${name}, 전체 설정 따름${alert.on ? what : " (꺼짐)"}`;
}

// What rings now, under the popover's header: "10분 전, 정각", "꺼짐" or "꺼짐 (설정에서 꺼짐)".
export function alertNow(alert) {
  if (alert.on) return alertsLabel(alert.alerts);
  return alert.mode === "off" ? "꺼짐" : "꺼짐 (설정에서 꺼짐)";
}

// The bell of a 시작 / 끝 row in the detail. A side without a time shows a dimmed bell that only
// explains; a side set on the task itself (직접) is tinted with a dot.
export function AlertBell({ alert, open = false, onOpen }) {
  const name = SIDE_NAME[alert.side];
  if (!alert.alertable) {
    return <span className="rp-bell dis" role="img" aria-label={`${name} 알림 없음`} data-tip={bellTip(alert)}><BellOffIcon /></span>;
  }
  const cls = "rp-bell" + (alert.direct ? (alert.on ? " on-dir" : " off-dir") : "") + (open ? " open" : "");
  return (
    <button
      type="button"
      className={cls}
      aria-label={bellLabel(alert)}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-tip={open ? undefined : bellTip(alert)}
      onClick={(event) => { event.stopPropagation(); onOpen?.(event.currentTarget); }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {alert.on ? <BellIcon /> : <BellOffIcon />}
      {alert.direct && <i className="dir" />}
    </button>
  );
}

const CHOICES = [
  ["follow", "전체 설정 따르기", "설정 > 알림을 바꾸면 같이 바뀌어요"],
  ["on", "이 할 일만 켜기", "설정을 바꿔도 그대로"],
  ["off", "이 할 일만 끄기", "설정을 바꿔도 그대로"],
];

// The bell's popover: "끝 알림 · 오후 5시", what rings now, then 전체 설정 따르기 / 이 할 일만
// 켜기 / 이 할 일만 끄기. onSet(value) gets null for follow, "on" or "off", then it closes.
export function AlertPopover({ alert, anchor, timeFormat = "12", onSet, onClose }) {
  const name = SIDE_NAME[alert.side];
  const quiet = !alert.on;
  return (
    <Popover anchor={anchor} placement="bottom-end" gap={6} offset={{ x: 6 }} className="bell-pop" label={`${name} 알림`} returnFocus={anchor} ignoreOutside={[anchor]} onClose={onClose}>
      <div className="tp-hd">{name} 알림 · {formatClockShort(new Date(alert.time), timeFormat)}</div>
      <div className={"bp-now" + (quiet ? " off" : "")}>{alertNow(alert)}</div>
      <div role="radiogroup" aria-label={`${name} 알림`}>
        {CHOICES.map(([value, label, sub]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={alert.mode === value}
            className={"tp-mi" + (alert.mode === value ? " on" : "")}
            onClick={() => { onSet?.(value === "follow" ? null : value); onClose?.(); }}
          >
            <span className="pk-rd" />
            <span className="tp-lb">{label}<small>{sub}</small></span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

// The task menu's 알림 ▸ submenu: 전체 설정 따르기 (checked while no side is set on the task),
// then a row per side ("끝 알림 / 10분 전 · 정각" with 전체 설정 or 직접); pressing a row turns
// that side on or off for this task. A side without a time is dimmed. onSet(side, value) with
// null (follow), "on" or "off".
export function AlertMenuItems({ alerts, onSet }) {
  const anyDirect = alerts.some((a) => a.direct);
  const noTime = alerts.some((a) => !a.alertable);
  return (
    <>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={!anyDirect}
        tabIndex={-1}
        className={"tp-mi" + (anyDirect ? "" : " on")}
        onClick={() => { for (const a of alerts) if (a.direct) onSet?.(a.side, null); }}
      >
        <span className="tp-mic"><GearIcon size={16} /></span>
        <span className="tp-lb">전체 설정 따르기</span>
        <span className={"tp-ok" + (anyDirect ? " ph" : "")}><TickIcon size={14} /></span>
      </button>
      <div className="tp-sp" />
      {alerts.map((a) => {
        const name = SIDE_NAME[a.side];
        if (!a.alertable) {
          return (
            <div key={a.side} role="menuitem" aria-disabled="true" tabIndex={-1} className="tp-mi dis" data-tip={`${name}에 시각을 정하면 켤 수 있어요`}>
              <span className="tp-mic"><BellOffIcon size={14} /></span>
              <span className="tp-lb">{name} 알림</span>
              <span className="tp-kb">시각 없음</span>
            </div>
          );
        }
        return (
          <button
            key={a.side}
            type="button"
            role="menuitemcheckbox"
            aria-checked={a.on}
            tabIndex={-1}
            className={"tp-mi two" + (a.on ? " on" : "")}
            onClick={() => onSet?.(a.side, a.on ? "off" : "on")}
          >
            <span className="tp-mic">{a.on ? <BellIcon size={14} /> : <BellOffIcon size={14} />}</span>
            <span className="tp-lb">{name} 알림<small>{a.on ? alertsLabel(a.alerts, " · ") : "꺼짐"}</small></span>
            <span className={"tp-kb" + (a.direct ? " dir" : "")}>{a.direct ? "직접" : "전체 설정"}</span>
            <span className={"tp-ok" + (a.on ? "" : " ph")}><TickIcon size={14} /></span>
          </button>
        );
      })}
      <div className="tp-note">
        {noTime ? "날짜만 정한 시작 · 끝은 알림이 없어요. 시각을 정하면 켤 수 있어요." : "직접 켜고 끈 알림은 설정 > 알림을 바꿔도 그대로예요."}
      </div>
    </>
  );
}
