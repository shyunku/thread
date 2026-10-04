import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import { visibleTasks } from '@/core/model/view';
import { Chip, IconButton } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { useNow } from './parts';

const HOUR = 56;
const DAY = 86400000;

// Tasks placed at their due time over one day, three days or a week (desktop timeline).
// End-of-day tasks (no time) are listed above the hours.
export default function TimelineScreen() {
  const { model, scope, prefs } = useApp();
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const now = useNow(60000);
  const [span, setSpan] = useState<1 | 3 | 7>(1);
  const [start, setStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });

  const days = Array.from({ length: span }, (_, i) => start + i * DAY);
  const tasks = useMemo(
    () =>
      model
        ? visibleTasks(model, scope, { now }).filter(
            t =>
              t.dueDate != null &&
              t.dueDate >= start &&
              t.dueDate < start + span * DAY,
          )
        : [],
    [model, scope, now, start, span],
  );
  const timed = tasks.filter(t => {
    const d = new Date(t.dueDate!);
    return !(d.getHours() === 23 && d.getMinutes() === 59);
  });
  const allDay = tasks.filter(t => !timed.includes(t));
  const label = (time: number) => {
    const d = new Date(time);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${
      '일월화수목금토'[d.getDay()]
    })`;
  };
  const hourLabel = (h: number) =>
    prefs.timeFormat === '24'
      ? `${String(h).padStart(2, '0')}:00`
      : `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}시`;
  const timeLabel = (time: number) => {
    const d = new Date(time);
    const m = String(d.getMinutes()).padStart(2, '0');
    if (prefs.timeFormat === '24')
      return `${String(d.getHours()).padStart(2, '0')}:${m}`;
    return `${d.getHours() < 12 ? '오전' : '오후'} ${
      d.getHours() % 12 === 0 ? 12 : d.getHours() % 12
    }:${m}`;
  };
  const isToday = (day: number) => now >= day && now < day + DAY;

  return (
    <View style={{ flex: 1, backgroundColor: theme.canvas }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 16,
          paddingRight: 7,
          paddingTop: 7,
          minHeight: 49.5,
        }}
      >
        <Text
          style={{
            flex: 1,
            color: theme.text,
            fontSize: 17.5,
            fontWeight: '700',
          }}
        >
          {span === 1
            ? isToday(start)
              ? `오늘 · ${label(start)}`
              : label(start)
            : `${label(start)} ~`}
        </Text>
        <IconButton label="이전" onPress={() => setStart(start - span * DAY)}>
          <ChevronLeft color={theme.secondary} size={19.5} />
        </IconButton>
        <IconButton label="다음" onPress={() => setStart(start + span * DAY)}>
          <ChevronRight color={theme.secondary} size={19.5} />
        </IconButton>
      </View>
      <View
        style={{
          flexDirection: 'row',
          gap: 5.5,
          paddingHorizontal: 16,
          paddingBottom: 7,
        }}
      >
        <Chip label="하루" selected={span === 1} onPress={() => setSpan(1)} />
        <Chip label="3일" selected={span === 3} onPress={() => setSpan(3)} />
        <Chip label="한 주" selected={span === 7} onPress={() => setSpan(7)} />
      </View>
      {allDay.length > 0 && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 5.5, gap: 3.5 }}>
          {allDay.map(task => (
            <Pressable
              key={task.tid}
              onPress={() =>
                navigation.navigate('TaskDetail', { tid: task.tid })
              }
            >
              <Text
                numberOfLines={1}
                style={{
                  color: task.done ? theme.muted : theme.text,
                  fontSize: 11.5,
                  textDecorationLine: task.done ? 'line-through' : 'none',
                }}
              >
                {span > 1 ? `${new Date(task.dueDate!).getDate()}일 · ` : ''}
                하루 끝 · {task.title}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <ScrollView
        contentOffset={{ x: 0, y: HOUR * 7 - 12 }}
        contentContainerStyle={{ paddingBottom: 97 }}
      >
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: 51, height: HOUR * 24 }}>
            {Array.from({ length: 24 }, (_, h) => (
              <Text
                key={h}
                style={{
                  position: 'absolute',
                  top: h * HOUR - 7,
                  left: 0,
                  right: 0,
                  color: theme.muted,
                  fontSize: 9.5,
                  textAlign: 'right',
                  paddingRight: 7,
                }}
              >
                {h === 0 ? '' : hourLabel(h)}
              </Text>
            ))}
          </View>
          {days.map(day => (
            <View
              key={day}
              style={{
                flex: 1,
                borderLeftWidth: 1,
                borderColor: theme.border,
                height: HOUR * 24,
              }}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <View
                  key={h}
                  style={{
                    position: 'absolute',
                    top: h * HOUR,
                    left: 0,
                    right: 0,
                    borderTopWidth: 1,
                    borderColor: theme.border,
                    opacity: 0.5,
                  }}
                />
              ))}
              {isToday(day) && (
                <View
                  style={{
                    position: 'absolute',
                    top: ((now - day) / DAY) * HOUR * 24,
                    left: 0,
                    right: 0,
                    height: 2,
                    backgroundColor: theme.danger,
                  }}
                />
              )}
              {timed
                .filter(t => t.dueDate! >= day && t.dueDate! < day + DAY)
                .map(task => {
                  const overdue = !task.done && task.dueDate! < now;
                  return (
                    <Pressable
                      key={task.tid}
                      onPress={() =>
                        navigation.navigate('TaskDetail', { tid: task.tid })
                      }
                      style={{
                        position: 'absolute',
                        top: ((task.dueDate! - day) / DAY) * HOUR * 24 - 14,
                        left: 3.5,
                        right: 2,
                        minHeight: 24.5,
                        paddingHorizontal: 7,
                        paddingVertical: 3.5,
                        borderRadius: 7,
                        borderLeftWidth: 3,
                        borderColor: overdue ? theme.danger : theme.accent,
                        backgroundColor: theme.selected,
                        opacity: task.done ? 0.6 : 1,
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={{
                          color: theme.text,
                          fontSize: 10.5,
                          textDecorationLine: task.done
                            ? 'line-through'
                            : 'none',
                        }}
                      >
                        {task.title}
                        {span === 1 && (
                          <Text style={{ color: theme.secondary }}>
                            {` · ${timeLabel(task.dueDate!)}`}
                          </Text>
                        )}
                        {span === 1 && overdue && (
                          <Text style={{ color: theme.danger }}> 지남</Text>
                        )}
                      </Text>
                    </Pressable>
                  );
                })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
