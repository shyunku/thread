import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { CircleCheck, X } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import { Body, Button, ErrorText, Field, Screen } from '@/ui/kit';
import { messageFor } from '@/ui/messages';
import { useTheme } from '@/ui/theme';
import { GoogleMark } from '@/ui/GoogleMark';

export function Logo({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={require('@/assets/logo.png')}
      style={{ width: size, height: size }}
      accessibilityIgnoresInvertColors
    />
  );
}

const NOTICES = {
  deleted: {
    title: '계정을 삭제했어요',
    text: '계정과 모든 기기의 데이터를 지웠어요. 그동안 Thread를 써 주셔서 고마워요.',
  },
  deletedElsewhere: {
    title: '계정이 삭제됐어요',
    text: '다른 기기에서 계정을 삭제해서 이 휴대폰의 데이터도 지웠어요.',
  },
};

// One line after the account went away (#92); closable, gone after the next sign-in.
function SignedOutNotice() {
  const { notice, clearNotice } = useApp();
  const theme = useTheme();
  if (!notice) return null;
  const { title, text } = NOTICES[notice];
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        marginHorizontal: 18,
        marginTop: 16,
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.scheme === 'light' ? '#c9d8f7' : '#2b3d5d',
        backgroundColor: theme.scheme === 'light' ? '#eef3fd' : '#182234',
      }}
    >
      <CircleCheck color={theme.success} size={20} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }}>
          {title}
        </Text>
        <Text
          style={{
            color: theme.scheme === 'light' ? theme.secondary : '#c7d7f5',
            fontSize: 13,
            lineHeight: 19,
            marginTop: 2,
          }}
        >
          {text}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="닫기"
        hitSlop={10}
        onPress={clearNotice}
      >
        <X color={theme.muted} size={18} />
      </Pressable>
    </View>
  );
}

export default function LoginScreen() {
  const { runtime, notice } = useApp();
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const [authId, setAuthId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'id' | 'google' | null>(null);
  const [error, setError] = useState('');

  const login = async () => {
    if (!authId || !password)
      return setError('아이디와 비밀번호를 입력해주세요.');
    setBusy('id');
    setError('');
    try {
      await runtime.account.signIn(authId.trim(), password);
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(null);
    }
  };

  const google = async () => {
    setBusy('google');
    setError('');
    try {
      const result = await runtime.signInWithGoogle();
      if ('linkToken' in result) navigation.navigate('GoogleLink', result);
    } catch (e) {
      if ((e as any)?.code !== 'GOOGLE_CANCELLED') setError(messageFor(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <SignedOutNotice />
      <View
        style={{
          alignItems: 'center',
          paddingTop: notice ? 28 : 70,
          paddingHorizontal: 24,
          paddingBottom: 26,
        }}
      >
        <Logo />
        <Text
          style={{
            color: theme.text,
            fontSize: 24,
            fontWeight: '700',
            marginTop: 14,
          }}
        >
          Thread
        </Text>
        <Body muted style={{ marginTop: 4 }}>
          할 일과 일정을 모든 기기에서, 암호화해서.
        </Body>
      </View>
      <Field
        placeholder="아이디"
        autoCapitalize="none"
        autoCorrect={false}
        value={authId}
        onChangeText={setAuthId}
      />
      <Field
        placeholder="비밀번호"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={login}
      />
      <ErrorText>{error}</ErrorText>
      <Button
        kind="primary"
        label="로그인"
        busy={busy === 'id'}
        disabled={!!busy}
        onPress={login}
      />
      <Button
        label="Google로 계속하기"
        busy={busy === 'google'}
        disabled={!!busy}
        onPress={google}
        icon={<GoogleMark size={18} />}
      />
      <Button
        kind="ghost"
        label="처음이신가요? 가입하기"
        onPress={() => navigation.navigate('Signup')}
      />
    </Screen>
  );
}
