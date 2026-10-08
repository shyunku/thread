import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronRight } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import { dueText, remainText } from '@/core/model/timeDisplay';
import type { Prefs } from '@/core/prefs';
import { Row, Sheet } from '@/ui/kit';
import { messageFor } from '@/ui/messages';
import { useTheme } from '@/ui/theme';
import { Logo } from '@/screens/auth/LoginScreen';
import { SyncLine, TaskCard, useListNow } from './parts';

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
    title: '시각 형식',
    options: [
      ['12', '12시간 (오후 3:00)'],
      ['24', '24시간 (15:00)'],
    ],
  },
  theme: {
    key: 'theme',
    title: '테마',
    options: [
      ['system', '시스템 기본값'],
      ['dark', '다크'],
      ['light', '라이트'],
    ],
  },
  secretRelock: {
    key: 'secretRelock',
    title: '비밀 카테고리 잠금',
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
  const [timeSheet, setTimeSheet] = useState(false);
  const label = <K extends keyof typeof CHOICES>(k: K) =>
    CHOICES[k].options.find(([v]) => v === prefs[k])?.[1] ?? '';

  return (
    <View style={{ flex: 1, backgroundColor: theme.canvas }}>
      <Text
        style={{
          color: theme.text,
          fontSize: 22,
          fontWeight: '700',
          paddingHorizontal: 18,
          paddingTop: 16,
          paddingBottom: 12,
        }}
      >
        설정
      </Text>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            marginHorizontal: 12,
            padding: 14,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
          }}
        >
          <Logo size={44} />
          <View style={{ flex: 1 }}>
            <Text
              style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}
            >
              {user?.username ?? user?.authId ?? '계정'}
            </Text>
            <Text style={{ color: theme.muted, fontSize: 12 }}>
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
            title="시각 형식"
            value={label('timeFormat')}
            onPress={() => setChoice('timeFormat')}
          />
          <Item
            title="시간 표시"
            value={timeDisplayLabel(prefs)}
            onPress={() => setTimeSheet(true)}
          />
          <Item
            title="테마"
            value={label('theme')}
            onPress={() => setChoice('theme')}
          />
          <Item
            title="비밀 카테고리 잠금"
            value={label('secretRelock')}
            onPress={() => setChoice('secretRelock')}
          />
          <SwitchItem
            title="업데이트 후 변경 내용 보기"
            detail="새 버전으로 바뀐 뒤 처음 열 때 바뀐 점을 보여 줘요."
            value={prefs.showPatchNotes}
            onChange={showPatchNotes => setPrefs({ showPatchNotes })}
            last
          />
        </Group>

        <Group title="데이터">
          <Pressable
            onPress={() => navigation.navigate('DataSettings')}
            style={{ paddingTop: 12 }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 14,
              }}
            >
              <Text style={{ flex: 1, color: theme.text, fontSize: 15 }}>
                동기화 · 기기 · 복구
              </Text>
              <ChevronRight color={theme.muted} size={18} />
            </View>
            <View style={{ marginTop: 6, marginLeft: -4 }}>
              <SyncLine />
            </View>
          </Pressable>
        </Group>

        <Group title="계정">
          <Item
            title="앱 잠금"
            value="다음에 생체/PIN"
            onPress={() => account?.session.lock()}
          />
          <Item
            title="다른 기기 모두 로그아웃"
            onPress={() =>
              Alert.alert(
                '다른 기기 모두 로그아웃',
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
            title="업데이트 내역"
            onPress={() => navigation.navigate('PatchNotes')}
          />
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
              <Text style={{ color: theme.text, fontSize: 15 }}>{text}</Text>
            </Row>
          ))}
        </Sheet>
      )}
      {timeSheet && <TimeDisplaySheet onClose={() => setTimeSheet(false)} />}
    </View>
  );
}

const REMAIN_FORMATS: [Prefs['remainFormat'], string][] = [
  ['simple', '간단히'],
  ['normal', '보통'],
  ['detailed', '자세히'],
  ['all', '모두'],
];
const DUE_FORMATS: [Prefs['dueFormat'], string][] = [
  ['simple', '간단히'],
  ['auto', '자동'],
  ['exact', '정확히'],
  ['full', '자세히'],
];

// "남은 시간 · 보통" / "기한 · 자동"
export function timeDisplayLabel(prefs: Prefs) {
  return prefs.timeDisplay === 'due'
    ? `기한 · ${DUE_FORMATS.find(([v]) => v === prefs.dueFormat)?.[1] ?? ''}`
    : `남은 시간 · ${
        REMAIN_FORMATS.find(([v]) => v === prefs.remainFormat)?.[1] ?? ''
      }`;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const REMAIN_SAMPLES = [
  DAY + 4 * HOUR + 12 * MINUTE + 8 * SECOND,
  30 * DAY + 4 * DAY + 23 * HOUR + 2 * MINUTE + 8 * SECOND,
  HOUR + 5 * SECOND,
];
// The 기한 examples land on round times around today: [days from today, hour, minute].
const DUE_SAMPLES: Record<Prefs['dueFormat'], [number, number, number][]> = {
  simple: [
    [0, 12, 0],
    [1, 12, 0],
    [-2, 12, 0],
    [10, 12, 0],
    [95, 12, 0],
    [5 * 365 + 3, 12, 0],
  ],
  auto: [
    [0, 15, 20],
    [1, 17, 30],
    [2, 15, 0],
    [-1, 9, 0],
    [10, 15, 0],
  ],
  exact: [
    [2, 14, 45],
    [1, 17, 30],
  ],
  full: [
    [2, 14, 45],
    [1, 17, 30],
  ],
};

export function sampleText(prefs: Prefs, format: string, now: number) {
  if (prefs.timeDisplay === 'remain')
    return REMAIN_SAMPLES.map(
      ms => remainText(ms, format as Prefs['remainFormat']).text,
    ).join(' · ');
  const today = new Date(now);
  return DUE_SAMPLES[format as Prefs['dueFormat']]
    .map(([days, h, m]) => {
      const at = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + days,
        h,
        m,
      ).getTime();
      return dueText(at, now, format as Prefs['dueFormat'], prefs.timeFormat)
        .text;
    })
    .join(' · ');
}

