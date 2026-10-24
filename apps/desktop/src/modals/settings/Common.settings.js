import { useDispatch, useSelector } from "react-redux";
import { prefsSelector, setPrefs } from "../../store/prefsSlice";
import { Segmented, SettingsCard, SettingsPage, SettingsRow, SettingsSection, Skeleton, Soon, Toggle } from "./SettingsUI";
import { useAppSettings } from "./System.settings";
import TimeDisplaySection from "./TimeDisplaySection";

const MINUTES = [{ value: 5, label: "5분" }, { value: 10, label: "10분" }, { value: 15, label: "15분" }, { value: 30, label: "30분" }, { value: 60, label: "1시간" }];

// Due reminders (#91, mock frame ①): this PC's choice, kept by main (app-settings.json).
function ReminderSection({ settings, update }) {
  const r = settings?.reminders;
  const set = (patch) => update({ reminders: { ...r, enabled: true, ...patch } });
  return (
    <SettingsSection title="알림">
      <SettingsCard>
        <SettingsRow label="기한 전에 알림" description="기한이 다가오면 미리 Windows 알림으로 알려 줘요.">
          {r ? (
            <>
              <Segmented label="기한 전에 알림 시간" value={r.minutes} disabled={!r.before} onChange={(minutes) => set({ minutes })} options={MINUTES} />
              <Toggle label="기한 전에 알림" checked={r.before} onChange={(before) => set({ before })} />
            </>
          ) : <Skeleton width={38} height={22} />}
        </SettingsRow>
        <SettingsRow label="기한 시각에 알림" description="기한이 된 순간에 알려 줘요.">
          {r ? <Toggle label="기한 시각에 알림" checked={r.due} onChange={(due) => set({ due })} /> : <Skeleton width={38} height={22} />}
        </SettingsRow>
      </SettingsCard>
      <p className="settings-note">비밀 카테고리의 할 일과 앱이 잠겨 있을 때는 제목 없이 &quot;할 일 1개의 기한이 10분 남았어요&quot;처럼 알려요. 창을 닫아도 트레이에서 알려 줘요.</p>
    </SettingsSection>
  );
}

const SettingCommon = ({ preview = false }) => {
  const prefs = useSelector(prefsSelector);
  const [settings, update] = useAppSettings(preview);
  const dispatch = useDispatch();
  const set = (patch) => dispatch(setPrefs(patch));
  return (
    <SettingsPage title="일반" description="앱의 기본 동작을 정합니다.">
      <SettingsCard>
        <SettingsRow label="시작할 때 보기" description="앱을 열면 처음 보여 줄 화면">
          <Segmented label="시작할 때 보기" value={prefs.startView} onChange={(startView) => set({ startView })}
            options={[{ value: "list", label: "목록" }, { value: "calendar", label: "캘린더" }, { value: "timeline", label: "타임라인" }]} />
        </SettingsRow>
        <SettingsRow label="주 시작 요일" description="캘린더의 첫 번째 열">
          <Segmented label="주 시작 요일" value={prefs.weekStart} onChange={(weekStart) => set({ weekStart })}
            options={[{ value: 0, label: "일요일" }, { value: 1, label: "월요일" }]} />
        </SettingsRow>
        <SettingsRow label="시각 형식" description="오후 3시 / 15시">
          <Segmented label="시각 형식" value={prefs.timeFormat} onChange={(timeFormat) => set({ timeFormat })}
            options={[{ value: "12", label: "12시간" }, { value: "24", label: "24시간" }]} />
        </SettingsRow>
        <TimeDisplaySection prefs={prefs} set={set} />
        <SettingsRow label={<>테마<Soon /></>} description="다크, 라이트, 시스템 설정 따르기">
          <Segmented label="테마" value="dark" disabled
            options={[{ value: "dark", label: "다크" }, { value: "light", label: "라이트" }, { value: "system", label: "시스템" }]} />
        </SettingsRow>
        <SettingsRow label="업데이트 후 변경 내용 보기" description="새 버전으로 바뀐 뒤 처음 열 때 바뀐 점을 창으로 보여 줘요.">
          {settings ? <Toggle label="업데이트 후 변경 내용 보기" checked={settings.showPatchNotes !== false} onChange={(value) => update({ showPatchNotes: value })} />
            : <Skeleton width={38} height={22} />}
        </SettingsRow>
      </SettingsCard>
      <ReminderSection settings={settings} update={update} />
    </SettingsPage>
  );
};

export default SettingCommon;
