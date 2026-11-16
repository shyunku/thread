import { useEffect, useRef, useState } from "react";
import { IoLockClosedOutline } from "react-icons/io5";
import ConfirmDialog from "../../../molecules/pickers/ConfirmDialog";
import { SettingsCard, SettingsRow, SettingsSection, Skeleton, Toggle } from "../SettingsUI";
import { osAuthLabel } from "./format";
import { vaultCall } from "./vaultIpc";

export const LOCK_SKIP_LABEL = "앱을 다시 켤 때 잠금 화면 건너뛰기";
export const LOCK_SKIP_DESC = "이 PC에서는 본인 확인 없이 바로 열려요. 비밀 카테고리 잠금 설정은 별개예요.";
const BUSY = "잠시 뒤에 다시 해 주세요.";
const FAILED = "설정을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.";

// 설정 > 데이터 및 보안 > 앱 잠금 (#111 mock dataPage .set-lock). This account's setting on this PC
// (a mark in its vault folder, main): turning it on confirms the user once in main (Windows
// Hello, or the vault password when the vault has no OS check), turning it off asks nothing. A
// lock by hand still keeps the next start locked (main).
export default function LockSkipSection({ vault, preview = false }) {
  const [on, setOn] = useState(preview ? false : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ask, setAsk] = useState(null); // { error } while the password dialog is open
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => {
    if (preview) return;
    vaultCall("skipLock", "get", {}).then((data) => { if (live.current) setOn(!!data?.skipLockOnStart); }).catch(() => { if (live.current) setOn(false); });
  }, [preview]);

  const turnOff = () => {
    setError("");
    if (preview) return setOn(false);
    setBusy(true);
    vaultCall("skipLock", "off", {}).then((data) => { if (live.current) setOn(!!data?.skipLockOnStart); })
      .catch(() => { if (live.current) setError(FAILED); })
      .finally(() => { if (live.current) setBusy(false); });
  };

  // The check in main; a refusal is an answer ({ verified: false, code }).
  const confirm = async (input) => {
    setBusy(true);
    setError("");
    const answer = await vaultCall("skipLock", "on", input).catch(() => null);
    if (!live.current) return null;
    setBusy(false);
    if (answer?.verified) {
      setOn(true);
      setAsk(null);
    }
    return answer;
  };

  const askPassword = (message) => setAsk({ error: message });
  const turnOn = async () => {
    setError("");
    if (preview) return setOn(true);
    const os = !!vault?.osAvailable, password = !!vault?.passwordAvailable;
    if (!os) {
      if (password) askPassword("");
      else setError(FAILED);
      return;
    }
    const answer = await confirm({ method: "os" });
    if (!answer || answer.verified) {
      if (!answer) setError(FAILED);
      return;
    }
    const code = answer.code || "";
    if (code === "OS_AUTH_CANCELLED") return;
    if (code === "BUSY" || code === "OS_AUTH_BUSY") return setError(BUSY);
    // A failed OS check falls back to the vault password when there is one.
    if (answer.passwordAvailable ?? password) askPassword(`${osAuthLabel()}로 확인하지 못했어요. 보관함 비밀번호를 입력해 주세요.`);
    else setError(`${osAuthLabel()}로 확인하지 못했어요.`);
  };

  const submitPassword = async (_, value) => {
    const answer = await confirm({ method: "password", password: value ?? "" });
    if (!answer) return setAsk({ error: FAILED });
    if (answer.verified) return;
    setAsk({ error: answer.code === "BUSY" ? BUSY : "보관함 비밀번호가 맞지 않아요." });
  };

  return (
    <SettingsSection title="앱 잠금">
      <SettingsCard className="data-lock">
        <SettingsRow icon={<IoLockClosedOutline />} label={LOCK_SKIP_LABEL} description={LOCK_SKIP_DESC}>
          {on === null ? <Skeleton width={38} height={22} />
            : <Toggle label={LOCK_SKIP_LABEL} checked={on} disabled={busy} onChange={(next) => (next ? turnOn() : turnOff())} />}
        </SettingsRow>
      </SettingsCard>
      {error && <p className="settings-error" role="alert">{error}</p>}
      {ask && (
        <ConfirmDialog
          icon={<IoLockClosedOutline size={26} />}
          title="잠금 화면 건너뛰기를 켤까요?"
          body="보관함 비밀번호로 본인 확인을 해요. 켜면 이 PC에서는 앱을 다시 켤 때 본인 확인 없이 바로 열려요."
          input={{ type: "password", label: "보관함 비밀번호", placeholder: "보관함 비밀번호" }}
          busy={busy}
          error={ask.error}
          choices={[{ id: "confirm", label: "켜기" }]}
          onChoose={submitPassword}
          onCancel={() => { if (!busy) setAsk(null); }}
        />
      )}
    </SettingsSection>
  );
}
