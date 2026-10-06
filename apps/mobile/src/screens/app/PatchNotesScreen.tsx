import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import {
  APP_VERSION,
  COLLAPSE_AT,
  KIND_LABEL,
  pendingNotes,
  platformNotes,
  type PatchNote,
} from '@/core/patchNotes';
import { Button, IconButton, Sheet } from '@/ui/kit';
import { useTheme, type Theme } from '@/ui/theme';

const kindColors = (
  theme: Theme,
  kind: PatchNote['sections'][number]['kind'],
) =>
  kind === 'new'
    ? { bg: theme.selected, fg: theme.accent }
    : kind === 'improved'
    ? { bg: theme.successSoft, fg: theme.success }
    : {
        bg: theme.scheme === 'light' ? '#fbefd9' : '#3a2f1d',
        fg: theme.warning,
      };

function Sections({ note }: { note: PatchNote }) {
  const theme = useTheme();
  return (
    <>
      {note.sections.map(section => {
        const color = kindColors(theme, section.kind);
        return (
          <View key={section.kind}>
            <Text
              style={{
                alignSelf: 'flex-start',
                marginTop: 8,
                marginBottom: 4,
                paddingHorizontal: 8,
                paddingVertical: 1,
                borderRadius: 6,
                overflow: 'hidden',
                backgroundColor: color.bg,
                color: color.fg,
                fontSize: 11,
                fontWeight: '700',
              }}
            >
              {KIND_LABEL[section.kind]}
            </Text>
            {section.items.map((item, index) => (
              <View key={index} style={{ marginTop: 4, marginBottom: 6 }}>
                <Text
                  style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}
                >
                  {item.title}
                </Text>
                {item.detail?.map((line, i) => (
                  <Text
                    key={i}
                    style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}
                  >
                    {line}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        );
      })}
    </>
  );
}

function VersionHead({
  note,
  current,
  date = true,
}: {
  note: PatchNote;
  current?: boolean;
  date?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
      <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }}>
        {note.version}
      </Text>
      {current && (
        <Text
          style={{
            paddingHorizontal: 7,
            borderRadius: 6,
            overflow: 'hidden',
            backgroundColor: theme.selected,
            color: theme.accent,
            fontSize: 11,
            fontWeight: '700',
          }}
        >
          현재
        </Text>
      )}
      {date && (
        <Text style={{ color: theme.muted, fontSize: 12 }}>{note.date}</Text>
      )}
    </View>
  );
}

function FullVersion({ note, first }: { note: PatchNote; first: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingTop: first ? 4 : 14,
        paddingBottom: 14,
        borderTopWidth: first ? 0 : 1,
        borderColor: theme.border,
      }}
    >
      <VersionHead note={note} />
      <Text style={{ color: theme.secondary, fontSize: 13, marginTop: 2 }}>
        {note.summary}
      </Text>
      <Sections note={note} />
    </View>
  );
}

