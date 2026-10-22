import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MenuIcon } from "../molecules/pickers/icons";

// Responsive main screen (#102 mock layout()), by window width:
// ≥1280 full sidebar 232 + list + panel 360; 1000–1279 icon rail + panel 320;
// 800–999 rail + the panel as an overlay drawer; <800 the sidebar is a drawer (☰).
export const SIDEBAR_WIDTH = 232;
export const RAIL_WIDTH = 56;

export function layoutForWidth(width) {
  const hideSide = width < 800;
  const rail = width < 1280;
  return {
    width,
    mode: hideSide ? "drawer" : rail ? "rail" : "full",
    rail,
    hideSide,
    overlayPanel: width < 1000,
    panelW: width >= 1280 ? 360 : 320,
    sideW: hideSide ? 0 : rail ? RAIL_WIDTH : SIDEBAR_WIDTH,
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
  overlayEl: null,
});

// Layout facts for the list and panel: { mode, rail, hideSide, overlayPanel, panelW, sideW,
// sideOpen, setSideOpen, panelOpen, setPanelOpen }. Also in the outlet context as `layout`.
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

// Host for the right panel (phase F). Inline beside the list with its 1px splitter, or below
// 1000px a drawer from the right over a scrim, open while `panelOpen`.
export function PanelHost({ children, className = "" }) {
  const { overlayPanel, panelW, panelOpen, setPanelOpen, overlayEl } = useHomeLayout();
  if (!overlayPanel) {
    return (
      <>
        <div className="home-splitter" />
        <aside className={"home-panel " + className} style={{ width: panelW }}>
          {children}
        </aside>
      </>
    );
  }
  if (!panelOpen || !overlayEl) return null;
  return createPortal(
    <>
      <div className="home-scrim" onMouseDown={() => setPanelOpen(false)} />
      <aside className={"home-panel drawer " + className} style={{ width: panelW }}>
        {children}
      </aside>
    </>,
    overlayEl
  );
}
