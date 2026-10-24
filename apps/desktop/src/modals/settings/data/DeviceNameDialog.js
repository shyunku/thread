import { useState } from "react";
import IpcSender from "../../../utils/IpcSender";
import { SettingsButton } from "../SettingsUI";
import StepDialog from "./StepDialog";

const MESSAGES = {
  DEVICE_NAME_INVALID: "이름은 40자까지, 줄바꿈 같은 특수 문자 없이 써 주세요.",
  DEVICE_NAMES_DISABLED: "아직 이 버전에서는 기기 이름을 바꿀 수 없어요.",
};
const composing = (event) => event.nativeEvent?.isComposing || event.keyCode === 229;

// Rename a connected device (#77, mock frame ③ "기기 이름 바꾸기"). Enter saves, Esc cancels.
// An empty name goes back to the model the device reported (when it is known).
export default function DeviceNameDialog({ device, onClose, onSaved }) {
  const [value, setValue] = useState(device.name || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const typed = value.trim();
  const canSave = !busy && (!!typed || !!device.model);

  const save = () => {
    if (!canSave) return;
    const next = typed || device.model;
    if (next === device.name) return onClose();
    setBusy(true);
    setError(null);
    IpcSender.req.device.setDeviceName(device.id, typed, ({ success, data } = {}) => {
      setBusy(false);
      if (success) onSaved(next);
      else setError(MESSAGES[data?.code] || "이름을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    });
  };

  return (
    <StepDialog title="기기 이름 바꾸기" className="step-dialog--narrow" onClose={onClose}
      footer={<><span /><div className="device-name-dialog__actions">
        <SettingsButton onClick={onClose}>취소</SettingsButton>
        <SettingsButton variant="primary" disabled={!canSave} onClick={save}>{busy ? "저장 중…" : "저장"}</SettingsButton>
      </div></>}>
      <input className="step-dialog__input device-name-dialog__input" aria-label="기기 이름" value={value}
        placeholder={device.model || "기기 이름"} maxLength={40} spellCheck={false} autoComplete="off" disabled={busy}
        aria-invalid={error ? true : undefined}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !composing(event)) { event.preventDefault(); save(); } }} />
      <p className="device-name-dialog__help">
        {device.model ? `비워 두면 모델 이름(${device.model})으로 보여요. ` : ""}연결된 모든 기기에서 같은 이름으로 보여요.
      </p>
      {error && <p className="device-name-dialog__error" role="alert">{error}</p>}
    </StepDialog>
  );
}
