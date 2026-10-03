import { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { IoDesktopOutline, IoKeyOutline } from "react-icons/io5";
import { accountInfoSlice, removeAccount, removeAuth } from "../../store/accountSlice";
import IpcSender from "../../utils/IpcSender";
import { vaultCall } from "../../modals/settings/data/vaultIpc";
import DevicePairing from "../DevicePairing";
import { ChoiceCard, GateButton, GateLink, GateStep } from "./GateFlow";
import LockMethodStep from "./LockMethodStep";
import RecoveryConnect from "./RecoveryConnect";
import RelayConnect from "./RelayConnect";

// "이 기기에서 데이터 열기": a logged-in account whose data lives in a vault this
// device is not part of yet. Connect through an existing device or recover with the code.
export default function DeviceConnect({ onConnected }) {
  const account = useSelector(accountInfoSlice);
  const dispatch = useDispatch();
  const [status, setStatus] = useState(null);
  const [screen, setScreen] = useState("start");
  const [loggingOut, setLoggingOut] = useState(false);

  const loadStatus = useCallback(() => vaultCall("status").then(setStatus).catch(() => setStatus({ phase: "UNKNOWN" })), []);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  const name = account?.username || account?.googleEmail || account?.authId || "내 계정";
  // Same as the account settings logout: forget this device's tokens, then return to login.
  const logout = async () => {
    setLoggingOut(true);
    try {
      await IpcSender.req.auth.deleteAuthInfoSync(account?.uid);
      dispatch(removeAuth());
      dispatch(removeAccount());
    } catch {
      setLoggingOut(false);
    }
  };

  if (screen === "relay-lock") {
    return <LockMethodStep kicker="쓰던 기기로 연결" step={1} total={4} osAvailable={!!status?.osAvailable}
      onBack={() => setScreen("start")} onCreated={() => { loadStatus(); setScreen("relay"); }} />;
  }
  if (screen === "relay") {
    return <RelayConnect onBack={() => setScreen("start")} onOther={() => setScreen("other")} onConnected={onConnected} />;
  }
  if (screen === "recovery") {
    return <RecoveryConnect status={status} onBack={() => setScreen("start")} onConnected={onConnected} onLockCreated={loadStatus} />;
  }
  if (screen === "other") {
    return (
      <GateStep kicker="쓰던 기기로 연결 · 다른 방법" title="QR·파일로 연결" label="서버로 연결할 수 없을 때 써요"
        footer={<><GateButton variant="ghost" onClick={() => setScreen("relay")}>이전</GateButton>
          <GateButton variant="primary" onClick={onConnected}>연결 확인 후 계속</GateButton></>}>
        <p>쓰던 기기의 <b>설정 → 데이터 → 새 기기 추가 → QR·파일로 연결</b>에 보이는 연결 코드를 입력한 뒤, 요청 QR이나 요청 파일을 쓰던 기기로 옮기세요. 쓰던 기기가 승인하며 저장한 승인 파일을 이 기기에서 열면 끝나요.</p>
        <DevicePairing osAvailable={!!status?.osAvailable} />
      </GateStep>
    );
  }

  const ready = status && status.phase !== "UNKNOWN";
  const startRelay = () => setScreen(status?.phase === "ABSENT" ? "relay-lock" : "relay");
  return (
    <section className="gate-start" aria-labelledby="gate-start-title">
      <div className="gate-start__icon" aria-hidden="true"><IoDesktopOutline /></div>
      <h1 id="gate-start-title">이 기기에서 데이터 열기</h1>
      <p>이 계정의 데이터는 암호화돼 있어요. 이 기기에서 열려면 쓰던 기기의 승인이나 복구 코드가 필요해요.</p>
      <div className="gate-start__account">
        <span className="gate-start__avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <span>{name} · 로그인됨</span>
      </div>
      <ChoiceCard icon={<IoDesktopOutline />} title="쓰던 기기로 연결" badge="추천" disabled={!ready}
        description="Thread를 쓰고 있는 다른 기기에서 이 기기를 승인해요." onClick={startRelay} />
      <ChoiceCard icon={<IoKeyOutline />} title="복구 코드로 연결" disabled={!ready}
        description="쓰던 기기를 모두 잃었을 때만 써요. 다른 기기의 연결은 모두 해제돼요." onClick={() => setScreen("recovery")} />
      {status?.phase === "UNKNOWN" && <p className="gate-muted">이 기기의 상태를 확인하지 못했어요. 앱을 다시 열어 주세요.</p>}
      <div className="gate-start__bottom">
        <GateLink disabled={loggingOut} onClick={logout}>다른 계정으로 로그인</GateLink>
      </div>
    </section>
  );
}
