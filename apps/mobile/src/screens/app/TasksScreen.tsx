import { useMemo, useState } from 'react';
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
  ChevronDown,
  Layers,
  Plus,
  Search,
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
import { formatDue } from '@/core/model/view';
import { pickDueDate, today, tomorrow } from '@/ui/dateTime';
import { useTheme } from '@/ui/theme';
import { AppBar, SectionHeader, SyncLine, TaskItem, useNow } from './parts';

const SORTS: [SortMode, string][] = [
  ['due', '기한 순'],
  ['importance', '중요도 순'],
  ['remaining', '남은 기한 순'],
  ['created', '생성일 순'],
];

export function scopeTitle(scope: Scope, model: Model | null) {
  if (scope.kind === 'all') return '모든 할 일';
  if (scope.kind === 'today') return '오늘';
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.canvas }}>
      <AppBar
        onTitlePress={() => setPicking(true)}
        title={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
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
      <SyncLine extra={`${tasks.length}개의 할 일 · ${done.length}개 완료`} />
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
        onSelect={next => {
          setScope(next);
          setPicking(false);
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
  const { model } = useApp();
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const count = (s: Scope) =>
    model ? visibleTasks(model, s).filter(t => !t.done).length : 0;
  const rows: { scope: Scope; label: string; icon: React.ReactNode }[] = [
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
    ...(model?.categories ?? []).map(c => ({
      scope: { kind: 'category', cid: c.cid } as Scope,
      label: c.title,
      icon: (
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
            <Text style={{ flex: 1, color: theme.text, fontSize: 15 }}>
              {row.label}
            </Text>
            <Text style={{ color: theme.muted, fontSize: 13 }}>
              {count(row.scope)}
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
  const reset = () => {
    setTitle('');
    setDue(defaultDue ?? (scope.kind === 'today' ? today() : null));
    setCategories(scope.kind === 'category' ? [scope.cid] : []);
  };
  const add = () => {
    if (!title.trim()) return;
    mutate('task/addTask', [
      {
        title: title.trim(),
        due_date: due ?? undefined,
        categories,
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
              : '날짜·시간…'
          }
          selected={!!due && !isToday && !isTomorrow}
          onPress={async () => {
            const next = await pickDueDate(due, prefs.timeFormat === '24');
            if (next !== undefined) setDue(next);
          }}
        />
        {/* Categories toggle on and off; a secret one only when it is the current view. */}
        {(model?.categories ?? [])
          .filter(c => !c.secret || categories.includes(c.cid))
          .map(c => {
            const on = categories.includes(c.cid);
            return (
              <Chip
                key={c.cid}
                label={c.title}
                selected={on}
                onPress={() =>
                  setCategories(
                    on
                      ? categories.filter(id => id !== c.cid)
                      : [...categories, c.cid],
                  )
                }
              />
            );
          })}
      </ScrollView>
      <Button
        kind="primary"
        label="추가"
        disabled={!title.trim()}
        onPress={add}
      />
      <Text style={{ color: theme.muted, fontSize: 12, marginHorizontal: 20 }}>
        메모·하위 할 일·반복은 추가한 뒤 상세에서 넣을 수 있어요.
      </Text>
    </Sheet>
  );
}
