import { useMemo, useState } from 'react';
import { FlatList, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import { sortTasks, visibleTasks } from '@/core/model/view';
import { IconButton } from '@/ui/kit';
import { useTheme } from '@/ui/theme';
import { TaskItem, useListNow } from './parts';

// Title, memo and category names, across all lists (desktop search box).
export default function SearchScreen() {
  const { model, prefs } = useApp();
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const now = useListNow(model?.tasks, prefs);
  const day = new Date(now).setHours(0, 0, 0, 0);
  const [query, setQuery] = useState('');
  const results = useMemo(
    () =>
      model && query.trim()
        ? sortTasks(
            visibleTasks(model, { kind: 'all' }, { now: day, query }),
            'due',
          )
        : [],
    [model, query, day],
  );
  return (
    <View style={{ flex: 1, backgroundColor: theme.canvas }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 8,
          paddingTop: 8,
          paddingBottom: 8,
        }}
      >
        <IconButton label="뒤로" onPress={() => navigation.goBack()}>
          <ArrowLeft color={theme.secondary} size={22} />
        </IconButton>
        <TextInput
          autoFocus
          placeholder="할 일, 메모, 카테고리 검색"
          placeholderTextColor={theme.muted}
          value={query}
          onChangeText={setQuery}
          style={{
            flex: 1,
            marginRight: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
            color: theme.text,
            fontSize: 15,
          }}
        />
      </View>
      <FlatList
        data={results}
        keyExtractor={task => task.tid}
        renderItem={({ item }) => (
          <TaskItem
            task={item}
            model={model!}
            now={now}
            onPress={() => navigation.navigate('TaskDetail', { tid: item.tid })}
          />
        )}
        ListEmptyComponent={
          query.trim() ? (
            <Text
              style={{ color: theme.muted, textAlign: 'center', marginTop: 40 }}
            >
              찾는 할 일이 없어요.
            </Text>
          ) : undefined
        }
      />
    </View>
  );
}
