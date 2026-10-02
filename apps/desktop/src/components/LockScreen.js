import { useEffect, useRef, useState } from "react";
import { IoLockClosedOutline } from "react-icons/io5";
import PasswordField from "./PasswordField";
import { osAuthLabel } from "../modals/settings/data/format";
import "./LockScreen.scss";

// Compact unlock screen (#74): OS authentication first, password on request.
export default function LockScreen({ osAvailable = false, passwordAvailable = true, onOSUnlock, onPasswordUnlock }) {
  const [usePassword, setUsePassword] = useState(!osAvailable && passwordAvailable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const password = useRef(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => { if (usePassword) password.current?.focus?.(); }, [usePassword]);

  const run = async (method) => {
    if (pending.current) return;
    const value = method === "password" ? password.current?.value || "" : "";
    if (method === "password" && !value) { setError("비밀번호를 입력해 주세요."); return; }
    pending.current = true;
    setBusy(true);
    setError("");
    if (password.current) password.current.value = "";
    try {
      const action = method === "os" ? onOSUnlock : onPasswordUnlock;
      if (typeof action !== "function" || (await (method === "os" ? action() : action(value))) !== true) throw Error("UNVERIFIED_UNLOCK");
    } catch {
      if (mounted.current) setError(method === "os"
        ? `본인 확인이 취소됐어요.${passwordAvailable ? " 비밀번호로도 열 수 있어요." : ""}`
        : "비밀번호가 맞지 않아요.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <section className="lock-screen" aria-labelledby="lock-screen-title">
      <div className="lock-screen__icon" aria-hidden="true"><IoLockClosedOutline /></div>
      <h1 id="lock-screen-title">Thread가 잠겼어요</h1>
      <p>다시 열려면 본인 확인이 필요해요.</p>
      {!osAvailable && !passwordAvailable ? (
        <p className="lock-screen__error" role="alert">이 기기에서 열 수 있는 방법이 없어요. 복구가 필요해요.</p>
      ) : usePassword ? (
        <form className="lock-screen__form" onSubmit={(event) => { event.preventDefault(); void run("password"); }}>
          <PasswordField ref={password} id="lock-password" label="비밀번호" placeholder="비밀번호" maxLength={256}
            disabled={busy} autoComplete="current-password" required />
          <button type="submit" className="lock-screen__primary" disabled={busy}>{busy ? "확인 중…" : "열기"}</button>
        </form>
      ) : (
        <button type="button" className="lock-screen__primary" disabled={busy} onClick={() => void run("os")}>
          {busy ? "확인 중…" : `${osAuthLabel()}로 열기`}
        </button>
      )}
      {osAvailable && passwordAvailable && (
        <button type="button" className="lock-screen__switch" disabled={busy}
          onClick={() => { setError(""); setUsePassword((value) => !value); }}>
          {usePassword ? `${osAuthLabel()}로 열기` : "비밀번호로 열기"}
        </button>
      )}
      {error && <p className="lock-screen__error" role="alert">{error}</p>}
    </section>
  );
}
