import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import { visibleTasks, type TaskRow } from '@/core/model/view';
import { IconButton } from '@/ui/kit';
import { endOfDay } from '@/ui/dateTime';
import { useTheme } from '@/ui/theme';
import { AddTaskSheet, Fab } from './TasksScreen';
import { TaskItem, useNow } from './parts';

const key = (d: Date) =>
  `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

// Month grid + the selected day's tasks (desktop calendar view, #95 rules: a
// selected "today" follows to the next day at midnight).
export default function CalendarScreen() {
  const { model, scope, prefs } = useApp();
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const now = useNow(30000);
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selected, setSelected] = useState(() => key(new Date()));
  const [adding, setAdding] = useState(false);

  const todayKey = key(new Date(now));
  const lastToday = useRef(todayKey);
  useEffect(() => {
    if (lastToday.current === todayKey) return;
    if (selected === lastToday.current) {
      setSelected(todayKey);
      const today = new Date(now);
      setMonth(current =>
        current.getMonth() === new Date(now - 86400000).getMonth()
          ? new Date(today.getFullYear(), today.getMonth(), 1)
          : current,
      );
    }
    lastToday.current = todayKey;
  }, [todayKey, selected, now]);

  const byDay = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    if (!model) return map;
    for (const task of visibleTasks(model, scope, { now })) {
      if (task.dueDate == null) continue;
      const k = key(new Date(task.dueDate));
      map.set(k, [...(map.get(k) ?? []), task]);
    }
    for (const list of map.values())
      list.sort(
        (a, b) =>
          Number(a.done) - Number(b.done) ||
          (a.dueDate ?? 0) - (b.dueDate ?? 0),
      );
    return map;
  }, [model, scope, now]);

  const weekStart = prefs.weekStart;
  const first = new Date(month);
  const leading = (first.getDay() - weekStart + 7) % 7;
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  const cells: Date[] = [];
  for (let i = leading; i > 0; i--)
    cells.push(new Date(month.getFullYear(), month.getMonth(), 1 - i));
  for (let d = 1; d <= daysInMonth; d++)
    cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  for (let next = 1; cells.length % 7; next++)
    cells.push(new Date(month.getFullYear(), month.getMonth() + 1, next));
  // One row per week: percentage widths in a wrapping row round past 100% on
  // Android and push the last day to the next line.
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) =>
    cells.slice(i * 7, i * 7 + 7),
  );
  const weekdays = Array.from(
    { length: 7 },
    (_, i) => '일월화수목금토'[(weekStart + i) % 7],
  );
  const selectedDate = (() => {
    const [y, m, d] = selected.split('-').map(Number);
    return new Date(y, m - 1, d);
  })();
  const dayTasks = byDay.get(selected) ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.canvas }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 18,
          paddingRight: 8,
          paddingTop: 8,
          minHeight: 56,
        }}
      >
        <Text
          style={{
            flex: 1,
            color: theme.text,
            fontSize: 20,
            fontWeight: '700',
          }}
        >
          {month.getFullYear()}년 {month.getMonth() + 1}월
        </Text>
        <IconButton
          label="이전 달"
          onPress={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
        >
          <ChevronLeft color={theme.secondary} size={22} />
        </IconButton>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            const today = new Date();
            setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
            setSelected(key(today));
          }}
          style={{ paddingHorizontal: 10, paddingVertical: 8 }}
        >
          <Text style={{ color: theme.secondary, fontSize: 14 }}>오늘</Text>
        </Pressable>
        <IconButton
          label="다음 달"
          onPress={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
        >
          <ChevronRight color={theme.secondary} size={22} />
        </IconButton>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        <View style={{ flexDirection: 'row', paddingHorizontal: 8 }}>
          {weekdays.map(w => (
            <Text
              key={w}
              style={{
                flex: 1,
                textAlign: 'center',
                color: theme.muted,
                fontSize: 11,
                paddingVertical: 4,
              }}
            >
              {w}
            </Text>
          ))}
        </View>
        <View style={{ paddingHorizontal: 8 }}>
          {weeks.map(week => (
            <View key={key(week[0])} style={{ flexDirection: 'row' }}>
              {week.map(date => {
                const k = key(date);
                const inMonth = date.getMonth() === month.getMonth();
                const tasks = byDay.get(k) ?? [];
                const isToday = k === todayKey;
                const isSelected = k === selected;
                const dow = date.getDay();
                return (
                  <Pressable
                    key={k}
                    accessibilityRole="button"
                    accessibilityLabel={`${
                      date.getMonth() + 1
                    }월 ${date.getDate()}일, 할 일 ${tasks.length}개`}
                    onPress={() => setSelected(k)}
                    style={{
                      flex: 1,
                      height: 54,
                      alignItems: 'center',
                      paddingTop: 5,
                      gap: 3,
                      borderRadius: 12,
                      backgroundColor: isSelected
                        ? theme.selected
                        : 'transparent',
                      opacity: inMonth ? 1 : 0.45,
                    }}
                  >
                    <View
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 13,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isToday ? theme.accent : 'transparent',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 14,
                          color: isToday
                            ? theme.accentText
                            : dow === 0
                            ? theme.danger
                            : dow === 6
                            ? theme.accent
                            : theme.text,
                        }}
                      >
                        {date.getDate()}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 3 }}>
                      {tasks.slice(0, 3).map(t => (
                        <View
                          key={t.tid}
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: 3,
                            backgroundColor: t.done
                              ? theme.success
                              : theme.accent,
                          }}
                        />
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
        <View
          style={{
            flexDirection: 'row',
            paddingHorizontal: 18,
            paddingTop: 14,
            paddingBottom: 8,
          }}
        >
          <Text
            style={{
              flex: 1,
              color: theme.text,
              fontWeight: '700',
              fontSize: 15,
            }}
          >
            {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일 (
            {'일월화수목금토'[selectedDate.getDay()]})
          </Text>
          <Text style={{ color: theme.muted, fontSize: 12 }}>
            {dayTasks.length}개
          </Text>
        </View>
        {dayTasks.length === 0 && (
          <Text
            style={{ color: theme.muted, fontSize: 13, paddingHorizontal: 18 }}
          >
            등록된 할 일이 없어요. 여유로운 하루를 계획해보세요.
          </Text>
        )}
        {model &&
          dayTasks.map(task => (
            <TaskItem
              key={task.tid}
              task={task}
              model={model}
              now={now}
              onPress={() =>
                navigation.navigate('TaskDetail', { tid: task.tid })
              }
            />
          ))}
      </ScrollView>
      <Fab onPress={() => setAdding(true)} disabled={!model} />
      {adding && (
        <AddTaskSheet
          visible
          onClose={() => setAdding(false)}
          scope={scope}
          defaultDue={endOfDay(selectedDate)}
        />
      )}
    </View>
  );
}
