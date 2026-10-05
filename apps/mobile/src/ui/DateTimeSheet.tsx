import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Button, Chip, IconButton, Sheet } from './kit';
import { endOfDay } from './dateTime';
import { useTheme } from './theme';

const ITEM = 36;
const WEEKDAYS = '일월화수목금토';

const isEndOfDay = (time: number) => {
  const d = new Date(time);
  return d.getHours() === 23 && d.getMinutes() === 59;
};
const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// One scrolling column of the time wheel; the middle row is the value.
function Wheel({
  items,
  index,
  onChange,
  width,
}: {
  items: string[];
  index: number;
  onChange: (index: number) => void;
  width: number;
}) {
  const theme = useTheme();
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.y / ITEM);
    const clamped = Math.max(0, Math.min(items.length - 1, next));
    if (clamped !== index) onChange(clamped);
  };
  return (
    <ScrollView
      ref={ref}
      style={{ width, height: ITEM * 3, flexGrow: 0 }}
      contentContainerStyle={{ paddingVertical: ITEM }}
      contentOffset={{ x: 0, y: index * ITEM }}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM}
      decelerationRate="fast"
      nestedScrollEnabled
      onMomentumScrollEnd={settle}
      onScrollEndDrag={settle}
    >
      {items.map((item, i) => (
        <Pressable
          key={item + i}
          onPress={() => {
            ref.current?.scrollTo({ y: i * ITEM, animated: true });
            onChange(i);
          }}
          style={{
            height: ITEM,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              color: i === index ? theme.text : theme.muted,
              fontSize: i === index ? 18 : 15,
              fontWeight: i === index ? '700' : '400',
              fontVariant: ['tabular-nums'],
            }}
          >
            {item}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// App date & time picker (#96 mock): a month, quick days, and the time as either the
// end of the day or a wheel (AM/PM · hour : minute). Picking the day keeps the time.
export function DateTimeSheet({
  visible,
  value,
  onClose,
  onPick,
  timeFormat = '12',
  allowNone = true,
}: {
  visible: boolean;
  value: number | null;
  onClose: () => void;
  // 0 = no due date.
  onPick: (next: number) => void;
  timeFormat?: '12' | '24';
  allowNone?: boolean;
}) {
  const theme = useTheme();
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const [custom, setCustom] = useState(false);
  const [hour, setHour] = useState(18);
  const [minute, setMinute] = useState(0);

  // Each time it opens: start from the current value.
  useEffect(() => {
    if (!visible) return;
    const base = value ? new Date(value) : new Date();
    setDay(startOfDay(base));
    setMonth(new Date(base.getFullYear(), base.getMonth(), 1));
    setCustom(!!value && !isEndOfDay(value));
    setHour(value && !isEndOfDay(value) ? base.getHours() : 18);
    setMinute(value && !isEndOfDay(value) ? base.getMinutes() : 0);
  }, [visible, value]);

  const result = () =>
    custom
      ? new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          hour,
          minute,
        ).getTime()
      : endOfDay(day);
  const timeText = () => {
    if (!custom) return '하루 끝';
    const m = String(minute).padStart(2, '0');
    if (timeFormat === '24') return `${String(hour).padStart(2, '0')}:${m}`;
    return `${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}:${m}`;
  };

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const cells: Date[] = [];
  for (let i = first.getDay(); i > 0; i--)
    cells.push(new Date(month.getFullYear(), month.getMonth(), 1 - i));
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= days; d++)
    cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  for (let d = 1; cells.length % 7; d++)
    cells.push(new Date(month.getFullYear(), month.getMonth() + 1, d));
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) =>
    cells.slice(i * 7, i * 7 + 7),
  );
  const now = new Date();
  const jump = (date: Date) => {
    setDay(startOfDay(date));
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  };
  const nextMonday = () => {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return d;
  };

  const hours =
    timeFormat === '24'
      ? Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
      : Array.from({ length: 12 }, (_, i) => String(i + 1));
  const hourIndex = timeFormat === '24' ? hour : (hour % 12 || 12) - 1;
  const setHourIndex = (i: number) =>
    setHour(timeFormat === '24' ? i : ((i + 1) % 12) + (hour >= 12 ? 12 : 0));
  const minutes = Array.from({ length: 60 }, (_, i) =>
    String(i).padStart(2, '0'),
  );

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 20,
          paddingRight: 8,
          paddingBottom: 4,
        }}
      >
        <Text
          style={{
            flex: 1,
            color: theme.text,
            fontSize: 17,
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
          <ChevronLeft color={theme.secondary} size={20} />
        </IconButton>
        <IconButton
          label="다음 달"
          onPress={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
        >
          <ChevronRight color={theme.secondary} size={20} />
        </IconButton>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: 6,
          paddingHorizontal: 18,
          paddingBottom: 8,
        }}
      >
        <Chip label="오늘" onPress={() => jump(new Date())} />
        <Chip
          label="내일"
          onPress={() => {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            jump(d);
          }}
        />
        <Chip label="다음 주 월요일" onPress={() => jump(nextMonday())} />
        {allowNone && (
          <Chip
            label="기한 없음"
            onPress={() => {
              onPick(0);
              onClose();
            }}
          />
        )}
      </ScrollView>
      <View style={{ paddingHorizontal: 12 }}>
        <View style={{ flexDirection: 'row' }}>
          {WEEKDAYS.split('').map(w => (
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
        {weeks.map(week => (
          <View key={week[0].getTime()} style={{ flexDirection: 'row' }}>
            {week.map(date => {
              const inMonth = date.getMonth() === month.getMonth();
              const selected = sameDay(date, day);
              const isToday = sameDay(date, now);
              return (
                <Pressable
                  key={date.getTime()}
                  accessibilityRole="button"
                  accessibilityLabel={`${
                    date.getMonth() + 1
                  }월 ${date.getDate()}일`}
                  onPress={() => jump(date)}
                  style={{
                    flex: 1,
                    height: 38,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: selected ? theme.accent : 'transparent',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: isToday || selected ? '700' : '400',
                        color: selected
                          ? theme.accentText
                          : isToday
                          ? theme.accent
                          : theme.text,
                        opacity: inMonth ? 1 : 0.4,
                      }}
                    >
                      {date.getDate()}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <Text
        style={{
          color: theme.muted,
          fontSize: 12,
          fontWeight: '600',
          paddingHorizontal: 18,
          paddingTop: 12,
          paddingBottom: 6,
        }}
      >
        시간
      </Text>
      <View
        style={{
          flexDirection: 'row',
          gap: 6,
          paddingHorizontal: 18,
          paddingBottom: 10,
        }}
      >
        <Chip
          label="하루 끝 (오후 11:59)"
          selected={!custom}
          onPress={() => setCustom(false)}
        />
        <Chip
          label="직접 입력"
          selected={custom}
          onPress={() => setCustom(true)}
        />
      </View>
      {custom && (
        <View
          style={{
            marginHorizontal: 18,
            marginBottom: 12,
            paddingVertical: 4,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 10,
              right: 10,
              top: 4 + ITEM,
              height: ITEM,
              borderRadius: 10,
              backgroundColor: theme.selected,
            }}
          />
          {timeFormat === '12' && (
            <Wheel
              key={`ampm-${visible}`}
              items={['오전', '오후']}
              index={hour >= 12 ? 1 : 0}
              width={64}
              onChange={i => setHour((hour % 12) + (i ? 12 : 0))}
            />
          )}
          <Wheel
            key={`hour-${visible}`}
            items={hours}
            index={hourIndex}
            width={64}
            onChange={setHourIndex}
          />
          <Text
            style={{
              width: 12,
              textAlign: 'center',
              color: theme.text,
              fontSize: 18,
              fontWeight: '700',
            }}
          >
            :
          </Text>
          <Wheel
            key={`minute-${visible}`}
            items={minutes}
            index={minute}
            width={64}
            onChange={setMinute}
          />
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 18 }}>
        <Button
          kind="ghost"
          label="취소"
          onPress={onClose}
          style={{ flex: 1, marginHorizontal: 0 }}
        />
        <Button
          kind="primary"
          label={`${day.getMonth() + 1}월 ${day.getDate()}일 (${
            WEEKDAYS[day.getDay()]
          }) ${timeText()}`}
          onPress={() => {
            onPick(result());
            onClose();
          }}
          style={{ flex: 2, marginHorizontal: 0 }}
        />
      </View>
    </Sheet>
  );
}
