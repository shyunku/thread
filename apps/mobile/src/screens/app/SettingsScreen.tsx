import { useState, type ReactNode } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronRight } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import type { Prefs } from '@/core/prefs';
import { Row, Sheet } from '@/ui/kit';
import { messageFor } from '@/ui/messages';
import { useTheme } from '@/ui/theme';
import { Logo } from '@/screens/auth/LoginScreen';
import { SyncLine } from './parts';

const VERSION = require('../../../package.json').version as string;
export const PRIVACY_URL = 'https://site.threadapp.kr/privacy';
export const CONTACT = 'shyunku.support@gmail.com';

type Choice<K extends keyof Prefs> = {
  key: K;
  title: string;
  options: [Prefs[K], string][];
};
const CHOICES: {
  [K in
    | 'startTab'
    | 'weekStart'
    | 'timeFormat'
    | 'theme'
    | 'secretRelock']: Choice<K>;
} = {
  startTab: {
    key: 'startTab',
    title: '시작 화면',
    options: [
      ['tasks', '할 일'],
      ['calendar', '캘린더'],
      ['timeline', '일정'],
    ],
  },
  weekStart: {
    key: 'weekStart',
    title: '주 시작 요일',
    options: [
      [0, '일요일'],
      [1, '월요일'],
    ],
  },
  timeFormat: {
    key: 'timeFormat',
    title: '시간 표시',
    options: [
      ['12', '12시간 (오후 3:00)'],
      ['24', '24시간 (15:00)'],
    ],
  },
  theme: {
    key: 'theme',
    title: '테마',
    options: [
      ['system', '휴대폰 설정 따라감'],
      ['dark', '다크'],
      ['light', '라이트'],
    ],
  },
  secretRelock: {
    key: 'secretRelock',
    title: '비밀 카테고리 다시 잠금',
    options: [
      ['session', '앱을 닫거나 잠글 때'],
      ['each', '열 때마다'],
    ],
  },
};

