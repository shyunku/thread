import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type Theme } from './theme';

// Shared building blocks for the #87 screens. Values follow the mock
// (docs/designs/mobile-app-mock.html): 14px corner radius cards, 15px body text.

export function useStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}

export function Screen({
  children,
  scroll = true,
  padded = false,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  footer?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        { paddingBottom: 24 },
        padded && { paddingTop: 8 },
      ]}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1 }}>{children}</View>
  );
  return (
    <KeyboardAvoidingView
      behavior="height"
      style={{ flex: 1, backgroundColor: theme.canvas, paddingTop: insets.top }}
    >
      {body}
      {footer}
    </KeyboardAvoidingView>
  );
}

export function Title({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  return (
    <Text
      style={[
        { color: theme.text, fontSize: 24, fontWeight: '700', marginBottom: 6 },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
  small,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  small?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  return (
    <Text
      style={[
        {
          color: muted ? theme.muted : theme.text,
          fontSize: small ? 12.5 : 15,
          lineHeight: small ? 18 : 22,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  kind = 'default',
  busy,
  disabled,
  icon,
  style,
}: {
  label: string;
  onPress?: () => void;
  kind?: 'default' | 'primary' | 'ghost' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const primary = kind === 'primary';
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 50,
          marginHorizontal: 18,
          marginBottom: 10,
          paddingHorizontal: 16,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: primary
            ? theme.accent
            : kind === 'ghost'
            ? 'transparent'
            : theme.border,
          backgroundColor: primary
            ? theme.accent
            : kind === 'ghost'
            ? 'transparent'
            : theme.surface,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 10,
          opacity: off ? 0.55 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          color={primary ? theme.accentText : theme.secondary}
        />
      ) : (
        icon
      )}
      <Text
        style={{
          color: primary
            ? theme.accentText
            : kind === 'danger'
            ? theme.danger
            : kind === 'ghost'
            ? theme.secondary
            : theme.text,
          fontSize: 15,
          fontWeight: kind === 'ghost' ? '500' : '600',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({
  style,
  ...props
}: TextInputProps & { style?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.muted}
      style={[
        {
          marginHorizontal: 18,
          marginBottom: 12,
          paddingHorizontal: 14,
          paddingVertical: 13,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
          color: theme.text,
          fontSize: 15,
        },
        style,
      ]}
      {...props}
    />
  );
}

export function Option({
  title,
  detail,
  selected,
  onPress,
}: {
  title: string;
  detail?: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        gap: 12,
        marginHorizontal: 18,
        marginBottom: 10,
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: selected ? theme.accent : theme.border,
        backgroundColor: selected ? theme.selected : theme.surface,
      }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          marginTop: 2,
          borderRadius: 10,
          borderWidth: selected ? 6 : 2,
          borderColor: selected ? theme.accent : theme.muted,
        }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>
          {title}
        </Text>
        {!!detail && (
          <Text
            style={{
              color: theme.muted,
              fontSize: 12.5,
              marginTop: 2,
              lineHeight: 18,
            }}
          >
            {detail}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          marginHorizontal: 18,
          marginBottom: 12,
          padding: 16,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Steps({ total, current }: { total: number; current: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 6,
        paddingHorizontal: 18,
        paddingBottom: 14,
      }}
    >
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 4,
            backgroundColor: index < current ? theme.accent : theme.border,
          }}
        />
      ))}
    </View>
  );
}

// dropdown adds a down chevron: the chip opens a choice instead of toggling (#96).
export function Chip({
  label,
  selected,
  onPress,
  dropdown,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  dropdown?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 12,
        paddingRight: dropdown ? 9 : 12,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? theme.accent : theme.border,
        backgroundColor: selected ? theme.selected : theme.surface,
      }}
    >
      <Text
        style={{ color: selected ? theme.text : theme.secondary, fontSize: 13 }}
      >
        {label}
      </Text>
      {dropdown && <ChevronDown color={theme.muted} size={14} />}
    </Pressable>
  );
}

export function IconButton({
  onPress,
  children,
  label,
}: {
  onPress?: () => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}
    >
      {children}
    </Pressable>
  );
}

// Bottom sheet on a transparent Modal: the sheet slides up while the dim backdrop
// fades in place (#96), and both reverse before the Modal closes. Tap outside or
// back closes it.
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState(visible);
  const [height, setHeight] = useState(800);
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) {
      setShown(true);
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(slide, {
          toValue: 0,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(slide, {
          toValue: 1,
          duration: 200,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => finished && setShown(false));
    }
  }, [visible, fade, slide]);

  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: theme.scrim, opacity: fade },
        ]}
      >
        <Pressable
          accessibilityLabel="닫기"
          style={{ flex: 1 }}
          onPress={onClose}
        />
      </Animated.View>
      <KeyboardAvoidingView
        behavior="padding"
        pointerEvents="box-none"
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        <Animated.View
          onLayout={event => setHeight(event.nativeEvent.layout.height)}
          style={{
            backgroundColor: theme.panel,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            transform: [
              {
                translateY: slide.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, height],
                }),
              },
            ],
          }}
        >
          <View
            style={{
              paddingTop: 8,
              paddingBottom: Math.max(insets.bottom, 16) + 8,
            }}
          >
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 4,
                backgroundColor: theme.border,
                alignSelf: 'center',
                marginBottom: 12,
              }}
            />
            {!!title && (
              <Text
                style={{
                  color: theme.text,
                  fontSize: 17,
                  fontWeight: '700',
                  marginHorizontal: 20,
                  marginBottom: 10,
                }}
              >
                {title}
              </Text>
            )}
            {children}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Row({
  children,
  onPress,
  selected,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 20,
          paddingVertical: 12,
        },
        selected && { backgroundColor: theme.selected },
        pressed && { backgroundColor: theme.hover },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const theme = useTheme();
  if (!children) return null;
  return (
    <Text
      style={{
        color: theme.danger,
        marginHorizontal: 20,
        marginBottom: 10,
        fontSize: 13,
      }}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
