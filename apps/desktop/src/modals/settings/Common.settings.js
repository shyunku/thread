import { SettingsPage } from "./SettingsUI";

const SettingCommon = () => (
  <SettingsPage title="일반" description="앱의 기본 동작을 정합니다.">
    <div className="settings-empty">현재 조정할 항목이 없습니다.</div>
  </SettingsPage>
);

export default SettingCommon;
