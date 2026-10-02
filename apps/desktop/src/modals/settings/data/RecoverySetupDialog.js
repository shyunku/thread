import { useEffect, useRef, useState } from "react";
import { SettingsButton, SettingsCard, SettingsRow } from "../SettingsUI";
import StepDialog, { Callout } from "./StepDialog";
import { vaultCall } from "./vaultIpc";

// First recovery key for this account: save the encrypted file, keep the code, then confirm both.
// Copying uses main's clipboard helper, which clears the code after 30 seconds.
export default function RecoverySetupDialog({ onClose, onChanged }) {
  const [step, setStep] = useState(1);
  const [fileSaved, setFileSaved] = useState(false);
  const [preview, setPreview] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef(null);
  const live = useRef(true);
  const pending = useRef(false);
  useEffect(() => () => { live.current = false; }, []);

  const run = async (task) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try { await task(); }
    catch (failure) {
      if (live.current) setError(failure.message === "RECOVERY_FILE_EXISTS"
        ? "같은 이름의 파일이 이미 있어요. 기존 파일은 그대로 두었어요. 다른 이름으로 저장해 주세요."
        : "복구 키를 확인하지 못했어요. 파일과 코드를 다시 확인해 주세요. 기존 데이터는 바뀌지 않았어요.");
    }
    finally { pending.current = false; if (live.current) setBusy(false); }
  };
  const saveFile = () => run(async () => {
    if (!(await vaultCall("prepareIdentity"))) throw Error("RECOVERY_FAILED");
    if ((await vaultCall("exportRecovery")) !== true) return; // dialog cancelled
    if (!live.current) return;
    setFileSaved(true);
    const value = await vaultCall("recoveryCodePreview");
    if (live.current) setPreview(value);
  });
  const copyCode = () => run(async () => {
    await vaultCall("copyRecoveryCode");
    if (live.current) setCopied(true);
  });
  const confirm = () => run(async () => {
    const value = input.current?.value || "";
    if (input.current) input.current.value = "";
    const next = await vaultCall("confirmRecovery", value);
    if (!live.current || !next) return;
    if (next.phase === "RECOVERY_CONFIRMED") { setStep(3); onChanged?.(); }
  });

  const labels = { 1: "파일과 코드 저장", 2: "복구 키 확인", 3: "완료" };
  const footer = step === 1 ? (
    <><SettingsButton variant="ghost" disabled={busy} onClick={onClose}>나중에</SettingsButton>
      <SettingsButton variant="primary" disabled={busy || !fileSaved || !copied} onClick={() => setStep(2)}>저장했어요</SettingsButton></>
  ) : step === 2 ? (
    <><SettingsButton variant="ghost" disabled={busy} onClick={() => setStep(1)}>이전</SettingsButton>
      <SettingsButton variant="primary" disabled={busy} onClick={confirm}>{busy ? "확인 중…" : "파일 열어 확인"}</SettingsButton></>
  ) : (
    <><span /><SettingsButton variant="primary" onClick={onClose}>완료</SettingsButton></>
  );

  return (
    <StepDialog title="복구 키" step={step} total={3} stepLabel={labels[step]} footer={footer} onClose={onClose} closable={!busy}>
      {step === 1 && (
        <>
          <p>모든 기기를 잃었을 때 데이터를 되찾는 데 필요해요. 로그인 비밀번호와는 별개예요. 파일과 코드를 <b>서로 다른 곳</b>에 보관하세요.</p>
          <SettingsCard>
            <SettingsRow label="복구 파일" description={fileSaved ? "저장했어요" : "thread_recovery.trec"}>
              <SettingsButton disabled={busy} onClick={saveFile}>{fileSaved ? "다시 저장" : "저장"}</SettingsButton>
            </SettingsRow>
            <SettingsRow label="복구 코드" description={preview || "파일을 저장하면 표시돼요"}>
              <SettingsButton disabled={busy || !fileSaved} onClick={copyCode}>{copied ? "복사했어요" : "복사"}</SettingsButton>
            </SettingsRow>
          </SettingsCard>
          <p className="step-dialog__list">복사한 코드는 30초 뒤 클립보드에서 지워져요.</p>
        </>
      )}
      {step === 2 && (
        <>
          <p>보관한 복구 코드를 입력하세요. 이어서 저장한 복구 파일을 열어 맞는지 확인해요.</p>
          <input ref={input} className="step-dialog__input" type="password" aria-label="복구 코드" placeholder="THREAD1-…"
            autoComplete="off" maxLength={128} disabled={busy} />
        </>
      )}
      {step === 3 && <p className="ok">✓ 복구 키를 확인했어요.</p>}
      {error && <Callout tone="danger">{error}</Callout>}
    </StepDialog>
  );
}
