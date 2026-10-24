import { useRef, useState } from "react";
import { SideMenuButton } from "layouts/homeLayoutContext";
import { moveFocus } from "molecules/pickers/focusNav";
import {
  CalendarViewIcon, ListViewIcon, SlidersIcon, TickIcon, TimelineViewIcon,
} from "molecules/pickers/icons";
import Popover from "molecules/pickers/Popover";

export const VIEWS = [
  { id: "list", label: "목록", Icon: ListViewIcon },
  { id: "calendar", label: "캘린더", Icon: CalendarViewIcon },
  { id: "timeline", label: "타임라인", Icon: TimelineViewIcon },
];

// The view options (#102 mock viewMenu), all remembered per device (prefs). It stays open while
// options change; Esc, a press outside or the button close it.
const SECTIONS = [
  { head: "묶기", key: "group", items: [["date", "날짜별"], ["none", "묶지 않기 (기한 순)"]] },
  { head: "기한 없음 묶음", key: "noneTop", items: [[false, "맨 아래"], [true, "맨 위"]] },
  { head: "정렬 (묶음 안에서)", key: "sort", items: [["due", "기한 순"], ["created", "생성일 순"]] },
  { head: "줄", key: "density", items: [["normal", "보통 (두 줄)"], ["compact", "촘촘 (한 줄)"]], toggle: ["showRemain", "남은 시간 보이기"] },
];

function MenuItem({ on, label, role, onClick }) {
  return (
    <button type="button" role={role} aria-checked={on} tabIndex={-1} className={"tp-mi" + (on ? " on" : "")} onClick={onClick}>
      <span className="tp-lb">{label}</span>
      {on && <span className="tp-ok"><TickIcon /></span>}
    </button>
  );
}

export function ViewMenu({ anchor, ignore, prefs, onPref, onClose }) {
  const ref = useRef(null);
  return (
    <Popover
      anchor={anchor}
      placement="bottom-end"
      gap={4}
      ignoreOutside={ignore}
      className="tp-menu tc-viewmenu"
      role="menu"
      label="보기 옵션"
      onClose={() => onClose?.()}
      onKeyDown={(event) => moveFocus(event, ref.current, ".tp-mi")}
    >
      <div ref={ref}>
        {SECTIONS.map((section) => (
          <div key={section.key} role="group" aria-label={section.head}>
            <div className="tp-hd" aria-hidden="true">{section.head}</div>
            {section.items.map(([value, label]) => (
              <MenuItem key={String(value)} role="menuitemradio" on={prefs[section.key] === value} label={label} onClick={() => onPref({ [section.key]: value })} />
            ))}
            {section.toggle && (
              <MenuItem role="menuitemcheckbox" on={!!prefs[section.toggle[0]]} label={section.toggle[1]} onClick={() => onPref({ [section.toggle[0]]: !prefs[section.toggle[0]] })} />
            )}
          </div>
        ))}
        <div className="tp-sp" />
        <MenuItem role="menuitemcheckbox" on={!!prefs.hideDone} label="완료한 할 일 숨기기" onClick={() => onPref({ hideDone: !prefs.hideDone })} />
      </div>
    </Popover>
  );
}

// The list pane's header (#102 mock listPane head): ☰ (drawer layout), title, view switch, view
// options and the summary (the secret lock is in the top bar, SecretLock).
// `nav` sits right after the title (the calendar's and timeline's ‹ 오늘 ›); `heading` replaces
// the plain title (their title buttons that open the jump popup).
export default function ListHeader({ title, summary, view, onView, prefs, onPref, extra, nav, heading }) {
  const [menu, setMenu] = useState(false);
  const optionsRef = useRef(null);
  const rowRef = useRef(null);
  // Under the options button, right-aligned with the header row (mock: top 56, right 32).
  const [menuAnchor] = useState(() => ({
    getBoundingClientRect() {
      const b = optionsRef.current?.getBoundingClientRect(), r = rowRef.current?.getBoundingClientRect();
      if (!b || !r) return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
      return { left: b.left, right: r.right, top: b.top, bottom: b.bottom, width: r.right - b.left, height: b.height };
    },
  }));
  return (
    <div className="tc-head">
      <div className="tc-row1" ref={rowRef}>
        <SideMenuButton className="tc-ghost tc-sq" />
        {heading ?? <h1 className="tc-title">{title}</h1>}
        {nav}
        <span className="tc-push" />
        <div className="tc-seg" role="group" aria-label="보기">
          {VIEWS.map(({ id, label, Icon }) => (
            <button key={id} type="button" className={view === id ? "on" : ""} aria-label={label} aria-pressed={view === id} data-tip={label} onClick={() => onView(id)}>
              <Icon />
            </button>
          ))}
        </div>
        <button
          ref={optionsRef}
          type="button"
          className={"tc-ghost tc-sq" + (menu ? " on" : "")}
          aria-label="보기 옵션"
          aria-haspopup="menu"
          aria-expanded={menu}
          data-tip="보기 옵션"
          onClick={() => setMenu((open) => !open)}
        >
          <SlidersIcon />
        </button>
        {extra}
      </div>
      <p className="tc-finding">{summary}</p>
      {menu && <ViewMenu anchor={menuAnchor} ignore={[optionsRef]} prefs={prefs} onPref={onPref} onClose={() => setMenu(false)} />}
    </div>
  );
}
