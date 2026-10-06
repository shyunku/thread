import { useEffect, useState } from "react";
import { VscArrowDown } from "react-icons/vsc";
import IpcSender from "utils/IpcSender";
import "./UpdateButton.scss";

// Short label on the title bar; the update dialog (ReleaseAlert) has the details.
const UPDATE_LABEL = { available: "업데이트", downloading: "다운로드 중", ready: "업데이트", installing: "설치 중", failed: "업데이트 실패" };
const STATUS_TEXT = { ready: "설치 준비 완료", downloading: "다운로드 중", installing: "설치 중", failed: "실패" };

// The pending update as published by main ("release-alert/available"), or null.
export function useReleaseAlert() {
  const [update, setUpdate] = useState(null);
  useEffect(() => {
    const receive = ({ success, data }) => { if (success) setUpdate(data); };
    const listener = IpcSender.onAll?.("release-alert/available", receive);
    IpcSender.releaseAlerts?.get?.(receive);
    return () => { if (listener) IpcSender.off?.("release-alert/available", listener); };
  }, []);
  return update;
}

// Green title bar button that opens the update dialog. Renders nothing without an update.
export default function UpdateButton({ update, className = "" }) {
  if (!update) return null;
  // A failed install leaves the installer downloaded ("ready") but shows as a failure.
  const status = update.installFailed ? "failed" : update.status;
  return (
    <button type="button" className={`update-indicator update-indicator--${status} ${className}`}
      aria-label={`Thread ${update.version} 업데이트 ${STATUS_TEXT[status] || "다운로드 가능"}`}
      title={`Thread ${update.version} 업데이트`}
      onClick={() => window.dispatchEvent(new Event("thread:open-update"))}>
      <VscArrowDown aria-hidden="true" />
      <span>{["downloading", "available"].includes(status) && update.autoInstall ? "업데이트 중" : UPDATE_LABEL[status] || "업데이트"}</span>
    </button>
  );
}
