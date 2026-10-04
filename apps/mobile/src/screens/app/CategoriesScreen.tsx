import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Trash2 } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import { Button, Field, IconButton } from '@/ui/kit';
import { useTheme } from '@/ui/theme';

// Desktop color picker palette (react-color CirclePicker defaults).
const COLORS = [
  '#f44336',
  '#e91e63',
  '#9c27b0',
  '#673ab7',
  '#3f51b5',
  '#2196f3',
  '#03a9f4',
  '#00bcd4',
  '#009688',
  '#4caf50',
  '#8bc34a',
  '#cddc39',
  '#ffeb3b',
  '#ffc107',
  '#ff9800',
  '#ff5722',
  '#795548',
  '#607d8b',
];

export default function CategoriesScreen() {
  const { model, mutate } = useApp();
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const add = () => {
    if (!name.trim()) return;
    mutate('category/createCategory', [
      {
        title: name.trim(),
        color: COLORS[(model?.categories.length ?? 0) % COLORS.length],
        created_at: Date.now(),
      },
    ]);
    setName('');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.canvas }}>
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
        <Text style={{ color: theme.text, fontSize: 19, fontWeight: '700' }}>
          카테고리
        </Text>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingVertical: 12 }}
      >
        <Field
          placeholder="새 카테고리 이름"
          value={name}
          onChangeText={setName}
          onSubmitEditing={add}
        />
        <Button
          kind="primary"
          label="추가"
          disabled={!name.trim()}
          onPress={add}
        />
        {model?.categories.map(c => (
          <View
            key={c.cid}
            style={{
              marginHorizontal: 12,
              marginBottom: 8,
              padding: 14,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surface,
            }}
          >
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <Pressable
                onPress={() => setEditing(editing === c.cid ? null : c.cid)}
                accessibilityLabel="색상 바꾸기"
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: c.color || theme.accent,
                  }}
                />
              </Pressable>
              <TextInput
                defaultValue={c.title}
                onEndEditing={e => {
                  const title = e.nativeEvent.text.trim();
                  if (title && title !== c.title)
                    mutate('category/updateCategoryTitle', [c.cid, title]);
                }}
                style={{ flex: 1, color: theme.text, fontSize: 15, padding: 0 }}
              />
              <IconButton
                label="삭제"
                onPress={() =>
                  Alert.alert(
                    '카테고리 삭제',
                    `"${c.title}"을(를) 삭제할까요? 할 일은 지워지지 않아요.`,
                    [
                      { text: '취소', style: 'cancel' },
                      {
                        text: '삭제',
                        style: 'destructive',
                        onPress: () => {
                          try {
                            mutate('category/deleteCategory', [c.cid]);
                          } catch (error: any) {
                            if (error?.message === 'CATEGORY_IN_USE') {
                              Alert.alert(
                                '삭제할 수 없어요',
                                '이 카테고리를 쓰는 할 일에서 먼저 빼주세요.',
                              );
                            } else throw error;
                          }
                        },
                      },
                    ],
                  )
                }
              >
                <Trash2 color={theme.muted} size={18} />
              </IconButton>
            </View>
            {editing === c.cid && (
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 10,
                  marginTop: 12,
                }}
              >
                {COLORS.map(color => (
                  <Pressable
                    key={color}
                    accessibilityLabel={color}
                    onPress={() => {
                      mutate('category/updateCategoryColor', [c.cid, color]);
                      setEditing(null);
                    }}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: color,
                      borderWidth: c.color === color ? 3 : 0,
                      borderColor: theme.text,
                    }}
                  />
                ))}
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
