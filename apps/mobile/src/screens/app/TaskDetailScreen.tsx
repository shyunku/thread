import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ScrollViewInstance,
  type TextInputInstance,
  type ViewInstance,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Plus, Star, Trash2, X } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import {
  REPEAT_LABEL,
  formatDue,
  remainingText,
  type SubtaskRow,
} from '@/core/model/view';
import { dropIndex, subtaskMoveAnchor } from '@/core/model/subtaskOrder';
import { DateTimeSheet } from '@/ui/DateTimeSheet';
import { IconButton, Row, Sheet } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { CheckCircle, SectionHeader, useNow } from './parts';

// The undo notice after a subtask delete stays this long (like the PC's, #107).
export const UNDO_MS = 5000;
// Holding a subtask row this long lifts it for dragging (#112).
const LIFT_MS = 400;

// The field the keyboard is up for: title, memo, the add field or a subtask name.
type Field = 'title' | 'memo' | 'add' | `sub:${string}`;
type Box = { y: number; h: number };
type Editing = { sid: string; text: string; from: string };
type Drag = {
  sid: string;
  base: string[];
  order: string[];
  startY: number;
  center: number;
  others: { sid: string; mid: number }[];
  granted: boolean;
};
type Notice = {
  n: number;
  snapshot: Record<string, unknown>;
  near: { prevId: string | null; nextId: string | null };
};

