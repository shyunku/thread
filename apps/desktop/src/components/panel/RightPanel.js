import "./RightPanel.scss";
import { useEffect, useRef, useState } from "react";
import { useHomeLayout } from "layouts/homeLayoutContext";
import { CloseIcon } from "molecules/pickers/icons";
import { useTaskSelection } from "../list/taskSelection";
import CalendarTab, { DayList } from "./CalendarTab";
import DetailPanel from "./DetailPanel";

const PanelIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" />
  </svg>
);

// 패널 열기 in the header, below 1000px where the panel is a drawer (mock data-drawer).
export function PanelOpenButton({ onOpen }) {
  return (
    <button type="button" className="tc-ghost tc-sq" aria-label="패널 열기" data-tip="패널 열기" onClick={onOpen}>
      <PanelIcon />
    </button>
  );
}

// Which tab shows (#102 mock panelTab): the calendar view has only 선택한 날; otherwise a selected
// task shows 할 일 상세 unless the user went to 캘린더 for this same task (or right-clicked in the
// day list, which keeps the tab); nothing selected → 캘린더. A hold from another view's tabs
// (선택한 날) does not count.
export function panelTab({ view, selectedId, hold }) {
  if (view === "calendar") return "day";
  if (!selectedId) return "calendar";
  return hold && hold.id === selectedId && (hold.tab === "detail" || hold.tab === "calendar") ? hold.tab : "detail";
}

const tabId = (id) => `rp-tab-${id}`;

// The right panel of the main screen (#102 mock panel()), inside PanelHost.
// tasks: the screen's shown tasks by id (the day list and the marks); catsOf(task) the categories
// to show for a task; onTaskContextMenu(event, taskId) the task menu.
export default function RightPanel({ view, tasks, catsOf, prefs, canStar, onTaskContextMenu }) {
  const { selectedTask, setSelectedTaskId, openTask, detailRequest } = useTaskSelection();
  const { overlayPanel, setPanelOpen } = useHomeLayout();
  const selectedId = selectedTask?.id ?? null;
  const [hold, setHold] = useState(null); // { id, tab }
  const tablistRef = useRef(null);
  // A new selection starts on its detail.
  useEffect(() => {
    setHold((h) => (h && h.id !== selectedId ? null : h));
  }, [selectedId]);
  // Opening a task (row, day list, 열기) shows its detail even when it is already selected; a
  // view change starts over too.
  useEffect(() => {
    setHold(null);
  }, [detailRequest, view]);

  const tab = panelTab({ view, selectedId, hold });
  const tabs = view === "calendar" ? [["day", "선택한 날"]] : [["detail", "할 일 상세"], ["calendar", "캘린더"]];
  const enabled = tabs.map(([id]) => id).filter((id) => !(id === "detail" && !selectedId));

  // ×: the drawer closes; inline, the detail lets go of its task (the panel goes back to 캘린더).
  const canClose = overlayPanel || tab === "detail";
  const close = () => {
    if (overlayPanel) setPanelOpen(false);
    else setSelectedTaskId(null);
  };

  const choose = (id) => {
    if (id !== "day" && enabled.includes(id)) setHold({ id: selectedId, tab: id });
  };
  // ← / → (and Home / End) move between the tabs that can open, and open them.
  const onTabKey = (event) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1 };
    let next;
    const at = enabled.indexOf(tab);
    if (event.key in steps) next = enabled[(at + steps[event.key] + enabled.length) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    else return;
    event.preventDefault();
    choose(next);
    tablistRef.current?.querySelector(`#${tabId(next)}`)?.focus();
  };

  const onMenu = (event, taskId) => {
    setHold({ id: taskId, tab });
    onTaskContextMenu?.(event, taskId);
  };
  const dayProps = { tasks, catsOf, prefs, onOpen: openTask, onMenu };

  return (
    <div className="rp main-scope">
      <div className="rp-tabs" role="tablist" aria-label="패널" ref={tablistRef} onKeyDown={onTabKey}>
        {tabs.map(([id, label]) => {
          const off = !enabled.includes(id);
          return (
            <button
              key={id}
              id={tabId(id)}
              type="button"
              role="tab"
              className={"rp-tab" + (tab === id ? " on" : "") + (off ? " off" : "")}
              aria-selected={tab === id}
              aria-controls="rp-tabpanel"
              aria-disabled={off || undefined}
              tabIndex={tab === id ? 0 : -1}
              data-tip={off ? "할 일을 고르면 열려요" : undefined}
              onClick={() => choose(id)}
            >
              {label}
            </button>
          );
        })}
        {canClose && (
          <button
            type="button"
            className="rp-x"
            aria-label={overlayPanel ? "패널 닫기" : "상세 닫기"}
            data-tip={overlayPanel ? "패널 닫기" : "상세 닫기"}
            onClick={close}
          >
            {/* 18px: the cross is 10px across, like the mock's ✕. */}
            <CloseIcon size={18} />
          </button>
        )}
      </div>
      <div className="rp-body" role="tabpanel" id="rp-tabpanel" aria-labelledby={tabId(tab)}>
        {tab === "detail" && selectedTask ? (
          <DetailPanel key={selectedTask.id} task={selectedTask} catsOf={catsOf} prefs={prefs} canStar={canStar} />
        ) : tab === "day" ? (
          <DayList {...dayProps} />
        ) : (
          <CalendarTab {...dayProps} />
        )}
      </div>
    </div>
  );
}
