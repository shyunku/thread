import { useEffect, useRef, useState } from "react";
import { SettingsButton } from "../SettingsUI";
import StepDialog, { AuthAction, Callout } from "./StepDialog";
import FileAddDeviceDialog from "./FileAddDeviceDialog";
import { vaultCall } from "./vaultIpc";

const POLL_MS = 2000;
const relay = (action, input) => vaultCall("relay", action, input);

function Sas({ code }) {
  return <div className="step-dialog__sas">{code ? `${code.slice(0, 3)} ${code.slice(3)}` : "··· ···"}</div>;
}

// Approving a new device from this (owner) device through the server relay
// (v3-relay-pairing.md): wait for the new device, compare the 6-digit code, approve.
// The QR/file flow stays available behind "QR·파일로 연결".
export default function AddDeviceDialog({ vaultCode, osAvailable = false, onClose, onChanged }) {
  const [mode, setMode] = useState("relay");
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState({ phase: "STARTING" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = useRef(true);
  const done = useRef(false);
  const inflight = useRef(null);
  const acting = useRef(false);

  // Start a session when the dialog opens; cancel it when the dialog goes away unfinished.
  useEffect(() => {
    if (mode !== "relay") return undefined;
    live.current = true;
    setView({ phase: "STARTING" });
    setError("");
    inflight.current = relay("ownerStart");
    inflight.current.then((next) => { if (live.current) setView(next); })
      .catch(() => { if (live.current) setError("연결을 시작하지 못했어요. 인터넷 연결을 확인해 주세요."); });
    return () => {
      live.current = false;
      if (!done.current) relay("cancel").catch(() => {});
    };
  }, [mode, attempt]);

  const waiting = mode === "relay" && !error && ["WAITING", "COMPARE"].includes(view.phase);
  useEffect(() => {
    if (!waiting) return undefined;
    let timer = null;
    let stopped = false;
    const tick = async () => {
      if (!acting.current) {
        try {
          inflight.current = relay("ownerPoll");
          const next = await inflight.current;
          if (stopped || !live.current) return;
          setView(next);
        } catch {
          if (stopped || !live.current) return;
          setError("새 기기와 연결하지 못했어요. 새 기기에서 다시 시도해 주세요.");
          return;
        }
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [waiting]);

  const approve = async (auth) => {
    acting.current = true;
    setBusy(true);
    setError("");
    try {
      await inflight.current?.catch(() => {});
      const next = await relay("ownerApprove", auth);
      if (!live.current) return;
      done.current = true;
      setView(next);
      onChanged?.();
    } catch {
      if (live.current) setError("승인하지 못했어요. 본인 확인이 취소됐거나 요청이 만료됐을 수 있어요.");
    } finally {
      acting.current = false;
      if (live.current) setBusy(false);
    }
  };
  const restart = () => setAttempt((value) => value + 1);

  if (mode === "file") return <FileAddDeviceDialog vaultCode={vaultCode} osAvailable={osAvailable} onClose={onClose} onChanged={onChanged} />;

  const phase = view.phase;
  const step = phase === "DONE" ? 3 : phase === "COMPARE" ? 2 : 1;
  const labels = { 1: "새 기기 기다리기", 2: "숫자 비교", 3: "완료" };
  const expired = ["EXPIRED", "CANCELLED"].includes(phase);
  const minutes = view.expiresAt ? Math.max(0, Math.ceil((view.expiresAt - Date.now()) / 60000)) : null;
  const fileLink = <SettingsButton variant="link" disabled={busy} onClick={() => setMode("file")}>QR·파일로 연결</SettingsButton>;

  const footer = step === 3 ? (
    <><span /><SettingsButton variant="primary" onClick={onClose}>완료</SettingsButton></>
  ) : step === 2 && !expired ? (
    <>
      <SettingsButton variant="ghost" disabled={busy} onClick={onClose}>다른 숫자예요</SettingsButton>
      <AuthAction osAvailable={osAvailable} verb="승인" busy={busy} onRun={approve} />
    </>
  ) : (
    <>{fileLink}{error || expired
      ? <SettingsButton variant="primary" onClick={restart}>다시 시작</SettingsButton>
      : <SettingsButton variant="ghost" onClick={onClose}>취소</SettingsButton>}</>
  );

  return (
    <StepDialog title="새 기기 추가" step={step} total={3} stepLabel={labels[step]} footer={footer} onClose={onClose} closable={!busy}>
      {step === 1 && !expired && (
        <>
          <p>새 기기에서 Thread에 같은 계정으로 로그인한 뒤 <b>쓰던 기기로 연결</b>을 누르세요.</p>
          <div className="step-dialog__waiting" role="status"><span className="step-dialog__spinner" aria-hidden="true" />
            {phase === "STARTING" ? "준비하는 중…" : "새 기기를 기다리는 중…"}<span className="step-dialog__muted"> · 10분 동안</span></div>
        </>
      )}
      {step === 2 && !expired && (
        <>
          <p>새 기기 화면에도 <b>같은 숫자</b>가 보이나요?</p>
          <Sas code={view.code} />
          <p className="step-dialog__list step-dialog__center">
            새 기기 · {view.role === "read" ? "보기만 가능" : "편집 가능"}{minutes != null ? ` · ${minutes}분 뒤 만료` : ""}
          </p>
          <Callout tone="info">숫자가 다르면 승인하지 마세요. 누군가 연결을 가로채려는 것일 수 있어요.</Callout>
        </>
      )}
      {expired && <Callout>새 기기가 연결을 취소했거나 10분이 지나 요청이 만료됐어요.</Callout>}
      {step === 3 && (
        <>
          <p className="ok">✓ 새 기기를 추가했어요.</p>
          <p>새 기기가 데이터를 받아오기 시작했어요. 기기 목록에서 언제든 해제할 수 있어요.</p>
        </>
      )}
      {error && <Callout tone="danger">{error}</Callout>}
    </StepDialog>
  );
}
