import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check, Repeat } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import {
  REPEAT_LABEL,
  remainingText,
  type Model,
  type TaskRow,
} from '@/core/model/view';
import { useTheme } from '@/ui/theme';

// Re-render once a minute so "n분 남음" stays current.
export function useNow(interval = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

export function AppBar({
  title,
  left,
  right,
  onTitlePress,
}: {
  title: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  onTitlePress?: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingLeft: left ? 8 : 18,
        paddingRight: 10,
        paddingTop: 8,
        minHeight: 56,
      }}
    >
      {left}
      <Pressable
        disabled={!onTitlePress}
        onPress={onTitlePress}
        accessibilityRole={onTitlePress ? 'button' : undefined}
        style={{ flex: 1 }}
      >
        {typeof title === 'string' ? (
          <Text style={{ color: theme.text, fontSize: 22, fontWeight: '700' }}>
            {title}
          </Text>
        ) : (
          title
        )}
      </Pressable>
      {right}
    </View>
  );
}

export function CheckCircle({
  done,
  onPress,
  size = 24,
}: {
  done: boolean;
  onPress?: () => void;
  size?: number;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      hitSlop={10}
      onPress={onPress}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: done ? theme.accent : theme.muted,
        backgroundColor: done ? theme.accent : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {done && (
        <Check color={theme.accentText} size={size * 0.6} strokeWidth={3} />
      )}
    </Pressable>
  );
}

export function TaskItem({
  task,
  model,
  now,
  onPress,
}: {
  task: TaskRow;
  model: Model;
  now: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { mutate } = useApp();
  const remaining = remainingText(task.dueDate, now);
  const color =
    task.categories
      .map(cid => model.categoryMap.get(cid)?.color)
      .find(Boolean) ?? null;
  const doneSubtasks = task.subtasks.filter(s => s.done).length;
  const toggle = () =>
    mutate('task/updateTaskDone', [task.tid, !task.done, Date.now()]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${task.title}${task.done ? ', 완료' : ''}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginHorizontal: 12,
        marginBottom: 8,
        paddingHorizontal: 14,
        paddingVertical: 13,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: pressed ? theme.hover : theme.surface,
        opacity: task.done ? 0.6 : 1,
      })}
    >
      <CheckCircle done={task.done} onPress={toggle} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            color: task.done ? theme.muted : theme.text,
            fontSize: 15,
            fontWeight: '600',
            textDecorationLine: task.done ? 'line-through' : 'none',
          }}
        >
          {task.title || '(제목 없음)'}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginTop: 3,
          }}
        >
          {color && (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: color,
              }}
            />
          )}
          {task.subtasks.length > 0 && (
            <Meta>{`${doneSubtasks}/${task.subtasks.length}`}</Meta>
          )}
          {!!task.repeatPeriod && (
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
            >
              <Repeat color={theme.muted} size={12} />
              <Meta>{REPEAT_LABEL[task.repeatPeriod]}</Meta>
            </View>
          )}
          {remaining && (
            <Meta danger={remaining.overdue && !task.done}>
              {remaining.text}
            </Meta>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function Meta({ children, danger }: { children: ReactNode; danger?: boolean }) {
  const theme = useTheme();
  return (
    <Text style={{ color: danger ? theme.danger : theme.muted, fontSize: 12 }}>
      {children}
    </Text>
  );
}

// "모두 동기화됨 · 방금" line (desktop #79 wording).
export function SyncLine({ extra }: { extra?: string }) {
  const { sync } = useApp();
  const theme = useTheme();
  const now = useNow();
  const pending = sync?.pending ?? 0;
  let text = '확인 중';
  let color = theme.muted;
  if (sync?.syncing) text = '동기화 중';
  else if (sync?.phase === 'OFFLINE') {
    text = pending ? `오프라인 · 보낼 변경 ${pending}개` : '오프라인';
    color = theme.warning;
  } else if (sync?.phase === 'ERROR') {
    text = '동기화 보류';
    color = theme.danger;
  } else if (sync?.lastSyncedAt) {
    const minutes = Math.floor((now - sync.lastSyncedAt) / 60000);
    const when =
      minutes < 1
        ? '방금'
        : minutes < 60
        ? `${minutes}분 전`
        : `${Math.floor(minutes / 60)}시간 전`;
    text = pending
      ? `보낼 변경 ${pending}개 · ${when}`
      : `모두 동기화됨 · ${when}`;
    color = pending ? theme.warning : theme.success;
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 18,
        paddingBottom: 10,
      }}
    >
      <View
        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }}
      />
      <Text style={{ color: theme.muted, fontSize: 12 }}>
        {text}
        {extra ? ` · ${extra}` : ''}
      </Text>
    </View>
  );
}

export function SectionHeader({
  label,
  open,
  onPress,
}: {
  label: string;
  open?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { expanded: !!open } : undefined}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 18,
        paddingTop: 14,
        paddingBottom: 8,
      }}
    >
      {onPress && (
        <Text
          style={{
            color: theme.muted,
            transform: [{ rotate: open ? '0deg' : '-90deg' }],
          }}
        >
          ▾
        </Text>
      )}
      <Text style={{ color: theme.secondary, fontSize: 13, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}
