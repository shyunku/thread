import "./Data.settings.scss";
import { useEffect, useState } from "react";
import { VscRefresh } from "react-icons/vsc";
import { useSelector } from "react-redux";
import { accountInfoSlice } from "../../store/accountSlice";
import IpcSender from "../../utils/IpcSender";
import VaultWorkspace from "../../components/VaultWorkspace";
import Tooltip from "../../components/Tooltip";
import { SettingsPage } from "./SettingsUI";

const SettingData = ({ modalRef, preview = false, previewPanel = null }) => {
  const { uid: accountUid } = useSelector(accountInfoSlice);
  const uid = preview ? "settings-preview" : accountUid;
  const [status, setStatus] = useState(preview ? { uid, protocolVersion: 3, connected: true, pending: 2, seq: "128", canSync: true, recovery: 0 } : null);
  const [requestError, setRequestError] = useState(false);

  useEffect(() => {
    if (preview) return;
    let active = true;
    let receivedEvent = false;
    setStatus(null);
    setRequestError(false);
    const onStatus = ({ success, data }) => {
      if (active && success && data?.uid === uid) {
        receivedEvent = true;
        setStatus(data);
        setRequestError(false);
      }
    };
    const listener = IpcSender.onAll("sync-v2/status", onStatus);
    IpcSender.syncV2.getStatus((response) => {
      if (!active || receivedEvent) return;
      if (response.success) onStatus(response);
      else setRequestError(true);
    });
    return () => {
      active = false;
      IpcSender.off("sync-v2/status", listener);
    };
  }, [uid, preview]);

  const current = status?.uid === uid ? status : null;
  const recoveryCount = typeof current?.recovery === "number" ? current.recovery : current?.recovery?.length;
  const syncLabel = !current ? "확인 중" : current.error ? "동기화 보류" : current.syncing ? "동기화 중" : current.connected ? "온라인" : "오프라인";
  const pending = Math.max(0, Number(current?.pending) || 0);
  const canRetry = !preview && !!current?.connected && !!current?.canSync && !current?.syncing;
  const retry = () => {
    setRequestError(false);
    // The normal v2 loop publishes fresh status; never initialize/delete data.
    IpcSender.syncV2.retry(({ success }) => {
      if (!success) setRequestError(true);
    });
  };

  return (
    <SettingsPage title="데이터" description="내 데이터는 기기에서 암호화되어 저장·동기화됩니다.">
    <div className="settings data-settings">
      <div className="data-settings__overview">
        <section className="setting-item data-settings__card sync-status" role="status">
          <div className="head">
            <h3 className="label">동기화 상태</h3>
            <div className="data-settings__head-actions">
              <span className={"data-settings__badge" + (current?.error || !current?.connected ? " data-settings__badge--quiet" : "")}>{syncLabel}</span>
              <Tooltip label="동기화"><button type="button" className="data-settings__refresh" aria-label="동기화" disabled={!canRetry} onClick={retry}><VscRefresh aria-hidden="true" /></button></Tooltip>
            </div>
          </div>
          <div className="body">
            <div className="sync-summary">
              <div className={"sync-summary__bar" + (!current?.connected ? " sync-summary__bar--offline" : "")} role="img" aria-label={`동기화 대기 ${current?.pending ?? "확인 중"}개`}>
                <span className="sync-summary__synced" />{pending > 0 && <span className="sync-summary__pending" />}
              </div>
              <p className="sync-summary__pending-label">동기화 대기: {current?.pending ?? "—"}개</p>
              {current?.error && <div className="sync-summary__message">{current.error}</div>}
              {recoveryCount > 0 && <div className="sync-summary__message">복구 검토: {recoveryCount}개</div>}
            </div>
            {requestError && <div className="data-settings__error" role="alert">동기화 상태를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.</div>}
          </div>
        </section>
      </div>
      <section className="setting-item data-settings__manage">
        <div className="head"><h3 className="label">데이터 관리</h3></div>
        <div className="body">
          <div className="data-settings__vault"><VaultWorkspace key={uid} uid={uid} preview={preview} initialPanel={preview ? previewPanel : null} onLocked={() => modalRef?.current?.close()} /></div>
        </div>
      </section>
    </div>
    </SettingsPage>
  );
};

export default SettingData;