function VersionCard({ note }: { note: PatchNote }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View
      style={{
        marginBottom: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surface,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(value => !value)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <View style={{ flex: 1 }}>
          <VersionHead note={note} />
          <Text style={{ color: theme.secondary, fontSize: 13, marginTop: 1 }}>
            {note.summary}
          </Text>
        </View>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <ChevronDown color={theme.muted} size={18} />
        </View>
      </Pressable>
      {open && (
        <View
          style={{
            paddingHorizontal: 12,
            paddingBottom: 8,
            borderTopWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Sections note={note} />
        </View>
      )}
    </View>
  );
}

function Symbol() {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 48,
        height: 48,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: theme.scheme === 'light' ? '#c8d6ff' : '#6595ff55',
        backgroundColor: theme.scheme === 'light' ? '#e5ecff' : '#29457055',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Sparkles
        color={theme.scheme === 'light' ? theme.accent : '#7da8ff'}
        size={24}
      />
    </View>
  );
}

// Shown once after an update, over the main tabs (#99).
export function PatchNotesSheet({ notes: source }: { notes?: PatchNote[] }) {
  const { prefs, setPrefs } = useApp();
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const { height } = useWindowDimensions();
  const [notes, setNotes] = useState<PatchNote[] | null>(null);
  const [visible, setVisible] = useState(false);
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    if (notes) return;
    const pending = pendingNotes(
      source ?? platformNotes(),
      prefs.patchNotesSeen,
      APP_VERSION,
    );
    if (!pending.length || !prefs.showPatchNotes) {
      if (prefs.patchNotesSeen !== APP_VERSION)
        setPrefs({ patchNotesSeen: APP_VERSION });
      return;
    }
    setNotes(pending);
    setVisible(true);
  }, [notes, source, prefs.patchNotesSeen, prefs.showPatchNotes, setPrefs]);

  if (!notes) return null;
  const finish = (history = false) => {
    setPrefs({
      patchNotesSeen: APP_VERSION,
      ...(dontShow ? { showPatchNotes: false } : {}),
    });
    setVisible(false);
    if (history) navigation.navigate('PatchNotes');
  };
  const cards = notes.length >= COLLAPSE_AT;
  return (
    <Sheet visible={visible} onClose={() => finish()}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 20,
          paddingTop: 2,
          paddingBottom: 12,
        }}
      >
        <Symbol />
        <View>
          <Text
            style={{
              color: theme.muted,
              fontSize: 10,
              fontWeight: '700',
              letterSpacing: 1.4,
            }}
          >
            {notes.length > 1
              ? `버전 ${APP_VERSION} · 업데이트 ${notes.length}개`
              : `버전 ${APP_VERSION}`}
          </Text>
          <Text
            style={{
              color: theme.text,
              fontSize: 18,
              fontWeight: '700',
              marginTop: 2,
            }}
          >
            업데이트를 완료했어요
          </Text>
        </View>
      </View>
      <ScrollView
        style={{ maxHeight: height * 0.5 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 6 }}
      >
        {notes.map((note, index) =>
          cards ? (
            <VersionCard key={note.version} note={note} />
          ) : (
            <FullVersion key={note.version} note={note} first={index === 0} />
          ),
        )}
      </ScrollView>
      <View
        style={{
          borderTopWidth: 1,
          borderColor: theme.border,
          paddingTop: 12,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 18,
            marginBottom: 10,
          }}
        >
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: dontShow }}
            onPress={() => setDontShow(value => !value)}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                borderWidth: 1.5,
                borderColor: dontShow ? theme.accent : theme.muted,
                backgroundColor: dontShow ? theme.accent : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {dontShow && <Check color="#fff" size={13} strokeWidth={3} />}
            </View>
            <Text style={{ color: theme.secondary, fontSize: 14 }}>
              다시 보지 않기
            </Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            onPress={() => finish(true)}
            hitSlop={8}
            style={{ paddingHorizontal: 6, paddingVertical: 8 }}
          >
            <Text style={{ color: theme.secondary, fontSize: 14 }}>
              전체 내역
            </Text>
          </Pressable>
        </View>
        <Button kind="primary" label="확인" onPress={() => finish()} />
      </View>
    </Sheet>
  );
}

// Settings > 정보 > 업데이트 내역: the bundled notes (newest 12).
export default function PatchNotesScreen() {
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const notes = platformNotes();
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
          업데이트 내역
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text
          style={{
            color: theme.muted,
            fontSize: 12,
            fontWeight: '600',
            paddingHorizontal: 18,
            paddingTop: 6,
            paddingBottom: 6,
          }}
        >
          최근 업데이트 (최대 12개)
        </Text>
        {notes.length ? (
          <View
            style={{
              marginHorizontal: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surface,
              overflow: 'hidden',
            }}
          >
            {notes.map((note, index) => (
              <HistoryRow
                key={note.version}
                note={note}
                current={note.version === APP_VERSION}
                last={index === notes.length - 1}
              />
            ))}
          </View>
        ) : (
          <Text
            style={{
              color: theme.secondary,
              fontSize: 14,
              paddingHorizontal: 18,
              paddingTop: 8,
            }}
          >
            아직 업데이트 내역이 없어요.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function HistoryRow({
  note,
  current,
  last,
}: {
  note: PatchNote;
  current: boolean;
  last: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(current);
  return (
    <View
      style={{ borderBottomWidth: last ? 0 : 1, borderColor: theme.border }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(value => !value)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 13,
          backgroundColor: pressed ? theme.hover : 'transparent',
        })}
      >
        <View style={{ flex: 1 }}>
          <VersionHead note={note} current={current} date={false} />
          <Text style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>
            {note.date} · {note.summary}
          </Text>
        </View>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <ChevronRight color={theme.muted} size={16} />
        </View>
      </Pressable>
      {open && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
          <Sections note={note} />
        </View>
      )}
    </View>
  );
}
