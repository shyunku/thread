import { useEffect, useRef, useState } from "react";
import IpcSender from "../../../utils/IpcSender";
import { SettingsButton, SettingsCard, SettingsRow } from "../SettingsUI";
import StepDialog, { AuthAction, Callout, Code } from "./StepDialog";
import { vaultAction } from "./vaultIpc";
import { shortDeviceId } from "./format";

const FAILED = "처리하지 못했어요. 연결과 본인 확인을 확인한 뒤 다시 시도해 주세요. 기존 데이터와 복구 키는 그대로예요.";
const PENDING = ["RECOVERY_UNCONFIRMED", "RECOVERY_CONFIRMED", "COMMITTING"];
const stepFor = (phase) => (phase === "RECOVERY_UNCONFIRMED" ? 2 : PENDING.includes(phase) ? 3 : 1);

// Removing a device and making a new recovery key are the same key rotation:
// prepare -> save new recovery key -> confirm it -> commit -> re-protect existing data.
export default function KeyChangeDialog({ mode = "renew", device = null, osAvailable = false, resumePhase = null, onClose, onChanged }) {
  const removing = mode === "remove" && device;
  const title = removing ? "기기 해제" : "복구 키 새로 만들기";
  const [step, setStep] = useState(stepFor(resumePhase));
  const [phase, setPhase] = useState(resumePhase);
  const [consent, setConsent] = useState(false);
  const [applyConsent, setApplyConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileSaved, setFileSaved] = useState(false);
  const [code, setCode] = useState("");
  const [codeSeen, setCodeSeen] = useState(false);
  const [reencryption, setReencryption] = useState(null);
  const confirmation = useRef(null);
  const live = useRef(true);
  const pending = useRef(false);

  useEffect(() => () => { live.current = false; }, []);
  // The new recovery code is shown for 30 seconds only.
  useEffect(() => {
    if (!code) return undefined;
    const timer = setTimeout(() => setCode(""), 30000);
    const hide = () => setCode("");
    window.addEventListener("blur", hide);
    return () => { clearTimeout(timer); window.removeEventListener("blur", hide); };
  }, [code]);

  const run = async (task) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try { await task(); }
    catch { if (live.current) setError(FAILED); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  };

  const prepare = (auth) => run(async () => {
    const result = await vaultAction("rotation", "prepare", { remove: removing ? [device.id] : [], confirmed: true, ...auth });
    if (!live.current) return;
    setPhase(result?.phase);
    setStep(2);
  });
  const saveFile = () => run(async () => {
    const saved = await vaultAction("rotation", "export");
    if (live.current && saved) setFileSaved(true);
  });
  const showCode = () => run(async () => {
    const value = await vaultAction("rotation", "code");
    if (!live.current) return;
    setCode(value);
    setCodeSeen(true);
  });
  const startReencryption = async () => {
    // Commit closes the sync session; one verified sync is needed before re-protecting data.
    // Do not wait forever if the sync reply never arrives; start retries below anyway.
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000);
      const done = () => { clearTimeout(timer); resolve(); };
      if (IpcSender.syncV2?.retry) IpcSender.syncV2.retry(done); else done();
    });
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const status = await vaultAction("reencryption", "start", { confirmed: true });
        if (live.current) setReencryption(status);
        return;
      } catch (failure) {
        lastError = failure;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    if (live.current) setReencryption({ phase: "START_FAILED", error: lastError?.message });
  };
  const apply = (auth) => run(async () => {
    let next = phase;
    if (next !== "COMMITTING" && next !== "RECOVERY_CONFIRMED") {
      const value = confirmation.current?.value || "";
      if (confirmation.current) confirmation.current.value = "";
      const confirmed = await vaultAction("rotation", "confirm", { code: value });
      if (!confirmed) return; // file dialog cancelled
      next = confirmed.phase;
      if (live.current) setPhase(next);
    }
    const committed = await vaultAction("rotation", "commit", { confirmed: true, ...auth });
    if (!live.current) return;
    setPhase(committed?.phase);
    setStep(4);
    onChanged?.();
    void startReencryption();
  });
  const cancelRotation = () => run(async () => {
    await vaultAction("rotation", "cancel");
    if (live.current) { onChanged?.(); onClose(); }
  });

  // Follow re-protection progress while the dialog is open.
  useEffect(() => {
    if (step !== 4 || !reencryption || ["DONE", "CANCELLED", "START_FAILED"].includes(reencryption.phase)) return undefined;
    const timer = setInterval(() => {
      vaultAction("reencryption", "status").then((value) => { if (live.current && value) setReencryption(value); }).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [step, reencryption]);

  const steps = { 1: "영향 확인", 2: "새 복구 키 저장", 3: "확인하고 적용", 4: "완료" };
  const footer = step === 1 ? (
    <>
      <SettingsButton variant="ghost" onClick={onClose}>취소</SettingsButton>
      <AuthAction osAvailable={osAvailable} verb="계속" busy={busy} disabled={!consent} onRun={prepare} />
    </>
  ) : step === 2 ? (
    <>
      <SettingsButton variant="ghost" disabled={busy} onClick={cancelRotation}>교체 취소</SettingsButton>
      <SettingsButton variant="primary" disabled={busy || !fileSaved || !codeSeen} onClick={() => { setCode(""); setStep(3); }}>저장했어요</SettingsButton>
    </>
  ) : step === 3 ? (
    <>
      {phase === "COMMITTING" ? <span /> : <SettingsButton variant="ghost" disabled={busy} onClick={() => setStep(2)}>이전</SettingsButton>}
      <AuthAction osAvailable={osAvailable} verb={removing ? "해제" : "적용"} busy={busy} disabled={!applyConsent} onRun={apply} />
    </>
  ) : (
    <><span /><SettingsButton variant="primary" onClick={onClose}>닫기</SettingsButton></>
  );

  return (
    <StepDialog title={title} step={step} total={4} stepLabel={removing && step === 1 ? `다른 기기 · ${shortDeviceId(device.id)}` : steps[step]}
      footer={footer} onClose={onClose} closable={!busy}>
      {step === 1 && (
        <>
          {removing ? (
            <>
              <p>이 기기는 앞으로 새로 바뀐 데이터를 받지 못합니다.</p>
              <Callout>이미 그 기기에 있는 데이터는 지울 수 없어요. 잃어버린 기기라면 해제한 뒤 계정 비밀번호도 바꾸세요.</Callout>
            </>
          ) : (
            <p>데이터를 지키는 열쇠를 새로 바꾸고, 새 복구 키를 받습니다. 연결된 기기는 그대로 유지돼요.</p>
          )}
          <p>진행하면 <b>새 복구 키</b>를 함께 저장해야 하고, 지금 가진 복구 키는 더 이상 쓸 수 없어요.</p>
          <label className="step-dialog__check">
            <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />
            이해했어요. 새 복구 키를 안전하게 보관할게요.
          </label>
        </>
      )}
      {step === 2 && (
        <>
          <p>파일과 코드를 <b>서로 다른 곳</b>에 보관하세요. 복원할 때 둘 다 필요해요.</p>
          <SettingsCard>
            <SettingsRow label="복구 파일" description={fileSaved ? "저장했어요" : "Thread-rotated.trec"}>
              <SettingsButton disabled={busy} onClick={saveFile}>{fileSaved ? "다시 저장" : "저장"}</SettingsButton>
            </SettingsRow>
            <SettingsRow label="복구 코드" description={code ? "30초 뒤 가려져요" : codeSeen ? "확인했어요" : "적어서 따로 보관하세요"}>
              <SettingsButton disabled={busy} onClick={showCode}>{codeSeen ? "다시 보기" : "보기"}</SettingsButton>
            </SettingsRow>
          </SettingsCard>
          {code && <div className="step-dialog__list"><Code size="small">{code}</Code></div>}
        </>
      )}
      {step === 3 && (
        <>
          {phase === "COMMITTING" ? (
            <p>지난번 적용 결과를 아직 확인하지 못했어요. 다시 확인합니다.</p>
          ) : phase === "RECOVERY_CONFIRMED" ? (
            <p>새 복구 키를 확인했어요. 적용하면 교체가 끝나요.</p>
          ) : (
            <>
              <p>방금 보관한 복구 코드를 입력하세요. 이어서 저장한 복구 파일을 열어 맞는지 확인해요.</p>
              <input ref={confirmation} className="step-dialog__input" type="password" aria-label="새 복구 코드"
                placeholder="THREAD1-…" autoComplete="off" maxLength={128} disabled={busy} />
            </>
          )}
          <label className="step-dialog__check">
            <input type="checkbox" checked={applyConsent} disabled={busy} onChange={(event) => setApplyConsent(event.target.checked)} />
            {removing ? "적용하면 이 기기가 해제되고 이전 복구 키는 쓸 수 없어요." : "적용하면 이전 복구 키는 쓸 수 없어요."}
          </label>
        </>
      )}
      {step === 4 && (
        <>
          <p className="ok">✓ {removing ? `다른 기기 · ${shortDeviceId(device.id)}을 해제했어요.` : "새 복구 키로 바꿨어요."}</p>
          {!reencryption ? <p>기존 데이터를 새 열쇠로 다시 보호할 준비를 하고 있어요…</p>
            : reencryption.phase === "DONE" ? <p>기존 데이터도 새 열쇠로 다시 보호했어요.</p>
            : reencryption.phase === "START_FAILED" || reencryption.phase === "PAUSED" ? (
              <Callout>기존 데이터를 다시 보호하는 작업을 시작하지 못했어요. 데이터 탭에서 다시 시도할 수 있어요.</Callout>
            ) : <p>기존 데이터를 새 열쇠로 다시 보호하고 있어요 · {reencryption.count ?? 0}개 처리. 앱을 계속 사용해도 돼요.</p>}
        </>
      )}
      {error && <Callout tone="danger">{error}</Callout>}
    </StepDialog>
  );
}
