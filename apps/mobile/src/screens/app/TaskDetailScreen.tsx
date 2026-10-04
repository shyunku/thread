import { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ArrowLeft, Plus, Trash2, X } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import { REPEAT_LABEL, formatDue, remainingText } from '@/core/model/view';
import { pickDueDate } from '@/ui/dateTime';
import { IconButton, Row, Sheet } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { CheckCircle, SectionHeader, useNow } from './parts';

// Same edits as the desktop task panel: title, due date, repeat, categories,
// subtasks and memo. Each change is one encrypted mutation.
export default function TaskDetailScreen() {
  const { model, mutate, prefs } = useApp();
  const navigation = useNavigation<any>();
  const { tid } = useRoute().params as { tid: string };
  const theme = useTheme();
  const now = useNow();
  const task = model?.tasks.find(t => t.tid === tid);
  const [title, setTitle] = useState(task?.title ?? '');
  const [memo, setMemo] = useState(task?.memo ?? '');
  const [newSubtask, setNewSubtask] = useState('');
  const [sheet, setSheet] = useState<'repeat' | 'category' | null>(null);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setMemo(task.memo);
    }
    // Only when another device changed the saved values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.title, task?.memo]);

  if (!task || !model) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.canvas,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: theme.muted }}>할 일이 삭제됐어요.</Text>
      </View>
    );
  }

  const saveTitle = () =>
    title.trim() &&
    title !== task.title &&
    mutate('task/updateTaskTitle', [tid, title.trim()]);
  const saveMemo = () =>
    memo !== task.memo && mutate('task/updateTaskMemo', [tid, memo]);
  const remaining = remainingText(task.dueDate, now);
  const doneCount = task.subtasks.filter(s => s.done).length;

  const remove = () =>
    Alert.alert(
      '할 일 삭제',
      `"${task.title}"을(를) 삭제할까요? 모든 기기에서 사라져요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            navigation.goBack();
            mutate('task/deleteTask', [tid]);
          },
        },
      ],
    );

  return (
    <View style={{ flex: 1, backgroundColor: theme.canvas }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 7,
          paddingTop: 7,
        }}
      >
        <IconButton label="뒤로" onPress={() => navigation.goBack()}>
          <ArrowLeft color={theme.secondary} size={19.5} />
        </IconButton>
        <View style={{ flex: 1 }} />
        <IconButton label="삭제" onPress={remove}>
          <Trash2 color={theme.secondary} size={17.5} />
        </IconButton>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 35 }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10.5,
            paddingHorizontal: 16,
            marginBottom: 9,
          }}
        >
          <CheckCircle
            done={task.done}
            onPress={() =>
              mutate('task/updateTaskDone', [tid, !task.done, Date.now()])
            }
          />
          <TextInput
            value={title}
            onChangeText={setTitle}
            onBlur={saveTitle}
            onSubmitEditing={saveTitle}
            multiline
            blurOnSubmit
            style={{
              flex: 1,
              color: theme.text,
              fontSize: 19.5,
              fontWeight: '700',
              padding: 0,
            }}
          />
        </View>
        <Prop
          label="기한"
          value={
            task.dueDate ? formatDue(task.dueDate, prefs.timeFormat) : '없음'
          }
          hint={remaining?.text}
          hintDanger={remaining?.overdue && !task.done}
          onPress={async () => {
            const next = await pickDueDate(
              task.dueDate,
              prefs.timeFormat === '24',
            );
            if (next !== undefined)
              mutate('task/updateTaskDueDate', [tid, next]);
          }}
          onClear={
            task.dueDate
              ? () => mutate('task/updateTaskDueDate', [tid, 0])
              : undefined
          }
        />
        <Prop
          label="반복"
          value={task.repeatPeriod ? REPEAT_LABEL[task.repeatPeriod] : '없음'}
          disabled={!task.dueDate}
          hint={!task.dueDate ? '기한을 먼저 정하세요' : undefined}
          onPress={() => task.dueDate && setSheet('repeat')}
        />
        <Pressable
          onPress={() => setSheet('category')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10.5,
            paddingHorizontal: 16,
            paddingVertical: 10.5,
            borderBottomWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Text style={{ width: 61.5, color: theme.muted, fontSize: 11.5 }}>
            카테고리
          </Text>
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 5.5,
            }}
          >
            {task.categories.length === 0 && (
              <Text style={{ color: theme.muted }}>없음</Text>
            )}
            {task.categories.map(cid => (
              <View
                key={cid}
                style={{
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: 5.5,
                  backgroundColor: theme.selected,
                }}
              >
                <Text
                  style={{
                    color: theme.accent,
                    fontSize: 10.5,
                    fontWeight: '600',
                  }}
                >
                  {model.categoryMap.get(cid)?.title}
                </Text>
              </View>
            ))}
          </View>
          <Plus color={theme.muted} size={16} />
        </Pressable>

        <SectionHeader
          label={`하위 할 일 ${doneCount}/${task.subtasks.length}`}
        />
        {task.subtasks.map(sub => (
          <View
            key={sub.sid}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 9,
              paddingHorizontal: 16,
              paddingVertical: 7,
            }}
          >
            <CheckCircle
              size={17.5}
              done={sub.done}
              onPress={() =>
                mutate('task/updateSubtaskDone', [
                  tid,
                  sub.sid,
                  !sub.done,
                  Date.now(),
                ])
              }
            />
            <Text
              style={{
                flex: 1,
                color: sub.done ? theme.muted : theme.text,
                fontSize: 12.5,
                textDecorationLine: sub.done ? 'line-through' : 'none',
              }}
            >
              {sub.title}
            </Text>
            <IconButton
              label="하위 할 일 삭제"
              onPress={() => mutate('task/deleteSubtask', [tid, sub.sid])}
            >
              <X color={theme.muted} size={14} />
            </IconButton>
          </View>
        ))}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 9,
            paddingHorizontal: 16,
            paddingVertical: 3.5,
          }}
        >
          <Plus color={theme.muted} size={16} />
          <TextInput
            placeholder="하위 할 일 추가"
            placeholderTextColor={theme.muted}
            value={newSubtask}
            onChangeText={setNewSubtask}
            onSubmitEditing={() => {
              if (!newSubtask.trim()) return;
              mutate('task/createSubtask', [
                { title: newSubtask.trim(), created_at: Date.now() },
                tid,
              ]);
              setNewSubtask('');
            }}
            blurOnSubmit={false}
            returnKeyType="done"
            style={{
              flex: 1,
              color: theme.text,
              fontSize: 12.5,
              paddingVertical: 7,
            }}
          />
        </View>

        <SectionHeader label="메모" />
        <TextInput
          value={memo}
          onChangeText={setMemo}
          onBlur={saveMemo}
          multiline
          placeholder="메모"
          placeholderTextColor={theme.muted}
          style={{
            marginHorizontal: 16,
            minHeight: 88,
            padding: 10.5,
            borderRadius: 10.5,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
            color: theme.text,
            fontSize: 12.5,
            textAlignVertical: 'top',
          }}
        />
      </ScrollView>

      <Sheet
        visible={sheet === 'repeat'}
        onClose={() => setSheet(null)}
        title="반복"
      >
        {(['', 'day', 'week', 'month', 'year'] as const).map(period => (
          <Row
            key={period || 'none'}
            selected={task.repeatPeriod === period}
            onPress={() => {
              mutate('task/updateTaskRepeatPeriod', [tid, period]);
              setSheet(null);
            }}
          >
            <Text style={{ color: theme.text, fontSize: 13 }}>
              {period ? REPEAT_LABEL[period] : '반복 안 함'}
            </Text>
          </Row>
        ))}
      </Sheet>
      <Sheet
        visible={sheet === 'category'}
        onClose={() => setSheet(null)}
        title="카테고리"
      >
        <ScrollView style={{ maxHeight: 334.5 }}>
          {model.categories.map(c => {
            const on = task.categories.includes(c.cid);
            return (
              <Row
                key={c.cid}
                selected={on}
                onPress={() =>
                  mutate(
                    on ? 'task/deleteTaskCategory' : 'task/addTaskCategory',
                    [tid, c.cid],
                  )
                }
              >
                <View
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 4.5,
                    backgroundColor: c.color || theme.accent,
                  }}
                />
                <Text style={{ flex: 1, color: theme.text, fontSize: 13 }}>
                  {c.title}
                </Text>
                {on && <Text style={{ color: theme.accent }}>✓</Text>}
              </Row>
            );
          })}
          {model.categories.length === 0 && (
            <Text style={{ color: theme.muted, marginHorizontal: 17.5 }}>
              카테고리가 없어요. 할 일 목록의 제목을 눌러 추가하세요.
            </Text>
          )}
        </ScrollView>
      </Sheet>
    </View>
  );
}

function Prop({
  label,
  value,
  hint,
  hintDanger,
  onPress,
  onClear,
  disabled,
}: {
  label: string;
  value: string;
  hint?: string;
  hintDanger?: boolean;
  onPress?: () => void;
  onClear?: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10.5,
        paddingHorizontal: 16,
        paddingVertical: 10.5,
        borderBottomWidth: 1,
        borderColor: theme.border,
      }}
    >
      <Text style={{ width: 61.5, color: theme.muted, fontSize: 11.5 }}>
        {label}
      </Text>
      <Text
        style={{
          flex: 1,
          color: disabled ? theme.muted : theme.text,
          fontSize: 13,
        }}
      >
        {value}
      </Text>
      {!!hint && (
        <Text
          style={{
            color: hintDanger ? theme.danger : theme.muted,
            fontSize: 10.5,
          }}
        >
          {hint}
        </Text>
      )}
      {onClear && (
        <IconButton label={`${label} 지우기`} onPress={onClear}>
          <X color={theme.muted} size={14} />
        </IconButton>
      )}
    </Pressable>
  );
}
