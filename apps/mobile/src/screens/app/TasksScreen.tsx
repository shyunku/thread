import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  Check,
  ChevronDown,
  KeyRound,
  Layers,
  Plus,
  Search,
  Star,
  Sun,
  Tag,
} from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import {
  sortTasks,
  visibleTasks,
  type Model,
  type Scope,
  type SortMode,
} from '@/core/model/view';
import { Button, Chip, IconButton, Row, Sheet } from '@/ui/kit';
import { formatDue, REPEAT_LABEL } from '@/core/model/view';
import { today, tomorrow } from '@/ui/dateTime';
import { DateTimeSheet } from '@/ui/DateTimeSheet';
import { useTheme } from '@/ui/theme';
import { AppBar, SectionHeader, SyncLine, TaskItem, useNow } from './parts';

const SORTS: [SortMode, string][] = [
  ['due', '기한 순'],
  ['remaining', '남은 기한 순'],
  ['created', '생성일 순'],
];

export function scopeTitle(scope: Scope, model: Model | null) {
  if (scope.kind === 'all') return '모든 할 일';
  if (scope.kind === 'today') return '오늘';
  if (scope.kind === 'important') return '중요';
  return model?.categoryMap.get(scope.cid)?.title || '카테고리';
}

export default function TasksScreen() {
  const { model, scope, setScope, prefs, setPrefs } = useApp();
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const now = useNow();
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);

  const tasks = useMemo(
    () =>
      model ? sortTasks(visibleTasks(model, scope, { now }), prefs.sort) : [],
    [model, scope, now, prefs.sort],
  );
  const todo = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);
  type Item = { key: string; header?: 'todo' | 'done'; tid?: string };
  const items: Item[] = [
    { key: 'h-todo', header: 'todo' },
    ...(prefs.listTodoOpen ? todo.map(t => ({ key: t.tid, tid: t.tid })) : []),
    { key: 'h-done', header: 'done' },
    ...(prefs.listDoneOpen ? done.map(t => ({ key: t.tid, tid: t.tid })) : []),
  ];
  const byId = new Map(tasks.map(t => [t.tid, t]));
  const secret =
    scope.kind === 'category' && !!model?.categoryMap.get(scope.cid)?.secret;

  return (
    <View style={{ flex: 1, backgroundColor: theme.canvas }}>
      <AppBar
        onTitlePress={() => setPicking(true)}
        title={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {secret && <KeyRound color={theme.warning} size={19.5} />}
            {scope.kind === 'important' && (
              <Star color={theme.star} fill={theme.star} size={20} />
            )}
            <Text
              numberOfLines={1}
              style={{
                color: theme.text,
                fontSize: 22,
                fontWeight: '700',
                flexShrink: 1,
              }}
            >
              {scopeTitle(scope, model)}
            </Text>
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 1,
                borderRadius: 7,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.surface,
              }}
            >
              <Text
                style={{
                  color: theme.secondary,
                  fontSize: 13,
                  fontWeight: '600',
                }}
              >
                {todo.length}
              </Text>
            </View>
            <ChevronDown color={theme.muted} size={16} />
          </View>
        }
        right={
          <IconButton
            label="검색"
            onPress={() => navigation.navigate('Search')}
          >
            <Search color={theme.secondary} size={21} />
          </IconButton>
        }
      />
      {secret ? (
        <Text
          style={{
            color: theme.muted,
            fontSize: 12,
            paddingHorizontal: 18,
            paddingBottom: 10,
          }}
        >
          비밀 카테고리 ·{' '}
          {prefs.secretRelock === 'each'
            ? '다른 보기로 나가면 다시 잠겨요'
            : '앱을 닫거나 잠그면 다시 잠겨요'}
        </Text>
      ) : (
        <SyncLine extra={`${tasks.length}개의 할 일 · ${done.length}개 완료`} />
      )}
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: 6,
            paddingHorizontal: 18,
            paddingBottom: 6,
          }}
        >
          {SORTS.map(([mode, label]) => (
            <Chip
              key={mode}
              label={label}
              selected={prefs.sort === mode}
              onPress={() => setPrefs({ sort: mode })}
            />
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={items}
        keyExtractor={item => item.key}
        contentContainerStyle={{ paddingBottom: 120 }}
        renderItem={({ item }) => {
          if (item.header === 'todo') {
            return (
              <SectionHeader
                label={`해야할 일 (${todo.length})`}
                open={prefs.listTodoOpen}
                onPress={() => setPrefs({ listTodoOpen: !prefs.listTodoOpen })}
              />
            );
          }
          if (item.header === 'done') {
            return (
              <SectionHeader
                label={`완료됨 (${done.length})`}
                open={prefs.listDoneOpen}
                onPress={() => setPrefs({ listDoneOpen: !prefs.listDoneOpen })}
              />
            );
          }
          const task = byId.get(item.tid!)!;
          return (
            <TaskItem
              task={task}
              model={model!}
              now={now}
              onPress={() =>
                navigation.navigate('TaskDetail', { tid: task.tid })
              }
            />
          );
        }}
      />
      {!model && (
        <Text
          style={{
            color: theme.muted,
            textAlign: 'center',
            position: 'absolute',
            top: 220,
            left: 0,
            right: 0,
          }}
        >
          처음 동기화를 기다리는 중…
        </Text>
      )}
      <Fab onPress={() => setAdding(true)} disabled={!model} />
      <CategorySheet
        visible={picking}
        onClose={() => setPicking(false)}
        scope={scope}
        onSelect={async next => {
          if (await setScope(next)) setPicking(false);
        }}
      />
      <AddTaskSheet
        visible={adding}
        onClose={() => setAdding(false)}
        scope={scope}
      />
    </View>
  );
}

export function Fab({
  onPress,
  disabled,
}: {
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="할 일 추가"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        position: 'absolute',
        right: 18,
        bottom: 18,
        width: 56,
        height: 56,
        borderRadius: 18,
        backgroundColor: theme.accent,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 6,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <Plus color={theme.accentText} size={28} />
    </Pressable>
  );
}

export function CategorySheet({
  visible,
  onClose,
  scope,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  scope: Scope;
  onSelect: (scope: Scope) => void;
}) {
  const { model, isSecretOpen } = useApp();
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const count = (s: Scope) =>
    model ? visibleTasks(model, s).filter(t => !t.done).length : 0;
  const rows: {
    scope: Scope;
    label: string;
    icon: React.ReactNode;
    locked?: boolean;
  }[] = [
    {
      scope: { kind: 'all' },
      label: '모든 할 일',
      icon: <Layers color={theme.secondary} size={18} />,
    },
    {
      scope: { kind: 'today' },
      label: '오늘',
      icon: <Sun color={theme.secondary} size={18} />,
    },
    {
      scope: { kind: 'important' },
      label: '중요',
      icon: <Star color={theme.star} fill={theme.star} size={18} />,
    },
    ...(model?.categories ?? []).map(c => ({
      scope: { kind: 'category', cid: c.cid } as Scope,
      label: c.title,
      // A secret category shows a key; its count stays hidden until it is opened.
      locked: c.secret && !isSecretOpen(c.cid),
      icon: c.secret ? (
        <KeyRound color={theme.warning} size={16} />
      ) : (
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            marginHorizontal: 4,
            backgroundColor: c.color || theme.accent,
          }}
        />
      ),
    })),
  ];
  const same = (a: Scope, b: Scope) =>
    a.kind === b.kind &&
    (a.kind !== 'category' || (b.kind === 'category' && a.cid === b.cid));
  return (
    <Sheet visible={visible} onClose={onClose} title="보기">
      <ScrollView style={{ maxHeight: 420 }}>
        {rows.map((row, index) => (
          <Row
            key={index}
            selected={same(row.scope, scope)}
            onPress={() => onSelect(row.scope)}
          >
            {row.icon}
            <Text
              numberOfLines={1}
              style={{ flex: 1, color: theme.text, fontSize: 15 }}
            >
              {row.label}
            </Text>
            <Text style={{ color: theme.muted, fontSize: 13 }}>
              {row.locked ? '잠김' : count(row.scope)}
            </Text>
          </Row>
        ))}
      </ScrollView>
      <View
        style={{
          height: 1,
          backgroundColor: theme.border,
          marginHorizontal: 20,
          marginVertical: 6,
        }}
      />
      <Row
        onPress={() => {
          onClose();
          navigation.navigate('Categories');
        }}
      >
        <Tag color={theme.secondary} size={18} />
        <Text style={{ flex: 1, color: theme.text, fontSize: 15 }}>
          카테고리 추가·관리
        </Text>
      </Row>
    </Sheet>
  );
}

