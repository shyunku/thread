import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hideTooltip } from "../components/Tooltip";
import { trapTab } from "../molecules/pickers/Popover";
import { MenuIcon } from "../molecules/pickers/icons";
import { PANEL_WIDTH_MAX, PANEL_WIDTH_MIN } from "../store/prefsSlice";

// Responsive main screen (#102 mock layout()), by window width:
// ≥1280 full sidebar 232 + list + panel 360; 1000–1279 icon rail + panel 320;
// 800–999 rail + the panel as an overlay drawer; <800 the sidebar is a drawer (☰).
export const SIDEBAR_WIDTH = 232;
export const RAIL_WIDTH = 56;
// The list keeps at least this much beside an inline panel; a dragged width that does not fit
// shrinks (down to PANEL_WIDTH_MIN) until the window is wide enough again.
export const MIN_LIST_WIDTH = 560;
// ← / → on the focused splitter.
export const PANEL_KEY_STEP = 16;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// storedPanelW: the dragged width from prefs (panelWidth), null for the default (360 / 320).
// panelW is the width the panel gets; panelMax the most the splitter may give it now.
export function layoutForWidth(width, storedPanelW = null) {
  const hideSide = width < 800;
  const rail = width < 1280;
  const overlayPanel = width < 1000;
  const sideW = hideSide ? 0 : rail ? RAIL_WIDTH : SIDEBAR_WIDTH;
  const panelDefault = width >= 1280 ? 360 : 320;
  const panelMax = clamp(width - sideW - 1 - MIN_LIST_WIDTH, PANEL_WIDTH_MIN, PANEL_WIDTH_MAX);
  // The drawer below 1000px has no splitter and keeps the default.
  const wanted = !overlayPanel && Number.isFinite(storedPanelW) ? storedPanelW : panelDefault;
  return {
    width,
    mode: hideSide ? "drawer" : rail ? "rail" : "full",
    rail,
    hideSide,
    overlayPanel,
    panelW: overlayPanel ? panelDefault : clamp(wanted, PANEL_WIDTH_MIN, panelMax),
    panelDefault,
    panelMax,
    sideW,
  };
}

export function useWindowWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

const noop = () => {};
export const HomeLayoutContext = createContext({
  ...layoutForWidth(1440),
  sideOpen: false,
  setSideOpen: noop,
  panelOpen: false,
  setPanelOpen: noop,
  setPanelWidth: noop,
  overlayEl: null,
});

// Layout facts for the list and panel: { mode, rail, hideSide, overlayPanel, panelW, panelDefault,
// panelMax, sideW, sideOpen, setSideOpen, panelOpen, setPanelOpen, setPanelWidth(px | null) }.
// Also in the outlet context as `layout`.
export function useHomeLayout() {
  return useContext(HomeLayoutContext);
}

// ☰ in the list header; only below 800px, where the sidebar is a drawer.
export function SideMenuButton({ className = "" }) {
  const { hideSide, sideOpen, setSideOpen } = useHomeLayout();
  if (!hideSide) return null;
  return (
    <button
      type="button"
      className={"side-menu-button no-auto-hover " + className}
      aria-label="메뉴"
      aria-haspopup="dialog"
      aria-expanded={!!sideOpen}
      data-tip="메뉴"
      onClick={() => setSideOpen(true)}
    >
      <MenuIcon />
    </button>
  );
}

// The 1px line between the list and the inline panel (#102 mock .splitter): dragging it sets the
// panel width (PANEL_WIDTH_MIN to `max`), double-click goes back to the default, ← / → step it
// while focused. The width shows live while dragging and is stored (onSet) on release.
function PanelSplitter({ width, max, onDrag, onSet }) {
  const drag = useRef(null); // { x, width, last, moved }
  const fit = (value) => clamp(Math.round(value), PANEL_WIDTH_MIN, max);
  const stop = (commit) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.body.classList.remove("panel-resizing");
    if (commit && d.moved && d.last !== d.width) onSet(d.last);
    onDrag(null);
  };
  // A drag cut short by unmounting (the window got narrow) leaves nothing behind.
  useEffect(() => () => document.body.classList.remove("panel-resizing"), []);
  return (
    <div
      className="home-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="패널 너비"
      aria-valuemin={PANEL_WIDTH_MIN}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      data-tip="끌어서 너비 조절"
      onPointerDown={(event) => {
        if (event.button > 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { x: event.clientX, width, last: width, moved: false };
        document.body.classList.add("panel-resizing");
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d) return;
        // The panel is on the right: moving left widens it.
        d.moved = d.moved || Math.abs(event.clientX - d.x) >= 2;
        if (!d.moved) return;
        d.last = fit(d.width + d.x - event.clientX);
        hideTooltip();
        onDrag(d.last);
      }}
      onPointerUp={() => stop(true)}
      onPointerCancel={() => stop(false)}
      onLostPointerCapture={() => stop(true)}
      onDoubleClick={() => {
        stop(false);
        onSet(null);
      }}
      onKeyDown={(event) => {
        const step = { ArrowLeft: PANEL_KEY_STEP, ArrowRight: -PANEL_KEY_STEP }[event.key];
        if (step === undefined) return;
        event.preventDefault();
        const next = fit(width + step);
        if (next !== width) onSet(next);
      }}
    />
  );
}

// Host for the right panel (phase F). Inline beside the list with its splitter, or below 1000px
// a drawer from the right over a scrim, open while `panelOpen`. The drawer is modal like the
// sidebar drawer: focus moves in (the active tab), Tab stays inside, and focus goes back to where
// it was when it closes.
export function PanelHost({ children, className = "" }) {
  const { overlayPanel, panelW, panelMax, panelOpen, setPanelOpen, setPanelWidth, overlayEl } = useHomeLayout();
  const [dragW, setDragW] = useState(null);
  const drawerRef = useRef(null);
  const drawerOpen = overlayPanel && panelOpen && !!overlayEl;
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const opener = document.activeElement;
    const el = drawerRef.current;
    (el?.querySelector('[role="tab"][aria-selected="true"]') || el)?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, [drawerOpen]);

  if (!overlayPanel) {
    const width = dragW ?? panelW;
    return (
      <>
        <PanelSplitter width={width} max={panelMax ?? PANEL_WIDTH_MAX} onDrag={setDragW} onSet={setPanelWidth ?? noop} />
        <aside className={"home-panel " + className} style={{ width }}>
          {children}
        </aside>
      </>
    );
  }
  if (!drawerOpen) return null;
  return createPortal(
    <>
      <div className="home-scrim" onMouseDown={() => setPanelOpen(false)} />
      <aside
        ref={drawerRef}
        className={"home-panel drawer " + className}
        style={{ width: panelW }}
        role="dialog"
        aria-modal="true"
        aria-label="패널"
        tabIndex={-1}
        onKeyDown={(event) => trapTab(event, drawerRef.current)}
      >
        {children}
      </aside>
    </>,
    overlayEl
  );
}
