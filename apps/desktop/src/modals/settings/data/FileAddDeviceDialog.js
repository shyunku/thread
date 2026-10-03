import { useEffect, useRef, useState } from "react";
import { readPairingImage } from "../../../utils/pairingQrImage";
import { SettingsButton, CheckCard } from "../SettingsUI";
import StepDialog, { AuthAction, Callout, Code, CopyableCode } from "./StepDialog";
import { vaultAction } from "./vaultIpc";
import { groupCode } from "./format";

const FAILED = "처리하지 못했어요. 요청이 만료됐거나 다른 계정의 요청일 수 있어요. 새 기기에서 요청을 다시 만들어 주세요.";

// Approving a new device from this (owner) device. The new device starts from its own
// connection screen and needs this vault's connection code to create a request.
export default function FileAddDeviceDialog({ vaultCode, osAvailable = false, onClose, onChanged }) {
  const [step, setStep] = useState(1);
  const [request, setRequest] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const live = useRef(true);
  const pending = useRef(false);

  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => {
    if (step !== 3) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [step]);

  const run = async (task) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try { await task(); }
    catch { if (live.current) setError(FAILED); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  };
  const opened = (value) => {
    if (!value || !live.current) return; // dialog cancelled
    setRequest(value);
    setConfirmed(false);
    setStep(3);
  };
  const openFile = () => run(async () => opened(await vaultAction("pairing", "preview")));
  const openImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await run(async () => opened(await vaultAction("pairing", "previewQR", { qr: await readPairingImage(file) })));
  };
  const approve = (auth) => run(async () => {
    const value = await vaultAction("pairing", "approve", { requestId: request.requestId, fingerprint: request.fingerprint, ...auth });
    if (!live.current) return;
    setResult(value);
    setStep(4);
    onChanged?.();
  });
  const minutesLeft = request ? Math.max(0, Math.ceil((request.expiresAt - now) / 60000)) : 0;
  const expired = request && request.expiresAt <= now;

  const labels = { 1: "새 기기에서 연결 시작", 2: "새 기기의 요청 열기", 3: "확인 코드 비교", 4: "완료" };
  const footer = step === 1 ? (
    <><SettingsButton variant="ghost" onClick={onClose}>취소</SettingsButton><SettingsButton variant="primary" onClick={() => setStep(2)}>다음</SettingsButton></>
  ) : step === 2 ? (
    <><SettingsButton variant="ghost" disabled={busy} onClick={() => setStep(1)}>이전</SettingsButton><span /></>
  ) : step === 3 ? (
    <>
      <SettingsButton variant="ghost" disabled={busy} onClick={() => setStep(2)}>이전</SettingsButton>
      <AuthAction osAvailable={osAvailable} verb="승인" busy={busy} disabled={!confirmed || expired} onRun={approve} />
    </>
  ) : (
    <><span /><SettingsButton variant="primary" onClick={onClose}>완료</SettingsButton></>
  );

  return (
    <StepDialog title="QR·파일로 기기 추가" step={step} total={4} stepLabel={labels[step]} footer={footer} onClose={onClose} closable={!busy}>
      {step === 1 && (
        <>
          <p>새 기기에서 Thread에 같은 계정으로 로그인한 뒤 <b>기존 기기로 연결</b>을 고르세요. 새 기기가 아래 연결 코드를 요청하면 입력하거나 붙여 넣으세요.</p>
          <CopyableCode value={vaultCode} display={groupCode(vaultCode)} label="연결 코드 복사" />
          <p>새 기기가 연결 요청 QR이나 요청 파일을 만들면 다음으로 넘어가세요.</p>
        </>
      )}
      {step === 2 && (
        <>
          <p>새 기기 화면의 QR을 이 PC로 가져오거나, 새 기기가 저장한 요청 파일을 여세요.</p>
          <div className="step-dialog__choices">
            <label>
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={openImage} />
              <b>QR 이미지 열기</b><span>새 기기 화면을 캡처한 이미지</span>
            </label>
            <button type="button" disabled={busy} onClick={openFile}>
              <b>요청 파일 열기</b><span>새 기기에서 저장한 연결 요청 파일</span>
            </button>
          </div>
        </>
      )}
      {step === 3 && request && (
        <>
          <p>새 기기 화면에 표시된 확인 코드가 아래와 같은지 비교하세요.</p>
          <Code size="small">{groupCode(request.fingerprint)}</Code>
          <p className="step-dialog__list">권한: {request.role === "read" ? "보기만 가능" : "편집 가능"} · {expired ? "요청이 만료됐어요" : `${minutesLeft}분 뒤 만료`}</p>
          <CheckCard checked={confirmed} disabled={busy || expired} onChange={setConfirmed}>
            새 기기의 코드와 같습니다.
          </CheckCard>
        </>
      )}
      {step === 4 && (
        <>
          <p className="ok">✓ 승인했어요.</p>
          {result?.saved ? (
            <p>저장한 승인 파일을 새 기기로 옮긴 뒤, 새 기기에서 <b>승인 파일 열기</b>를 누르세요.</p>
          ) : (
            <>
              <Callout>승인 파일 저장을 취소했어요. 같은 요청으로 다시 저장할 수 있어요.</Callout>
              <AuthAction osAvailable={osAvailable} verb="다시 저장" busy={busy} onRun={approve} />
            </>
          )}
          <Callout tone="info">승인 파일은 새 기기만 열 수 있도록 암호화되어 있어요.</Callout>
        </>
      )}
      {error && <Callout tone="danger">{error}</Callout>}
    </StepDialog>
  );
}