// Same edits as the desktop task panel: title, due date, repeat, categories,
// subtasks and memo. Each change is one encrypted mutation.
export default function TaskDetailScreen() {
  const { model, mutate, prefs } = useApp();
  const navigation = useNavigation<any>();
  const { tid } = useRoute().params as { tid: string };
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const task = model?.tasks.find(t => t.tid === tid);
  const [title, setTitle] = useState(task?.title ?? '');
  const [memo, setMemo] = useState(task?.memo ?? '');
  const [newSubtask, setNewSubtask] = useState('');
  const [sheet, setSheet] = useState<'repeat' | 'category' | 'due' | null>(
    null,
  );
  // Subtasks (#112): the name being edited, the field in use, the lifted row and the
  // undo notice. The refs carry the same values for keyboard and touch callbacks.
  const [editing, setEditingState] = useState<Editing | null>(null);
  const [focus, setFocusState] = useState<Field | null>(null);
  const [keyboard, setKeyboard] = useState(() => Keyboard.isVisible());
  const [drag, setDrag] = useState<{ sid: string; order: string[] } | null>(
    null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(insets.top);
  const editRef = useRef<Editing | null>(null);
  const focusRef = useRef<Field | null>(null);
  const addText = useRef('');
  const dragRef = useRef<Drag | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeSeq = useRef(0);
  const rootRef = useRef<ViewInstance>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const addInput = useRef<TextInputInstance>(null);
  const editInput = useRef<TextInputInstance>(null);
  // Layout in the scroll content, for showing the field in use above the keyboard.
  const boxes = useRef({
    scroll: 0,
    height: 0,
    list: 0,
    title: null as Box | null,
    add: null as Box | null,
    memo: null as Box | null,
    rows: new Map<string, Box>(),
  });
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef({ task, mutate });
  live.current = { task, mutate };

  const setEditing = (next: Editing | null) => {
    editRef.current = next;
    setEditingState(next);
  };
  const setFocus = (next: Field | null) => {
    focusRef.current = next;
    setFocusState(next);
  };
  const blurred = (field: Field) => {
    if (focusRef.current === field) setFocus(null);
  };

  // Scrolls the field in use just above the keyboard (after the layout settles).
  const reveal = () => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => {
      const field = focusRef.current;
      const b = boxes.current;
      if (!field || !b.height) return;
      let box: Box | null = null;
      if (field === 'title') box = b.title;
      else if (field === 'memo') box = b.memo;
      else if (field === 'add') box = b.add;
      else {
        const row = b.rows.get(field.slice(4));
        if (row) box = { y: b.list + row.y, h: row.h };
      }
      if (!box) return;
      const bottom = box.y + box.h;
      if (bottom > b.scroll + b.height - 10)
        scrollRef.current?.scrollTo({ y: bottom - b.height + 10 });
      else if (box.y < b.scroll)
        scrollRef.current?.scrollTo({ y: Math.max(0, box.y - 8) });
    }, 60);
  };
  const focused = (field: Field) => {
    setFocus(field);
    reveal();
  };

  // 완료, a tap elsewhere or the keyboard going away adds what is typed.
  const commitAdd = () => {
    const text = addText.current.trim();
    addText.current = '';
    setNewSubtask('');
    const current = live.current;
    if (!text || !current.task) return;
    current.mutate('task/createSubtask', [
      { title: text, created_at: Date.now() },
      tid,
    ]);
  };
  // Saves a changed name; an empty one goes back to the name it had.
  const commitEdit = (sid: string) => {
    const edit = editRef.current;
    if (!edit || edit.sid !== sid) return;
    setEditing(null);
    const current = live.current;
    const sub = current.task?.subtasks.find(s => s.sid === sid);
    const text = edit.text.trim();
    if (!sub || !text || text === edit.from || text === sub.title) return;
    current.mutate('task/updateSubtaskTitle', [tid, sid, text]);
  };
  const handlers = useRef({ commitAdd, commitEdit });
  handlers.current = { commitAdd, commitEdit };

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setMemo(task.memo);
    }
    // Only when another device changed the saved values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.title, task?.memo]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboard(true);
      reveal();
    });
    // Android's back gesture hides the keyboard but can leave the field focused.
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboard(false);
      const field = focusRef.current;
      if (field === 'add') {
        handlers.current.commitAdd();
        addInput.current?.blur();
      } else if (field?.startsWith('sub:')) editInput.current?.blur();
    });
    return () => {
      show.remove();
      hide.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the screen keeps what was typed in the subtask fields.
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (revealTimer.current) clearTimeout(revealTimer.current);
      try {
        const edit = editRef.current;
        if (edit) handlers.current.commitEdit(edit.sid);
        handlers.current.commitAdd();
      } catch {}
    },
    [],
  );

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

  // Rows in the shown order; while dragging, the order the lifted row makes.
  const subtasks = task.subtasks;
  let shown = subtasks;
  if (drag) {
    const byId = new Map(subtasks.map(s => [s.sid, s]));
    shown = [
      ...drag.order.flatMap(sid => byId.get(sid) ?? []),
      ...subtasks.filter(s => !drag.order.includes(s.sid)),
    ];
  }

  const startEdit = (sub: SubtaskRow) => {
    if (dragRef.current || editRef.current?.sid === sub.sid) return;
    if (editRef.current) commitEdit(editRef.current.sid);
    setEditing({ sid: sub.sid, text: sub.title, from: sub.title });
  };

  // Deletes right away; the notice can put it back in the same place for UNDO_MS.
  const removeSubtask = (sub: SubtaskRow) => {
    const i = shown.findIndex(s => s.sid === sub.sid);
    const near = {
      prevId: shown[i - 1]?.sid ?? null,
      nextId: shown[i + 1]?.sid ?? null,
    };
    const snapshot: Record<string, unknown> = {
      title: sub.title,
      done: sub.done,
      created_at: sub.createdAt,
    };
    if (sub.done && sub.doneAt) snapshot.done_at = sub.doneAt;
    if (sub.dueDate) snapshot.due_date = sub.dueDate;
    if (editRef.current?.sid === sub.sid) setEditing(null);
    mutate('task/deleteSubtask', [tid, sub.sid]);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ n: ++noticeSeq.current, snapshot, near });
    noticeTimer.current = setTimeout(() => setNotice(null), UNDO_MS);
  };
  const undoRemove = () => {
    if (!notice) return;
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(null);
    try {
      mutate('task/restoreSubtask', [tid, notice.snapshot, notice.near]);
    } catch {}
  };

  // Hold a row to lift it, then drag it up or down (#112). Off while a field is in use.
  const canLift = !focus && !keyboard && !editing && subtasks.length > 1;
  const lift = (sid: string, event: GestureResponderEvent) => {
    if (!canLift || dragRef.current) return;
    const rows = boxes.current.rows;
    const base = subtasks.map(s => s.sid);
    if (base.some(id => !rows.has(id))) return;
    const self = rows.get(sid)!;
    dragRef.current = {
      sid,
      base,
      order: base,
      startY: event.nativeEvent.pageY,
      center: self.y + self.h / 2,
      others: base
        .filter(id => id !== sid)
        .map(id => ({ sid: id, mid: rows.get(id)!.y + rows.get(id)!.h / 2 })),
      granted: false,
    };
    setDrag({ sid, order: base });
  };
  const dragTo = (pageY: number) => {
    const d = dragRef.current;
    if (!d) return;
    const order = d.others.map(o => o.sid);
    order.splice(
      dropIndex(
        d.others.map(o => o.mid),
        d.center + pageY - d.startY,
      ),
      0,
      d.sid,
    );
    if (order.join() === d.order.join()) return;
    d.order = order;
    setDrag({ sid: d.sid, order });
  };
  const drop = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDrag(null);
    const anchor = subtaskMoveAnchor(d.base, d.sid, d.order.indexOf(d.sid));
    if (anchor)
      mutate('task/updateSubtaskOrder', [
        tid,
        d.sid,
        anchor.anchorId,
        anchor.after,
      ]);
  };
  // A lift released without moving: the row goes back down.
  const released = () => {
    if (dragRef.current && !dragRef.current.granted) drop();
  };

  const layoutOf = (event: LayoutChangeEvent): Box => ({
    y: event.nativeEvent.layout.y,
    h: event.nativeEvent.layout.height,
  });

  return (
    <View
      ref={rootRef}
      collapsable={false}
      // The keyboard's top is in window coordinates; the screen starts below the status bar.
      onLayout={() =>
        rootRef.current?.measureInWindow((_x, y) => setKeyboardOffset(y))
      }
      style={{ flex: 1, backgroundColor: theme.canvas }}
    >
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={keyboardOffset}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 8,
              paddingTop: 8,
            }}
          >
            <IconButton label="뒤로" onPress={() => navigation.goBack()}>
              <ArrowLeft color={theme.secondary} size={22} />
            </IconButton>
            <View style={{ flex: 1 }} />
            <IconButton
              label={task.important ? '중요 해제' : '중요로 표시'}
              onPress={() =>
                mutate('task/updateTaskImportant', [tid, !task.important])
              }
            >
              <Star
                color={task.important ? theme.star : theme.secondary}
                fill={task.important ? theme.star : 'none'}
                size={22}
              />
            </IconButton>
            <IconButton label="삭제" onPress={remove}>
              <Trash2 color={theme.secondary} size={20} />
            </IconButton>
          </View>
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={!drag}
            scrollEventThrottle={16}
            onScroll={event => {
              boxes.current.scroll = event.nativeEvent.contentOffset.y;
            }}
            onLayout={event => {
              boxes.current.height = event.nativeEvent.layout.height;
              reveal();
            }}
            onContentSizeChange={reveal}
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            <View
              onLayout={event => {
                boxes.current.title = layoutOf(event);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 18,
                marginBottom: 10,
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
                onFocus={() => focused('title')}
                onBlur={() => {
                  blurred('title');
                  saveTitle();
                }}
                onSubmitEditing={saveTitle}
                multiline
                blurOnSubmit
                style={{
                  flex: 1,
                  color: theme.text,
                  fontSize: 22,
                  fontWeight: '700',
                  padding: 0,
                }}
              />
            </View>
            <Prop
              label="기한"
              value={
                task.dueDate
                  ? formatDue(task.dueDate, prefs.timeFormat)
                  : '없음'
              }
              hint={remaining?.text}
              hintDanger={remaining?.overdue && !task.done}
              onPress={() => setSheet('due')}
              onClear={
                task.dueDate
                  ? () => mutate('task/updateTaskDueDate', [tid, 0])
                  : undefined
              }
            />
            <Prop
              label="반복"
              value={
                task.repeatPeriod ? REPEAT_LABEL[task.repeatPeriod] : '없음'
              }
              disabled={!task.dueDate}
              hint={!task.dueDate ? '기한을 먼저 정하세요' : undefined}
              onPress={() => task.dueDate && setSheet('repeat')}
            />
            <Pressable
              onPress={() => setSheet('category')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 18,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderColor: theme.border,
              }}
            >
              <Text style={{ width: 70, color: theme.muted, fontSize: 13 }}>
                카테고리
              </Text>
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                {task.categories.length === 0 && (
                  <Text style={{ color: theme.muted }}>없음</Text>
                )}
                {task.categories.map(cid => (
                  <View
                    key={cid}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 6,
                      backgroundColor: theme.selected,
                    }}
                  >
                    <Text
                      style={{
                        color: theme.accent,
                        fontSize: 12,
                        fontWeight: '600',
                      }}
                    >
                      {model.categoryMap.get(cid)?.title}
                    </Text>
                  </View>
                ))}
              </View>
              <Plus color={theme.muted} size={18} />
            </Pressable>

            <SectionHeader
              label={`하위 할 일 ${doneCount}/${subtasks.length}`}
            />
            {/* While a row is lifted this list takes the touch from the row and moves it. */}
            <View
              testID="subtask-list"
              onLayout={event => {
                boxes.current.list = event.nativeEvent.layout.y;
              }}
              onMoveShouldSetResponderCapture={() => !!dragRef.current}
              onResponderGrant={() => {
                if (dragRef.current) dragRef.current.granted = true;
                // Keeps the scroll view from taking the touch.
                return true;
              }}
              onResponderMove={event => dragTo(event.nativeEvent.pageY)}
              onResponderRelease={drop}
              onResponderTerminate={drop}
              onResponderTerminationRequest={() => !dragRef.current}
            >
              {shown.map(sub => (
                <SubtaskItem
                  key={sub.sid}
                  sub={sub}
                  editing={editing?.sid === sub.sid ? editing.text : null}
                  lifted={drag?.sid === sub.sid}
                  canLift={canLift}
                  inputRef={editInput}
                  onLayout={event => {
                    boxes.current.rows.set(sub.sid, layoutOf(event));
                    if (focusRef.current === `sub:${sub.sid}`) reveal();
                  }}
                  onToggle={() =>
                    mutate('task/updateSubtaskDone', [
                      tid,
                      sub.sid,
                      !sub.done,
                      Date.now(),
                    ])
                  }
                  onEdit={() => startEdit(sub)}
                  onChangeText={text =>
                    editRef.current?.sid === sub.sid &&
                    setEditing({ ...editRef.current, text })
                  }
                  onFocus={() => focused(`sub:${sub.sid}`)}
                  onCommit={() => {
                    blurred(`sub:${sub.sid}`);
                    commitEdit(sub.sid);
                  }}
                  onRemove={() => removeSubtask(sub)}
                  onLift={event => lift(sub.sid, event)}
                  onPressOut={released}
                />
              ))}
            </View>
            <View
              onLayout={event => {
                boxes.current.add = layoutOf(event);
                if (focusRef.current === 'add') reveal();
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 18,
                paddingVertical: 4,
              }}
            >
              <Plus color={theme.muted} size={18} />
              <TextInput
                ref={addInput}
                placeholder="하위 할 일 추가"
                placeholderTextColor={theme.muted}
                value={newSubtask}
                onChangeText={text => {
                  addText.current = text;
                  setNewSubtask(text);
                }}
                onFocus={() => focused('add')}
                onBlur={() => {
                  blurred('add');
                  commitAdd();
                }}
                // 완료 adds and keeps the keyboard for the next one.
                onSubmitEditing={commitAdd}
                submitBehavior="submit"
                returnKeyType="done"
                style={{
                  flex: 1,
                  color: theme.text,
                  fontSize: 14,
                  paddingVertical: 8,
                }}
              />
            </View>

            <SectionHeader label="메모" />
            <TextInput
              value={memo}
              onChangeText={setMemo}
              onLayout={event => {
                boxes.current.memo = layoutOf(event);
                if (focusRef.current === 'memo') reveal();
              }}
              onFocus={() => focused('memo')}
              onBlur={() => {
                blurred('memo');
                saveMemo();
              }}
              multiline
              placeholder="메모할 내용을 적어주세요."
              placeholderTextColor={theme.muted}
              style={{
                marginHorizontal: 18,
                minHeight: 100,
                padding: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.surface,
                color: theme.text,
                fontSize: 14,
                textAlignVertical: 'top',
              }}
            />
          </ScrollView>
          {notice && (
            <UndoNotice
              key={notice.n}
              bottom={keyboard ? 10 : insets.bottom + 10}
              onUndo={undoRemove}
            />
          )}
        </View>
      </KeyboardAvoidingView>

      <DateTimeSheet
        visible={sheet === 'due'}
        value={task.dueDate}
        timeFormat={prefs.timeFormat}
        onClose={() => setSheet(null)}
        onPick={next => mutate('task/updateTaskDueDate', [tid, next])}
      />
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
            <Text style={{ color: theme.text, fontSize: 15 }}>
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
        <ScrollView style={{ maxHeight: 380 }}>
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
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: c.color || theme.accent,
                  }}
                />
                <Text style={{ flex: 1, color: theme.text, fontSize: 15 }}>
                  {c.title}
                </Text>
                {on && <Text style={{ color: theme.accent }}>✓</Text>}
              </Row>
            );
          })}
          {model.categories.length === 0 && (
            <Text style={{ color: theme.muted, marginHorizontal: 20 }}>
              카테고리가 없어요. 할 일 목록의 제목을 눌러 추가하세요.
            </Text>
          )}
        </ScrollView>
      </Sheet>
    </View>
  );
}

