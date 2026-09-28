import "./Data.settings.scss";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { accountInfoSlice } from "../../store/accountSlice";
import IpcSender from "../../utils/IpcSender";
import VaultWorkspace from "../../components/VaultWorkspace";

const SettingData = ({ modalRef, preview = false, previewVault = false }) => {
  const { uid: accountUid } = useSelector(accountInfoSlice);
  const uid = preview ? "settings-preview" : accountUid;
  const [status, setStatus] = useState(preview ? { uid, protocolVersion: 3, connected: true, pending: 2, seq: "128", canSync: true, recovery: 0 } : null);
  const [requestError, setRequestError] = useState(false);
  const [showVault, setShowVault] = useState(previewVault);

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
  const syncLabel = !current ? "동기화 상태 확인 중" : current.error ? "동기화 보류" : current.syncing ? "동기화 중" : current.connected ? "온라인" : "오프라인";
  const retry = () => {
    setRequestError(false);
    // The normal v2 loop publishes fresh status; never initialize/delete data.
    IpcSender.syncV2.retry(({ success }) => {
      if (!success) setRequestError(true);
    });
  };

  return (
    <div className="settings data-settings">
      <div className="data-settings__overview">
        <section className="setting-item data-settings__card">
          <div className="head">
            <h3 className="label">데이터 보호</h3>
            <span className="data-settings__badge">{current?.protocolVersion === 3 ? "보호 중" : current ? "Sync v2" : "확인 중"}</span>
          </div>
          <div className="body">
            {current?.protocolVersion === 3 ? <p>현재 할 일은 이 기기에서 암호화되어 v3로 동기화됩니다.</p> : current ? <><p>현재 동기화 방식은 Sync v2이며, v3 암호화는 아직 적용되지 않았습니다.</p>
              <p>서버 운영자는 저장된 할 일 내용을 조회할 수 있습니다. 기기 잠금이나 HTTPS 연결만으로 서버에서 내용을 읽지 못하게 되는 것은 아닙니다.</p></> : <p>데이터 보호 상태를 확인하고 있습니다.</p>}
            <details className="data-settings__details"><summary>이전 데이터에 대한 안내</summary><p>v3 전환 후에도 이전 평문 백업과 로그의 정리 여부는 별도로 확인해야 합니다.</p></details>
          </div>
        </section>
        <section className="setting-item data-settings__card sync-status" role="status">
          <div className="head">
            <h3 className="label">동기화 상태</h3>
            <span className={"data-settings__badge" + (current?.error || !current?.connected ? " data-settings__badge--quiet" : "")}>{syncLabel}</span>
          </div>
          <div className="body">
            <div className="sync-summary">
              <div className="sync-summary__metrics">
                <div><span>미전송 변경: {current?.pending ?? "—"}개</span></div>
                <div><span>마지막 반영 번호: {current?.seq ?? "—"}</span></div>
              </div>
              {current?.error && <div className="sync-summary__message">{current.error}</div>}
              {recoveryCount > 0 && <div className="sync-summary__message">복구 검토: {recoveryCount}개</div>}
            </div>
            {requestError && <div className="data-settings__error" role="alert">동기화 상태를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.</div>}
            <p className="data-settings__note">반영 번호는 할 일 개수가 아닌 서버 변경 순서입니다. 다시 동기화해도 미전송 변경은 삭제되지 않습니다.</p>
            <button className="data-settings__secondary" disabled={preview || !current?.canSync || current?.syncing} onClick={retry}>다시 동기화</button>
          </div>
        </section>
      </div>
      <section className="setting-item data-settings__manage">
        <div className="head"><h3 className="label">데이터 관리</h3></div>
        <div className="body">
          <p>복구 자료, 기기 연결, 암호화 백업 등을 관리합니다.</p>
          <button className="data-settings__primary" onClick={() => setShowVault(value => !value)}>{showVault ? "관리 메뉴 닫기" : "관리 메뉴 열기"}</button>
          {showVault && <div className="data-settings__vault"><VaultWorkspace key={uid} uid={uid} preview={preview} onLocked={() => modalRef?.current?.close()} /></div>}
        </div>
      </section>
    </div>
  );
};

export default SettingData;
