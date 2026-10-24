import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, Pressable, Text, View } from 'react-native';
import { useApp } from '@/app/AppContext';
import {
  openExactAlarmSettings,
  openNotificationSettings,
  reminderMinutes,
  reminderStatus,
  type ReminderStatus,
} from '@/core/reminders';
import { Row, Sheet } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { Group, Item, SwitchItem } from './SettingsScreen';

const span = (minutes: number) => (minutes === 60 ? '1시간' : `${minutes}분`);

// 설정 → 알림 (#91, mock frame ④): before / at the due time, how long before, and lines for a
// missing notification permission and (Android) missing exact alarms.
export function ReminderGroup() {
  const { prefs, setPrefs, runtime } = useApp();
  const theme = useTheme();
  const r = prefs.reminders;
  const [sheet, setSheet] = useState(false);
  const [status, setStatus] = useState<ReminderStatus | null>(null);
  const check = useCallback(() => {
    reminderStatus().then(setStatus);
  }, []);
  // The user may change the permission in the system settings and come back.
  useEffect(() => {
    check();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') check();
    });
    return () => subscription.remove();
  }, [check]);
  const set = (patch: Partial<typeof r>) =>
    setPrefs({ reminders: { ...r, enabled: true, ...patch } });
  const on = r.before || r.due;

  const ask = async () => {
    if (!prefs.notifyAsked && runtime.reminders) {
      setPrefs({ notifyAsked: true });
      await runtime.reminders.askPermission();
      check();
    } else openNotificationSettings();
  };

  return (
    <>
      <Group title="알림">
        {on && status && !status.enabled && (
          <Banner
            title="알림 권한이 꺼져 있어요"
            text="휴대폰 설정에서 Thread 알림을 허용해야 기한을 알려 드려요."
            action={prefs.notifyAsked ? '설정 열기' : '허용'}
            onPress={ask}
          />
        )}
        {on && status?.enabled && !status.exact && Platform.OS === 'android' && (
          <Banner
            title="알림이 조금 늦을 수 있어요"
            text="정확한 시각에 받으려면 '알람 및 리마인더'를 허용해 주세요."
            action="허용"
            onPress={openExactAlarmSettings}
          />
        )}
        <SwitchItem
          title="기한 전에 알림"
          detail={`기한 ${span(r.minutes)} 전에 알려 줘요.`}
          value={r.before}
          onChange={before => set({ before })}
        />
        <Item
          title="얼마나 전에"
          value={`${span(r.minutes)} 전`}
          onPress={r.before ? () => setSheet(true) : undefined}
        />
        <SwitchItem
          title="기한 시각에 알림"
          detail="기한이 된 순간에 알려 줘요."
          value={r.due}
          onChange={due => set({ due })}
          last
        />
      </Group>
      <Text
        style={{
          color: theme.muted,
          fontSize: 12,
          lineHeight: 17,
          paddingHorizontal: 18,
          paddingTop: 8,
        }}
      >
        비밀 카테고리의 할 일은 제목 없이 "할 일 1개의 기한이 {span(r.minutes)}{' '}
        남았어요"처럼 알려요.
      </Text>
      {sheet && (
        <Sheet visible onClose={() => setSheet(false)} title="얼마나 전에">
          {reminderMinutes.map(minutes => (
            <Row
              key={minutes}
              selected={r.minutes === minutes}
              onPress={() => {
                set({ minutes });
                setSheet(false);
              }}
            >
              <Text style={{ color: theme.text, fontSize: 15 }}>
                {span(minutes)} 전
              </Text>
            </Row>
          ))}
        </Sheet>
      )}
    </>
  );
}

function Banner({
  title,
  text,
  action,
  onPress,
}: {
  title: string;
  text: string;
  action: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.warning + '1f',
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.warning, fontSize: 15, fontWeight: '600' }}>
          {title}
        </Text>
        <Text style={{ color: theme.warning, fontSize: 12, marginTop: 2 }}>
          {text}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => ({
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.warning + '66',
          backgroundColor: pressed ? theme.warning + '26' : 'transparent',
        })}
      >
        <Text style={{ color: theme.warning, fontSize: 13, fontWeight: '600' }}>
          {action}
        </Text>
      </Pressable>
    </View>
  );
}