// Quick add: title, due date chips and the current category (adds the rest in detail).
export function AddTaskSheet({
  visible,
  onClose,
  scope,
  defaultDue,
}: {
  visible: boolean;
  onClose: () => void;
  scope: Scope;
  defaultDue?: number | null;
}) {
  const { mutate, model, prefs } = useApp();
  const theme = useTheme();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState<number | null>(
    defaultDue ?? (scope.kind === 'today' ? today() : null),
  );
  const [categories, setCategories] = useState<string[]>(
    scope.kind === 'category' ? [scope.cid] : [],
  );
  const [repeat, setRepeat] = useState('');
  const [picker, setPicker] = useState<'date' | 'repeat' | 'category' | null>(
    null,
  );
  const reset = () => {
    setTitle('');
    setDue(defaultDue ?? (scope.kind === 'today' ? today() : null));
    setCategories(scope.kind === 'category' ? [scope.cid] : []);
    setRepeat('');
    setPicker(null);
  };
  const chosen = categories
    .map(cid => model?.categoryMap.get(cid)?.title)
    .filter(Boolean) as string[];
  const categoryLabel = !chosen.length
    ? '카테고리'
    : chosen.length === 1
    ? chosen[0]
    : `${chosen[0]} 외 ${chosen.length - 1}`;
  // The sheet stays mounted: take the current view's date and category each time
  // it opens (the view may have changed since the last time).
  useEffect(() => {
    if (visible) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const add = () => {
    if (!title.trim()) return;
    mutate('task/addTask', [
      {
        title: title.trim(),
        due_date: due ?? undefined,
        repeat_period: repeat && due ? repeat : undefined,
        categories,
        // Added in the 중요 view: starred from the start (#97).
        important: scope.kind === 'important' || undefined,
        created_at: Date.now(),
      },
    ]);
    reset();
    onClose();
  };
  const isToday = due === today();
  const isTomorrow = due === tomorrow();
  return (
    <Sheet
      visible={visible}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <TextInput
        autoFocus
        placeholder="새 할 일 제목"
        placeholderTextColor={theme.muted}
        value={title}
        onChangeText={setTitle}
        onSubmitEditing={add}
        returnKeyType="done"
        style={{
          marginHorizontal: 18,
          marginBottom: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
          color: theme.text,
          fontSize: 18,
          fontWeight: '600',
        }}
      />
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: 6,
          paddingHorizontal: 18,
          paddingBottom: 12,
        }}
      >
        <Chip
          label="오늘"
          selected={isToday}
          onPress={() => setDue(isToday ? null : today())}
        />
        <Chip
          label="내일"
          selected={isTomorrow}
          onPress={() => setDue(isTomorrow ? null : tomorrow())}
        />
        <Chip
          label={
            due && !isToday && !isTomorrow
              ? formatDue(due, prefs.timeFormat)
              : '날짜·시간'
          }
          selected={!!due && !isToday && !isTomorrow}
          dropdown
          onPress={() => setPicker('date')}
        />
        <Chip
          label={repeat ? REPEAT_LABEL[repeat] : '반복'}
          selected={!!repeat}
          dropdown
          onPress={() => setPicker('repeat')}
        />
        <Chip
          label={categoryLabel}
          selected={categories.length > 0}
          dropdown
          onPress={() => setPicker('category')}
        />
      </ScrollView>
      <Button
        kind="primary"
        label="추가"
        disabled={!title.trim()}
        onPress={add}
      />
      <Text style={{ color: theme.muted, fontSize: 12, marginHorizontal: 20 }}>
        메모·하위 할 일은 추가한 뒤 상세에서 넣을 수 있어요.
      </Text>

      <DateTimeSheet
        visible={picker === 'date'}
        value={due}
        timeFormat={prefs.timeFormat}
        onClose={() => setPicker(null)}
        onPick={next => {
          setDue(next || null);
          if (!next) setRepeat('');
        }}
      />
      <Sheet
        visible={picker === 'repeat'}
        onClose={() => setPicker(null)}
        title="반복"
      >
        {(['', ...Object.keys(REPEAT_LABEL)] as string[]).map(period => (
          <Row
            key={period || 'none'}
            selected={repeat === period}
            onPress={() => {
              setRepeat(period);
              // A repeat needs a due date to count from: today's end by default.
              if (period && !due) setDue(today());
              setPicker(null);
            }}
          >
            <Text style={{ flex: 1, color: theme.text, fontSize: 15 }}>
              {period ? REPEAT_LABEL[period] : '안 함'}
            </Text>
            {repeat === period && <Check color={theme.accent} size={18} />}
          </Row>
        ))}
      </Sheet>
      <Sheet
        visible={picker === 'category'}
        onClose={() => setPicker(null)}
        title="카테고리"
      >
        <ScrollView style={{ maxHeight: 360 }}>
          {/* A secret category only when it is the current view. */}
          {(model?.categories ?? [])
            .filter(c => !c.secret || categories.includes(c.cid))
            .map(c => {
              const on = categories.includes(c.cid);
              return (
                <Row
                  key={c.cid}
                  onPress={() =>
                    setCategories(
                      on
                        ? categories.filter(id => id !== c.cid)
                        : [...categories, c.cid],
                    )
                  }
                >
                  {c.secret ? (
                    <KeyRound color={theme.warning} size={16} />
                  ) : (
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: c.color || theme.accent,
                      }}
                    />
                  )}
                  <Text style={{ flex: 1, color: theme.text, fontSize: 15 }}>
                    {c.title}
                  </Text>
                  {on && <Check color={theme.accent} size={18} />}
                </Row>
              );
            })}
          {!model?.categories.length && (
            <Text
              style={{ color: theme.muted, fontSize: 13, marginHorizontal: 20 }}
            >
              카테고리가 없어요.
            </Text>
          )}
        </ScrollView>
        <Text
          style={{
            color: theme.muted,
            fontSize: 12,
            marginHorizontal: 20,
            marginVertical: 8,
          }}
        >
          여러 개 고를 수 있어요. 지금 보는 카테고리는 처음부터 골라져 있어요.
        </Text>
        <Button kind="primary" label="완료" onPress={() => setPicker(null)} />
      </Sheet>
    </Sheet>
  );
}
