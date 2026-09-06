import "./Data.settings.scss";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { accountInfoSlice } from "../../store/accountSlice";
import IpcSender from "../../utils/IpcSender";

const SettingData = () => {
  const { uid } = useSelector(accountInfoSlice);
  const [status, setStatus] = useState(null);
  const [requestError, setRequestError] = useState(false);

  useEffect(() => {
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
  }, [uid]);

  const current = status?.uid === uid ? status : null;
  const retry = () => {
    setRequestError(false);
    // The normal v2 loop publishes fresh status; never initialize/delete data.
    IpcSender.syncV2.retry(({ success }) => {
      if (!success) setRequestError(true);
    });
  };

  return (
    <div className="settings">
      <div className="setting-item sync-status">
        <div className="head"><div className="label">동기화 상태</div></div>
        <div className="body">
          <div className="sync-summary" role="status">
            <div>{!current ? "동기화 상태 확인 중" : current.error ? "동기화 보류" : current.syncing ? "동기화 중" : current.connected ? "온라인" : "오프라인"}</div>
            <div>미전송 변경: {current?.pending ?? "—"}개</div>
            <div>마지막 반영 번호: {current?.seq ?? "—"}</div>
            {current?.error && <div>{current.error}</div>}
            {current?.recovery?.length > 0 && <div>복구 검토: {current.recovery.length}개</div>}
          </div>
          {requestError && <div role="alert">동기화 상태를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.</div>}
          <div className="controller">
            <div className="description">
              반영 번호는 태스크 개수가 아닌 서버 변경 순서입니다. 재동기화는 기존 데이터와 미전송 변경을 삭제하지 않습니다.
            </div>
            <button disabled={!current?.canSync || current?.syncing} onClick={retry}>다시 동기화</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingData;
