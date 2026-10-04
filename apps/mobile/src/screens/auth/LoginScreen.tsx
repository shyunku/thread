import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '@/app/AppContext';
import { Body, Button, ErrorText, Field, Screen } from '@/ui/kit';
import { messageFor } from '@/ui/messages';
import { useTheme } from '@/ui/theme';

export function Logo({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={require('@/assets/logo.png')}
      style={{ width: size, height: size }}
      accessibilityIgnoresInvertColors
    />
  );
}

export default function LoginScreen() {
  const { runtime } = useApp();
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
      <View
        style={{
          alignItems: 'center',
          paddingTop: 61.5,
          paddingHorizontal: 21,
          paddingBottom: 23,
        }}
      >
        <Logo />
        <Text
          style={{
            color: theme.text,
            fontSize: 21,
            fontWeight: '700',
            marginTop: 12.5,
          }}
        >
          Thread
        </Text>
        <Body muted style={{ marginTop: 3.5 }}>
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
        icon={
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: '#4285f4',
            }}
          />
        }
      />
      <Button
        kind="ghost"
        label="처음이신가요? 가입하기"
        onPress={() => navigation.navigate('Signup')}
      />
    </Screen>
  );
}
