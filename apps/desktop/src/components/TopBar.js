import { useEffect, useRef, useState } from "react";
import {
  VscChromeClose,
  VscChromeMaximize,
  VscChromeMinimize,
  VscChromeRestore,
  VscSearch,
  VscArrowDown,
} from "react-icons/vsc";
import IpcSender from "utils/IpcSender";
import PackageJson from "../../package.json";
import "./TopBar.scss";

const TopBar = ({ searchQuery = "", setSearchQuery }) => {
  const [maximized, setMaximized] = useState(false);
  const [update, setUpdate] = useState(null);
  const searchRef = useRef(null);
  useEffect(() => {
    IpcSender.system.isMaximizable(({ success, data }) => {
      if (success) setMaximized(data);
    });
    const listener = IpcSender.onAll(
      "win_state_changed",
      ({ success, data }) => {
        if (success && (data === "maximize" || data === "unmaximize"))
          setMaximized(data === "maximize");
      }
    );
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const updateListener = IpcSender.onAll("release-alert/available", ({success,data}) => { if(success)setUpdate(data); });
    IpcSender.releaseAlerts.get(({success,data}) => { if(success)setUpdate(data); });
    return () => {
      IpcSender.off("win_state_changed", listener);
      IpcSender.off("release-alert/available", updateListener);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <header className="component top-bar">
      <div className="brand" title={`Thread ${PackageJson.version}`}>
        <img src={process.env.PUBLIC_URL + "/logo192.png"} alt="Thread" />
      </div>
      <div className="drag-section" />
      <div className="workspace-search">
        <VscSearch aria-hidden="true" />
        <input
          ref={searchRef}
          aria-label="현재 카테고리에서 할 일 검색"
          placeholder="할 일, 메모, 카테고리 검색…"
          value={searchQuery}
          onChange={(e) => setSearchQuery?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearchQuery?.("");
              e.currentTarget.blur();
            }
          }}
        />
        {searchQuery ? (
          <button
            className="clear-search"
            aria-label="검색 지우기"
            onClick={() => setSearchQuery?.("")}
          >
            <VscChromeClose />
          </button>
        ) : (
          <kbd>Ctrl K</kbd>
        )}
      </div>
      {update && <button type="button" className={`update-indicator update-indicator--${update.status}`} aria-label={`Thread ${update.version} 업데이트 ${update.status === "ready" ? "설치 준비 완료" : update.status === "downloading" ? "다운로드 중" : update.status === "failed" ? "다운로드 실패" : "다운로드 가능"}`} title={`Thread ${update.version} 업데이트`} onClick={() => window.dispatchEvent(new Event("thread:open-update"))}><VscArrowDown aria-hidden="true" /></button>}
      <div className="build-label">
        {process.env.NODE_ENV === "development"
          ? "DEV"
          : `v${PackageJson.version}`}
      </div>
      <div className="menu-section">
        <button
          className="menu-item"
          aria-label="최소화"
          onClick={() => IpcSender.system.minimizeWindow()}
        >
          <VscChromeMinimize />
        </button>
        <button
          className="menu-item"
          aria-label={maximized ? "이전 크기로" : "최대화"}
          onClick={() =>
            maximized
              ? IpcSender.system.restoreWindow()
              : IpcSender.system.maximizeWindow()
          }
        >
          {maximized ? <VscChromeRestore /> : <VscChromeMaximize />}
        </button>
        <button
          className="menu-item close"
          aria-label="창 닫기"
          onClick={() => IpcSender.system.closeWindow()}
        >
          <VscChromeClose />
        </button>
      </div>
    </header>
  );
};
export default TopBar;
