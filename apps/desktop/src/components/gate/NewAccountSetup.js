import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { IoCheckmark, IoCopyOutline, IoDocumentOutline, IoShieldCheckmarkOutline } from "react-icons/io5";
import { accountInfoSlice, removeAccount, removeAuth } from "../../store/accountSlice";
import IpcSender from "../../utils/IpcSender";
import { vaultCall } from "../../modals/settings/data/vaultIpc";
import PasswordField from "../PasswordField";
import { GateButton, GateCallout, GateLink, GateStep } from "./GateFlow";
import LockMethodStep from "./LockMethodStep";

const KICKER = "새 데이터 보호 설정";
const STEPS = ["lock", "file", "code", "confirm", "finish"];
const LABEL = { lock: "잠금 방법", file: "복구 파일", code: "복구 코드", confirm: "복구 코드 확인", finish: "시작" };
const CONFIRMED = "RECOVERY_CONFIRMED";

// "새 데이터 보호 설정": a brand-new account. Lock this device, save the recovery file,
// keep the recovery code, prove both by reopening the file, then register and start the
// empty encrypted vault. The recovery material is made once and kept by main, so going
// back never replaces what the saved file holds.
export default function NewAccountSetup({ uid, onContinue }) {
  const account = useSelector(accountInfoSlice);
  const dispatch = useDispatch();
  const [status, setStatus] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [identityError, setIdentityError] = useState(false);
  const [screen, setScreen] = useState("start");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const live = useRef(true);
  const pending = useRef(false);
  const registered = useRef(false);
  const code = useRef(null);

  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const loadIdentity = useCallback(async () => {
    setIdentityError(false);
    try {
      let value = await vaultCall("identityStatus");
      if (!value) value = await vaultCall("prepareIdentity");
      if (live.current) setIdentity(value);
    } catch { if (live.current) setIdentityError(true); }
  }, []);
  const applyStatus = useCallback((value) => {
    if (!live.current) return;
    const mine = value?.enabled !== false && (!value?.uid || value.uid === uid);
    setStatus(mine ? value : { phase: "UNKNOWN" });
    if (mine && value.phase === "UNLOCKED") loadIdentity();
  }, [uid, loadIdentity]);
  const loadStatus = useCallback(() => vaultCall("status").then(applyStatus)
    .catch(() => { if (live.current) setStatus({ phase: "UNKNOWN" }); }), [applyStatus]);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  const confirmed = identity?.phase === CONFIRMED;
  // The code preview and the registration endpoint load when their step opens.
  useEffect(() => {
    if (screen !== "code" || preview || previewError || !identity) return;
    vaultCall("recoveryCodePreview").then((value) => { if (live.current) setPreview(value); })
      .catch(() => { if (live.current) setPreviewError(true); });
  }, [screen, preview, previewError, identity]);
  useEffect(() => {
    if (screen !== "finish" || endpoint) return;
    vaultCall("registrationEndpoint").then((value) => { if (live.current) setEndpoint(value); })
      .catch(() => { if (live.current) setError("register"); });
  }, [screen, endpoint]);

  const go = (next) => { setError(""); setScreen(next); };
  const run = async (task) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try { await task(); }
    catch (failure) { if (live.current) setError(failure.message); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  };

  const saveFile = () => run(async () => {
    if ((await vaultCall("exportRecovery")) !== true) return; // save dialog cancelled
    if (live.current) setSaved(true);
  });
  const copyCode = () => run(async () => {
    await vaultCall("copyRecoveryCode");
    if (live.current) setCopied(true);
  });
  const confirmCode = (event) => {
    event?.preventDefault();
    const value = code.current?.value || "";
    if (!value.trim()) { setError("CODE_REQUIRED"); return; }
    run(async () => {
      if (code.current) code.current.value = "";
      const next = await vaultCall("confirmRecovery", value);
      if (!live.current || !next) return; // file dialog cancelled
      setIdentity(next);
      if (next.phase === CONFIRMED) setScreen("finish");
    });
  };
  // One "시작하기": register this device, then start the empty vault. A retry after a
  // failed start does not register again.
  const start = () => run(async () => {
    if (!endpoint) {
      let value;
      try { value = await vaultCall("registrationEndpoint"); } catch { throw Error("register"); }
      if (live.current) setEndpoint(value);
    }
    if (!registered.current) {
      let result;
      try { result = await vaultCall("registerIdentity"); } catch { throw Error("register"); }
      if (result?.phase === "PAIRING_REQUIRED") throw Error("pairing");
      if (result?.phase !== "REGISTERED") throw Error("register");
      registered.current = true;
    }
    let result;
    try { result = await vaultCall("activateEmpty"); } catch { throw Error("activate"); }
    if (result?.phase !== "ACTIVE") throw Error("activate");
    if (live.current) onContinue?.();
  });

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

  const step = (id) => STEPS.indexOf(id) + 1;
  const head = (id) => ({ kicker: KICKER, step: step(id), total: STEPS.length, label: LABEL[id] });
  const back = (to) => <GateButton variant="ghost" disabled={busy} onClick={() => go(to)}>이전</GateButton>;
  const failure = error && {
    RECOVERY_FILE_EXISTS: "같은 이름의 파일이 이미 있어요. 기존 파일은 바꾸지 않았어요. 다른 이름으로 저장해 주세요.",
    CODE_REQUIRED: "적어 둔 복구 코드를 입력해 주세요.",
    register: "서버 연결을 확인하지 못했어요. 로그인 상태와 연결을 확인하고 다시 시도하세요. 초기화하지 마세요.",
    pairing: "이미 연결된 데이터가 있어요. 쓰던 기기에서 승인하거나 복구 코드와 파일로 연결해 주세요. 기존 연결 정보는 덮어쓰지 않았어요.",
    activate: "새 데이터 저장소를 시작하지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
  }[error];
  const alert = (fallback) => error && <GateCallout tone="danger">{failure || fallback}</GateCallout>;

  if (screen === "lock") {
    return <LockMethodStep kicker={KICKER} step={step("lock")} total={STEPS.length} osAvailable={!!status?.osAvailable}
      description="앱을 열 때 이 방법으로 본인을 확인해요. 나중에 설정에서 바꿀 수 있어요."
      onBack={() => setScreen("start")} onCreated={(value) => { if (value?.phase) applyStatus(value); else loadStatus(); go("file"); }} />;
  }
  const unknown = status?.phase === "UNKNOWN";
  if (screen === "file") {
    const done = saved || confirmed;
    // Recovery material needs the unlocked vault; if its status could not be read, offer a retry.
    const retry = unknown ? () => { setStatus(null); loadStatus(); } : loadIdentity;
    return (
      <GateStep title="복구 파일 저장" {...head("file")}
        footer={<>{back("start")}<GateButton variant="primary" disabled={busy || !done} onClick={() => go("code")}>다음</GateButton></>}>
        <p>PC를 잃어버렸을 때 데이터를 되찾는 데 쓰는 파일이에요. 로그인 비밀번호와는 별개예요.</p>
        {identity?.recoveryStale && <GateCallout tone="danger">다른 기기에서 복구 자료가 바뀌었어요. 설정의 기기·키 관리에서 새 자료를 준비해 주세요.</GateCallout>}
        {!identity ? (identityError || unknown ? (
          <><GateCallout tone="danger">복구 자료를 준비하지 못했어요. 기존 데이터는 바뀌지 않았어요.</GateCallout>
            <GateButton onClick={retry}>다시 시도</GateButton></>
        ) : <p className="gate-muted" role="status">복구 자료를 준비하고 있어요…</p>) : (
          <div className={`gate-file${done ? " gate-file--done" : ""}`}>
            <span className="gate-file__icon" aria-hidden="true">{done ? <IoCheckmark /> : <IoDocumentOutline />}</span>
            <span className="gate-file__text">
              <b>{done ? "복구 파일을 저장했어요" : "복구 파일"}</b>
              <span>암호화된 파일이에요. USB나 클라우드처럼 이 PC 밖에 두세요.</span>
            </span>
            <GateButton disabled={busy || identity.recoveryStale} onClick={saveFile}>{done ? "다른 곳에 또 저장" : "파일 저장"}</GateButton>
          </div>
        )}
        {alert("복구 파일을 저장하지 못했어요. 다른 위치에 저장해 보세요. 기존 데이터는 바뀌지 않았어요.")}
      </GateStep>
    );
  }
  if (screen === "code") {
    return (
      <GateStep title="복구 코드 저장" {...head("code")}
        footer={<>{back("file")}<GateButton variant="primary" disabled={busy || !(copied || confirmed)} onClick={() => go("confirm")}>적어 뒀어요</GateButton></>}>
        <p>복구 코드는 파일과 <b>다른 곳</b>에 적어 두세요. 되찾을 때 파일과 코드가 둘 다 필요해요.</p>
        <div className="gate-codebox">
          <code>{preview || "···"}</code>
          <GateButton aria-label="복구 코드 복사" disabled={busy || !preview} onClick={copyCode}><IoCopyOutline aria-hidden="true" /> {copied ? "복사됨" : "복사"}</GateButton>
        </div>
        <p className="gate-sub">클립보드는 30초 뒤 비워져요.</p>
        {previewError && !preview && (
          <><GateCallout tone="danger">복구 코드를 불러오지 못했어요. 다시 시도해 주세요. 기존 데이터는 바뀌지 않았어요.</GateCallout>
            <GateButton disabled={busy} onClick={() => setPreviewError(false)}>다시 시도</GateButton></>
        )}
        {alert("복구 코드를 복사하지 못했어요. 다시 시도해 주세요.")}
      </GateStep>
    );
  }
  if (screen === "confirm") {
    return (
      <GateStep title="복구 코드 확인" {...head("confirm")}
        footer={<>{back("code")}{confirmed ? <GateButton variant="primary" disabled={busy} onClick={() => go("finish")}>확인</GateButton>
          : <GateButton variant="primary" type="submit" form="gate-new-account-confirm" disabled={busy}>{busy ? "확인 중…" : "확인"}</GateButton>}</>}>
        {confirmed ? <p className="gate-ok gate-ok--compact">복구 코드와 파일을 확인했어요.</p> : (
          <form id="gate-new-account-confirm" onSubmit={confirmCode}>
            <p>적어 둔 코드를 입력하고, 저장한 복구 파일을 다시 열어서 제대로 저장했는지 확인해요.</p>
            <label className="gate-field gate-field--code"><span>복구 코드</span>
              <PasswordField ref={code} id="gate-new-account-code" label="복구 코드" placeholder="THREAD1-…" maxLength={128} autoComplete="off" spellCheck={false} autoFocus disabled={busy} />
              <small>확인을 누르면 저장한 복구 파일(.trec)을 고르는 창이 열려요.</small>
            </label>
          </form>
        )}
        {alert("복구 코드나 파일이 맞지 않아요. 방금 저장한 파일과 코드인지 확인해 주세요. 기존 데이터는 바뀌지 않았어요.")}
      </GateStep>
    );
  }
  if (screen === "finish") {
    return (
      <GateStep title="준비 끝" {...head("finish")}
        footer={<>{back("confirm")}<GateButton variant="primary" disabled={busy} onClick={start}>{busy ? "시작하는 중…" : "시작하기"}</GateButton></>}>
        <p>잠금 방법과 복구 자료를 준비했어요. 이제 빈 암호화 저장소로 시작해요.</p>
        <p className="gate-sub">시작하면 이 기기의 공개 연결 정보를 서버에 등록해요. 복구 코드와 데이터는 보내지 않아요.</p>
        <GateCallout tone="warning">복구 파일과 복구 코드는 둘 다 있어야 데이터를 되찾을 수 있어요. 한쪽만 있으면 열 수 없어요.</GateCallout>
        {alert("새 데이터 저장소를 시작하지 못했어요. 연결을 확인하고 다시 시도해 주세요.")}
      </GateStep>
    );
  }

  // Resume where an earlier run stopped: the lock exists, maybe the recovery check too.
  const ready = status && !unknown && (status.phase === "ABSENT" || identity || identityError);
  const next = !status || status.phase === "ABSENT" || unknown ? "lock" : confirmed ? "finish" : "file";
  const resumed = next !== "lock";
  const begin = () => go(next);
  return (
    <section className="gate-start" aria-labelledby="gate-start-title">
      <div className="gate-start__icon" aria-hidden="true"><IoShieldCheckmarkOutline /></div>
      <h1 id="gate-start-title">새 데이터 보호 설정</h1>
      <p>새 계정의 할 일은 이 기기에서 암호화된 뒤 동기화돼요. 이 기기의 잠금 방법과, 기기를 잃어버렸을 때 쓸 복구 자료를 준비하면 시작할 수 있어요.</p>
      <div className="gate-start__account">
        <span className="gate-start__avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <span>{name} · 로그인됨</span>
      </div>
      {/* After the lock exists, finished steps are marked and the next one stands out. */}
      <ol className="gate-start__steps" aria-label="설정 단계">{STEPS.map((id) => {
        const state = !resumed ? "" : STEPS.indexOf(id) < STEPS.indexOf(next) ? "done" : id === next ? "here" : "";
        return <li key={id} className={state || undefined}>{LABEL[id]}{state === "done" && <span className="gate-sr"> (끝남)</span>}</li>;
      })}</ol>
      <GateButton variant="primary" className="gate-button--block" disabled={!ready} onClick={begin}>시작하기</GateButton>
      {unknown && <p className="gate-muted" style={{ marginTop: 12 }}>이 기기의 상태를 확인하지 못했어요. 앱을 다시 열어 주세요.</p>}
      <div className="gate-start__bottom">
        <GateLink disabled={loggingOut} onClick={logout}>다른 계정으로 로그인</GateLink>
      </div>
    </section>
  );
}