// One subtask (#112 mock): tap the name to edit it in place (it wraps), hold the row to
// lift it. The check and X keep working; a lifted row is lighter, raised and a bit larger.
function SubtaskItem({
  sub,
  editing,
  lifted,
  canLift,
  inputRef,
  onLayout,
  onToggle,
  onEdit,
  onChangeText,
  onFocus,
  onCommit,
  onRemove,
  onLift,
  onPressOut,
}: {
  sub: SubtaskRow;
  editing: string | null;
  lifted: boolean;
  canLift: boolean;
  inputRef: React.RefObject<TextInputInstance | null>;
  onLayout: (event: LayoutChangeEvent) => void;
  onToggle: () => void;
  onEdit: () => void;
  onChangeText: (text: string) => void;
  onFocus: () => void;
  onCommit: () => void;
  onRemove: () => void;
  onLift: (event: GestureResponderEvent) => void;
  onPressOut: () => void;
}) {
  const theme = useTheme();
  const longPress = canLift ? onLift : undefined;
  return (
    <Pressable
      testID={`subtask-${sub.sid}`}
      accessible={false}
      onLayout={onLayout}
      onLongPress={longPress}
      delayLongPress={LIFT_MS}
      onPressOut={onPressOut}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 18,
          paddingVertical: 8,
          backgroundColor: theme.canvas,
        },
        lifted && {
          zIndex: 5,
          borderRadius: 12,
          backgroundColor: theme.surface,
          transform: [{ scale: 1.03 }],
          elevation: 12,
          shadowColor: '#000',
          shadowOpacity: 0.55,
          shadowRadius: 13,
          shadowOffset: { width: 0, height: 10 },
        },
      ]}
    >
      <CheckCircle size={20} done={sub.done} onPress={onToggle} />
      {editing != null ? (
        <TextInput
          ref={inputRef}
          value={editing}
          onChangeText={onChangeText}
          onFocus={onFocus}
          onBlur={onCommit}
          onSubmitEditing={onCommit}
          autoFocus
          multiline
          submitBehavior="blurAndSubmit"
          returnKeyType="done"
          style={{
            flex: 1,
            color: theme.text,
            fontSize: 14,
            lineHeight: 20,
            paddingHorizontal: 0,
            paddingTop: 0,
            paddingBottom: 1,
            borderBottomWidth: 1,
            borderColor: theme.accent,
          }}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityHint="눌러서 이름 바꾸기"
          onPress={onEdit}
          onLongPress={longPress}
          delayLongPress={LIFT_MS}
          onPressOut={onPressOut}
          style={{ flex: 1 }}
        >
          <Text
            style={{
              color: sub.done ? theme.muted : theme.text,
              fontSize: 14,
              lineHeight: 20,
              textDecorationLine: sub.done ? 'line-through' : 'none',
            }}
          >
            {sub.title}
          </Text>
        </Pressable>
      )}
      <IconButton label="하위 할 일 삭제" onPress={onRemove}>
        <X color={theme.muted} size={16} />
      </IconButton>
    </Pressable>
  );
}

