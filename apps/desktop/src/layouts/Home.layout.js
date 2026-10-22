import LeftSidebar from "components/LeftSidebar";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Outlet, useOutletContext } from "react-router-dom";

import "./Home.layout.scss";
import Category from "../objects/Category";
import { SecretSessionProvider } from "../hooks/useSecretSession";
import { applyCreateCategory, applyDeleteCategory } from "../hooks/UseTransaction";
import { trapTab } from "../molecules/pickers/Popover";
import { accountInfoSlice } from "../store/accountSlice";
import IpcSender from "../utils/IpcSender";
import { TODO_MENU_TYPE } from "../utils/menuFilters";
import { HomeLayoutContext, layoutForWidth, useWindowWidth } from "./homeLayoutContext";

const HomeLayout = () => {
  const props = useOutletContext();
  const uid = useSelector(accountInfoSlice)?.uid;
  const [selectedTodoMenuType, setSelectedTodoMenuType] = useState(TODO_MENU_TYPE.ALL);
  const width = useWindowWidth();
  const facts = useMemo(() => layoutForWidth(width), [width]);
  const [sideOpen, setSideOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [overlayEl, setOverlayEl] = useState(null);
  const drawerRef = useRef(null);

  const { states, addPromise } = props;
  const { categories } = states;

  const mergedCategories = useMemo(() => {
    const merged = {};
    for (let key in categories) {
      merged[key] = categories[key];
    }
    for (let key in TODO_MENU_TYPE) {
      let value = TODO_MENU_TYPE[key];
      merged[value] = new Category(value, false, true);
    }
    return merged;
  }, [categories]);

  const selectedCategory = useMemo(() => {
    return mergedCategories?.[selectedTodoMenuType];
  }, [selectedTodoMenuType, mergedCategories]);

  useEffect(() => {
    if (!mergedCategories.hasOwnProperty(selectedTodoMenuType)) {
      setSelectedTodoMenuType(TODO_MENU_TYPE.ALL);
    }
  }, [mergedCategories, selectedTodoMenuType]);

  // Crossing a breakpoint closes the drawers of the old layout.
  useEffect(() => setSideOpen(false), [facts.hideSide]);
  useEffect(() => setPanelOpen(false), [facts.overlayPanel]);

  // Esc closes an open drawer. Popups inside handle their own Esc first (capture phase).
  useEffect(() => {
    if (!sideOpen && !panelOpen) return;
    const onKey = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (sideOpen) setSideOpen(false);
      else setPanelOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sideOpen, panelOpen]);

  // The sidebar drawer is modal: focus moves into it (the current menu row) and back to
  // where it was (the ☰) when it closes.
  const drawerOpen = facts.hideSide && sideOpen;
  useEffect(() => {
    if (!drawerOpen) return;
    const opener = document.activeElement;
    const el = drawerRef.current;
    (el?.querySelector(".side-row.on") || el?.querySelector(".side-row") || el)?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, [drawerOpen]);

  // Legacy path transitions (E2EE and v2 refresh from sync-v2/state instead). Kept here, not
  // in the sidebar, so they stay while the sidebar is a closed drawer.
  useEffect(() => {
    IpcSender.onAll("category/createCategory", ({ success, data }) => {
      applyCreateCategory({ success, data, addPromise });
    });
    IpcSender.onAll("category/deleteCategory", ({ success, data }) => {
      applyDeleteCategory({ success, data, addPromise });
    });
    return () => {
      IpcSender.offAll("category/createCategory");
      IpcSender.offAll("category/deleteCategory");
    };
  }, [addPromise]);

  // Picking a menu in the drawer closes it.
  const selectMenu = useCallback((id) => {
    setSelectedTodoMenuType(id);
    setSideOpen(false);
  }, []);

  const layout = useMemo(
    () => ({ ...facts, sideOpen, setSideOpen, panelOpen, setPanelOpen, overlayEl }),
    [facts, sideOpen, panelOpen, overlayEl]
  );

  const sidebarProps = {
    setSelectedTodoMenuType: selectMenu,
    selectedTodoMenuType,
    categories: categories ?? {},
  };

  return (
    <HomeLayoutContext.Provider value={layout}>
      <SecretSessionProvider uid={uid}>
        <div className={`home-layout ${facts.mode}`}>
          {!facts.hideSide && <LeftSidebar {...sidebarProps} mode={facts.rail ? "rail" : "full"} />}
          <div className="home-layout__main">
            <Outlet
              context={{
                selectedTodoMenuType,
                setSelectedTodoMenuType: selectMenu,
                category: selectedCategory,
                layout,
                ...props,
              }}
            />
          </div>
          <div className="home-layout__overlay" ref={setOverlayEl} />
          {drawerOpen && (
            <>
              <div className="home-scrim side" onMouseDown={() => setSideOpen(false)} />
              <div
                ref={drawerRef}
                className="home-sidedrawer"
                role="dialog"
                aria-modal="true"
                aria-label="메뉴"
                tabIndex={-1}
                onKeyDown={(e) => trapTab(e, drawerRef.current)}
              >
                <LeftSidebar {...sidebarProps} mode="drawer" />
              </div>
            </>
          )}
        </div>
      </SecretSessionProvider>
    </HomeLayoutContext.Provider>
  );
};

export default HomeLayout;