// 시간 표시 sheet (#101, docs/designs/pc-feedback-mock.html): mode switch, a live
// preview of two sample rows and the formats. A choice saves right away.
export function TimeDisplaySheet({ onClose }: { onClose: () => void }) {
  const { prefs, setPrefs } = useApp();
  const theme = useTheme();
  const { height } = useWindowDimensions();
  // Whole seconds, so the preview opens on the exact sample values.
  const [start] = useState(() => Math.ceil(Date.now() / 1000) * 1000);
  const preview = useMemo(
    () => [
      {
        title: '분기 회고 자료 정리',
        color: '#6294ff',
        done: false,
        dueDate: start + 2 * HOUR + 59 * MINUTE + 55 * SECOND,
        repeatPeriod: '' as const,
        important: true,
        subtasks: [{ done: true }, { done: true }, { done: false }],
      },
      {
        title: '운동 30분',
        color: '#44c98b',
        done: false,
        dueDate: start + DAY + 4 * HOUR + 12 * MINUTE + 8 * SECOND,
        repeatPeriod: '' as const,
        important: false,
        subtasks: [],
      },
    ],
    [start],
  );
  const now = useListNow(preview, prefs);
  const remain = prefs.timeDisplay === 'remain';
  const formats: [string, string][] = remain ? REMAIN_FORMATS : DUE_FORMATS;
  const current = remain ? prefs.remainFormat : prefs.dueFormat;
  const modes: [Prefs['timeDisplay'], string][] = [
    ['remain', '남은 시간'],
    ['due', '기한'],
  ];

  return (
    <Sheet visible onClose={onClose} title="시간 표시">
      <ScrollView style={{ maxHeight: height - 160 }}>
        <Text
          style={{
            color: theme.secondary,
            fontSize: 12.5,
            lineHeight: 19,
            marginHorizontal: 20,
            marginBottom: 12,
          }}
        >
          {`할 일 목록과 캘린더 아래 목록에 ${
            remain ? '남은 시간' : '기한'
          }을 얼마나 자세히 보여 줄지 정해요.`}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            gap: 3,
            marginHorizontal: 20,
            marginBottom: 14,
            padding: 3,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        >
          {modes.map(([value, text]) => {
            const on = prefs.timeDisplay === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setPrefs({ timeDisplay: value })}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: 7,
                  borderRadius: 8,
                  backgroundColor: on ? theme.selected : 'transparent',
                }}
              >
                <Text
                  style={{
                    color: on ? theme.text : theme.secondary,
                    fontSize: 14,
                    fontWeight: on ? '600' : '400',
                  }}
                >
                  {text}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text
          style={{
            color: theme.muted,
            fontSize: 12,
            fontWeight: '600',
            marginHorizontal: 20,
            marginBottom: 6,
          }}
        >
          미리 보기
        </Text>
        <View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={{
            marginHorizontal: 12,
            marginBottom: 10,
            paddingTop: 10,
            paddingBottom: 2,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.canvas,
          }}
        >
          {preview.map(task => (
            <TaskCard
              key={task.title}
              task={task}
              color={task.color}
              now={now}
              display={prefs}
            />
          ))}
        </View>
        {formats.map(([value, name]) => {
          const on = value === current;
          return (
            <Row
              key={value}
              selected={on}
              style={{ paddingVertical: 10 }}
              onPress={() =>
                setPrefs(
                  remain
                    ? { remainFormat: value as Prefs['remainFormat'] }
                    : { dueFormat: value as Prefs['dueFormat'] },
                )
              }
            >
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  borderWidth: 2,
                  borderColor: on ? theme.accent : theme.muted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {on && (
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: theme.accent,
                    }}
                  />
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: theme.text, fontSize: 15 }}>{name}</Text>
                <Text
                  style={{ color: theme.muted, fontSize: 12, lineHeight: 17 }}
                >
                  {sampleText(prefs, value, start)}
                </Text>
              </View>
            </Row>
          );
        })}
      </ScrollView>
    </Sheet>
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
          fontSize: 12,
          fontWeight: '600',
          paddingHorizontal: 18,
          paddingTop: 18,
          paddingBottom: 6,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          marginHorizontal: 12,
          borderRadius: 14,
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

function SwitchItem({
  title,
  detail,
  value,
  onChange,
  last,
}: {
  title: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1,
        borderColor: theme.border,
        backgroundColor: pressed ? theme.hover : 'transparent',
      })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 15 }}>{title}</Text>
        <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>
          {detail}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={title}
        trackColor={{ true: theme.accent, false: theme.border }}
        thumbColor="#fff"
      />
    </Pressable>
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
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 13,
        borderBottomWidth: last ? 0 : 1,
        borderColor: theme.border,
        backgroundColor: pressed ? theme.hover : 'transparent',
      })}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{ color: danger ? theme.danger : theme.text, fontSize: 15 }}
        >
          {title}
        </Text>
        {!!detail && (
          <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>
            {detail}
          </Text>
        )}
      </View>
      {!!value && (
        <Text style={{ color: theme.muted, fontSize: 13 }}>{value}</Text>
      )}
      {onPress && <ChevronRight color={theme.muted} size={16} />}
    </Pressable>
  );
}