export default function SettingsScreen() {
  const { user, prefs, setPrefs, account, runtime } = useApp();
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const [choice, setChoice] = useState<keyof typeof CHOICES | null>(null);
  const label = <K extends keyof typeof CHOICES>(k: K) =>
    CHOICES[k].options.find(([v]) => v === prefs[k])?.[1] ?? '';

  return (
    <View style={{ flex: 1, backgroundColor: theme.canvas }}>
      <Text
        style={{
          color: theme.text,
          fontSize: 19.5,
          fontWeight: '700',
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 10.5,
        }}
      >
        설정
      </Text>
      <ScrollView contentContainerStyle={{ paddingBottom: 35 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10.5,
            marginHorizontal: 10.5,
            padding: 12.5,
            borderRadius: 12.5,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
          }}
        >
          <Logo size={38.5} />
          <View style={{ flex: 1 }}>
            <Text
              style={{ color: theme.text, fontWeight: '700', fontSize: 13 }}
            >
              {user?.username ?? user?.authId ?? '계정'}
            </Text>
            <Text style={{ color: theme.muted, fontSize: 10.5 }}>
              {user?.googleEmail
                ? `Google 연결됨 · ${user.googleEmail}`
                : user?.authId ?? ''}
            </Text>
          </View>
        </View>

        <Group title="일반">
          <Item
            title="시작 화면"
            value={label('startTab')}
            onPress={() => setChoice('startTab')}
          />
          <Item
            title="주 시작 요일"
            value={label('weekStart')}
            onPress={() => setChoice('weekStart')}
          />
          <Item
            title="시간 표시"
            value={label('timeFormat')}
            onPress={() => setChoice('timeFormat')}
          />
          <Item
            title="테마"
            value={label('theme')}
            onPress={() => setChoice('theme')}
          />
          <Item
            title="비밀 카테고리 다시 잠금"
            value={label('secretRelock')}
            onPress={() => setChoice('secretRelock')}
            last
          />
        </Group>

        <Group title="데이터">
          <Pressable
            onPress={() => navigation.navigate('DataSettings')}
            style={{ paddingTop: 10.5 }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 12.5,
              }}
            >
              <Text style={{ flex: 1, color: theme.text, fontSize: 13 }}>
                동기화 · 기기 · 복구
              </Text>
              <ChevronRight color={theme.muted} size={16} />
            </View>
            <View style={{ marginTop: 5.5, marginLeft: -3.5 }}>
              <SyncLine />
            </View>
          </Pressable>
        </Group>

        <Group title="계정">
          <Item
            title="잠그기"
            value="다음에 생체/PIN"
            onPress={() => account?.session.lock()}
          />
          <Item
            title="다른 곳 모두 로그아웃"
            onPress={() =>
              Alert.alert(
                '다른 곳 모두 로그아웃',
                '이 휴대폰을 뺀 모든 기기에서 로그아웃돼요. 데이터와 기기 연결은 그대로예요.',
                [
                  { text: '취소', style: 'cancel' },
                  {
                    text: '로그아웃',
                    onPress: () =>
                      runtime.account
                        .revokeOtherSessions()
                        .then(() =>
                          Alert.alert(
                            '완료',
                            '다른 기기에서 모두 로그아웃했어요.',
                          ),
                        )
                        .catch(e => Alert.alert('실패', messageFor(e))),
                  },
                ],
              )
            }
          />
          <Item
            title="로그아웃"
            danger
            last
            onPress={() =>
              Alert.alert(
                '로그아웃',
                '이 휴대폰의 암호화된 데이터는 남아 있고, 다시 로그인하면 이어서 쓸 수 있어요.',
                [
                  { text: '취소', style: 'cancel' },
                  {
                    text: '로그아웃',
                    style: 'destructive',
                    onPress: () => runtime.signOut(),
                  },
                ],
              )
            }
          />
        </Group>

        <Group title="정보">
          <Item title="버전" value={VERSION} />
          <Item
            title="개인정보처리방침"
            onPress={() => Linking.openURL(PRIVACY_URL)}
          />
          <Item
            title="문의"
            value={CONTACT}
            onPress={() => Linking.openURL(`mailto:${CONTACT}`)}
            last
          />
        </Group>
      </ScrollView>

      {choice && (
        <Sheet
          visible
          onClose={() => setChoice(null)}
          title={CHOICES[choice].title}
        >
          {(CHOICES[choice].options as [any, string][]).map(([value, text]) => (
            <Row
              key={String(value)}
              selected={prefs[choice] === value}
              onPress={() => {
                setPrefs({ [choice]: value } as Partial<Prefs>);
                setChoice(null);
              }}
            >
              <Text style={{ color: theme.text, fontSize: 13 }}>{text}</Text>
            </Row>
          ))}
        </Sheet>
      )}
    </View>
  );
}

export function Group({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <>
      <Text
        style={{
          color: theme.muted,
          fontSize: 10.5,
          fontWeight: '600',
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 5.5,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          marginHorizontal: 10.5,
          borderRadius: 12.5,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </>
  );
}

export function Item({
  title,
  value,
  onPress,
  danger,
  last,
  detail,
}: {
  title: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  last?: boolean;
  detail?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingHorizontal: 12.5,
        paddingVertical: 11.5,
        borderBottomWidth: last ? 0 : 1,
        borderColor: theme.border,
        backgroundColor: pressed ? theme.hover : 'transparent',
      })}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{ color: danger ? theme.danger : theme.text, fontSize: 13 }}
        >
          {title}
        </Text>
        {!!detail && (
          <Text style={{ color: theme.muted, fontSize: 10.5, marginTop: 2 }}>
            {detail}
          </Text>
        )}
      </View>
      {!!value && (
        <Text style={{ color: theme.muted, fontSize: 11.5 }}>{value}</Text>
      )}
      {onPress && <ChevronRight color={theme.muted} size={14} />}
    </Pressable>
  );
}
