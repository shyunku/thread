import { useMemo, type ReactNode } from 'react';
import {
  ActivityIndicator,
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
        { paddingBottom: 21 },
        padded && { paddingTop: 7 },
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
        {
          color: theme.text,
          fontSize: 21,
          fontWeight: '700',
          marginBottom: 5.5,
        },
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
          minHeight: 40,
          marginHorizontal: 16,
          marginBottom: 9,
          paddingHorizontal: 14,
          borderRadius: 12.5,
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
          gap: 9,
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
          fontSize: 13,
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
          marginHorizontal: 16,
          marginBottom: 10.5,
          paddingHorizontal: 12.5,
          paddingVertical: 11.5,
          borderRadius: 10.5,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
          color: theme.text,
          fontSize: 13,
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
        gap: 10.5,
        marginHorizontal: 16,
        marginBottom: 9,
        padding: 12.5,
        borderRadius: 12.5,
        borderWidth: 1,
        borderColor: selected ? theme.accent : theme.border,
        backgroundColor: selected ? theme.selected : theme.surface,
      }}
    >
      <View
        style={{
          width: 17.5,
          height: 17.5,
          marginTop: 2,
          borderRadius: 9,
          borderWidth: selected ? 6 : 2,
          borderColor: selected ? theme.accent : theme.muted,
        }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>
          {title}
        </Text>
        {!!detail && (
          <Text
            style={{
              color: theme.muted,
              fontSize: 11,
              marginTop: 2,
              lineHeight: 16,
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
          marginHorizontal: 16,
          marginBottom: 10.5,
          padding: 14,
          borderRadius: 12.5,
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
        gap: 5.5,
        paddingHorizontal: 16,
        paddingBottom: 12.5,
      }}
    >
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          style={{
            flex: 1,
            height: 3.5,
            borderRadius: 3.5,
            backgroundColor: index < current ? theme.accent : theme.border,
          }}
        />
      ))}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={{
        paddingHorizontal: 10.5,
        paddingVertical: 5.5,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? theme.accent : theme.border,
        backgroundColor: selected ? theme.selected : theme.surface,
      }}
    >
      <Text
        style={{
          color: selected ? theme.text : theme.secondary,
          fontSize: 11.5,
        }}
      >
        {label}
      </Text>
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

// Bottom sheet on a transparent Modal (slides up; tap outside or back to close).
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
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        accessibilityLabel="닫기"
        style={{ flex: 1, backgroundColor: theme.scrim }}
        onPress={onClose}
      />
      <KeyboardAvoidingView
        behavior="padding"
        style={{
          backgroundColor: theme.panel,
          borderTopLeftRadius: 19.5,
          borderTopRightRadius: 19.5,
        }}
      >
        <View
          style={{
            paddingTop: 7,
            paddingBottom: Math.max(insets.bottom, 16) + 8,
          }}
        >
          <View
            style={{
              width: 31.5,
              height: 3.5,
              borderRadius: 3.5,
              backgroundColor: theme.border,
              alignSelf: 'center',
              marginBottom: 10.5,
            }}
          />
          {!!title && (
            <Text
              style={{
                color: theme.text,
                fontSize: 15,
                fontWeight: '700',
                marginHorizontal: 17.5,
                marginBottom: 9,
              }}
            >
              {title}
            </Text>
          )}
          {children}
        </View>
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
          gap: 10.5,
          paddingHorizontal: 17.5,
          paddingVertical: 10.5,
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
        marginHorizontal: 17.5,
        marginBottom: 9,
        fontSize: 11.5,
      }}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    width: 35,
    height: 35,
    borderRadius: 10.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
