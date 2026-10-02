import { useEffect, useState } from "react";
import IpcSender from "../../utils/IpcSender";
import { Badge, SettingsButton, SettingsCard, SettingsPage, SettingsRow, Skeleton, Toggle } from "./SettingsUI";

const PREVIEW = { autoStart: true, closeToTray: true, hardwareAcceleration: true, betaUpdates: false, restartRequired: false };

// App-level preferences stored by main (app-settings.json).
export function useAppSettings(preview = false) {
  const [settings, setSettings] = useState(preview ? PREVIEW : null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (preview || !IpcSender.appSettings) return;
    try {
      IpcSender.appSettings.get(({ success, data }) => { if (success) setSettings(data); else setError(true); });
    } catch { setError(true); }
  }, [preview]);
  const update = (patch) => {
    setError(false);
    if (preview) { setSettings((old) => ({ ...old, ...patch, restartRequired: "hardwareAcceleration" in patch ? patch.hardwareAcceleration !== PREVIEW.hardwareAcceleration : old.restartRequired })); return; }
    setSettings((old) => ({ ...old, ...patch })); // optimistic
    IpcSender.appSettings.set(patch, ({ success, data }) => {
      if (success) setSettings(data);
      else { setError(true); IpcSender.appSettings.get(({ success: ok, data: fresh }) => ok && setSettings(fresh)); }
    });
  };
  return [settings, update, error];
}

const SettingSystem = ({ preview = false }) => {
  const [settings, update, error] = useAppSettings(preview);
  const toggle = (key, label) => settings
    ? <Toggle label={label} checked={settings[key]} onChange={(value) => update({ [key]: value })} />
    : <Skeleton width={38} height={22} />;
  return (
    <SettingsPage title="시스템" description="운영체제와 관련된 동작을 정합니다.">
      <SettingsCard>
        <SettingsRow label="컴퓨터를 켜면 자동 시작" description="로그인하면 Thread가 트레이에서 시작됩니다.">
          {toggle("autoStart", "컴퓨터를 켜면 자동 시작")}
        </SettingsRow>
        <SettingsRow label="창을 닫으면 트레이로" description="끄면 창을 닫을 때 앱이 종료됩니다.">
          {toggle("closeToTray", "창을 닫으면 트레이로")}
        </SettingsRow>
        <SettingsRow label="하드웨어 가속" description="화면이 깨지거나 깜박이면 꺼 보세요.">
          {settings?.restartRequired && <Badge tone="warning">다시 시작하면 적용</Badge>}
          {settings?.restartRequired && !preview && (
            <SettingsButton onClick={() => IpcSender.system.relaunch()}>다시 시작</SettingsButton>
          )}
          {toggle("hardwareAcceleration", "하드웨어 가속")}
        </SettingsRow>
      </SettingsCard>
      {error && <p className="settings-error" role="alert">설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.</p>}
    </SettingsPage>
  );
};

export default SettingSystem;
