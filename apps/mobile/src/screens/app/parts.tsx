import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check, Repeat, Star } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import {
  nextTick,
  taskTimeText,
  type TimeDisplay,
} from '@/core/model/timeDisplay';
import { REPEAT_LABEL, type Model, type TaskRow } from '@/core/model/view';
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

// Clock for screens listing tasks (#101): one timer, ticking every second only
// while some row's time text shows seconds (see nextTick), otherwise every `base`.
export function useListNow(
  tasks: { dueDate: number | null }[] | undefined,
  display: TimeDisplay,
  base = 60000,
) {
  const [now, setNow] = useState(() => Date.now());
  const delay = nextTick(
    (tasks ?? []).map(t => t.dueDate),
    now,
    display,
    base,
  );
  useEffect(() => {
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, now + delay - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [now, delay]);
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
  const { mutate, prefs } = useApp();
  const color =
    task.categories
      .map(cid => model.categoryMap.get(cid)?.color)
      .find(Boolean) ?? null;
  return (
    <TaskCard
      task={task}
      color={color}
      now={now}
      display={prefs}
      onPress={onPress}
      onToggle={() =>
        mutate('task/updateTaskDone', [task.tid, !task.done, Date.now()])
      }
      onStar={() =>
        mutate('task/updateTaskImportant', [task.tid, !task.important])
      }
    />
  );
}

// The task row's look. Without handlers it only displays (settings preview, #101).
export function TaskCard({
  task,
  color,
  now,
  display,
  onPress,
  onToggle,
  onStar,
}: {
  task: Pick<
    TaskRow,
    'title' | 'done' | 'dueDate' | 'repeatPeriod' | 'important'
  > & { subtasks: { done: boolean }[] };
  color: string | null;
  now: number;
  display: TimeDisplay;
  onPress?: () => void;
  onToggle?: () => void;
  onStar?: () => void;
}) {
  const theme = useTheme();
  const time = taskTimeText(task.dueDate, now, display);
  const doneSubtasks = task.subtasks.filter(s => s.done).length;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${task.title}${task.done ? ', 완료' : ''}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginHorizontal: 12,
        marginBottom: 8,
        paddingLeft: 14,
        paddingRight: 8,
        paddingVertical: 13,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: pressed ? theme.hover : theme.surface,
        opacity: task.done ? 0.6 : 1,
      })}
    >
      <CheckCircle done={task.done} onPress={onToggle} />
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
          {/* (color) (time) · (repeat) · (subtasks) — user order, #96 */}
          {[
            time && (
              <Meta key="left" danger={time.overdue && !task.done}>
                {time.text}
              </Meta>
            ),
            !!task.repeatPeriod && (
              <View
                key="repeat"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
              >
                <Repeat color={theme.muted} size={12} />
                <Meta>{REPEAT_LABEL[task.repeatPeriod]}</Meta>
              </View>
            ),
            task.subtasks.length > 0 && (
              <Meta key="subtasks">{`${doneSubtasks}/${task.subtasks.length}`}</Meta>
            ),
          ]
            .filter(Boolean)
            .flatMap((part, index) =>
              index ? [<Meta key={`dot${index}`}>·</Meta>, part] : [part],
            )}
        </View>
      </View>
      <StarButton on={task.important} onPress={onStar} />
    </Pressable>
  );
}

// Star toggle at the row's end (#97); its own press, the row does not open.
function StarButton({ on, onPress }: { on: boolean; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={on ? '중요 해제' : '중요로 표시'}
      accessibilityState={{ selected: on }}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.hover : 'transparent',
      })}
    >
      <Star
        color={on ? theme.star : theme.muted}
        fill={on ? theme.star : 'none'}
        size={20}
      />
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