// "하위 할 일을 삭제했어요 · 되돌리기" for UNDO_MS, with a bar that drains (#112 mock).
function UndoNotice({ bottom, onUndo }: { bottom: number; onUndo: () => void }) {
  const theme = useTheme();
  const [drain] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const run = Animated.timing(drain, {
      toValue: 0,
      duration: UNDO_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [drain]);
  return (
    <View
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom,
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingLeft: 16,
        paddingRight: 6,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 12,
        backgroundColor: theme.surface,
        overflow: 'hidden',
        elevation: 8,
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
      }}
    >
      <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 14 }}>
        하위 할 일을 삭제했어요
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onUndo}
        hitSlop={4}
        style={{ height: 40, paddingHorizontal: 12, justifyContent: 'center' }}
      >
        <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '700' }}>
          되돌리기
        </Text>
      </Pressable>
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 2,
          backgroundColor: theme.accent,
          transformOrigin: 'left',
          transform: [{ scaleX: drain }],
        }}
      />
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
        gap: 12,
        paddingHorizontal: 18,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderColor: theme.border,
      }}
    >
      <Text style={{ width: 70, color: theme.muted, fontSize: 13 }}>
        {label}
      </Text>
      <Text
        style={{
          flex: 1,
          color: disabled ? theme.muted : theme.text,
          fontSize: 15,
        }}
      >
        {value}
      </Text>
      {!!hint && (
        <Text
          style={{
            color: hintDanger ? theme.danger : theme.muted,
            fontSize: 12,
          }}
        >
          {hint}
        </Text>
      )}
      {onClear && (
        <IconButton label={`${label} 지우기`} onPress={onClear}>
          <X color={theme.muted} size={16} />
        </IconButton>
      )}
    </Pressable>
  );
}
