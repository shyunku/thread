import { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ArrowLeft } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import {
  Body,
  Button,
  ErrorText,
  Field,
  IconButton,
  Option,
  Screen,
  Title,
} from '@/ui/kit';
import { messageFor } from '@/ui/messages';
import { useTheme } from '@/ui/theme';

// An unlinked Google account: link it to an existing account (its password) or
// create one, like the desktop. Then the same Google sign-in finishes.
export default function GoogleLinkScreen() {
  const { runtime } = useApp();
  const navigation = useNavigation<any>();
  const { linkToken, idToken } = (useRoute().params ?? {}) as {
    linkToken: string;
    idToken: string;
  };
  const theme = useTheme();
  const [mode, setMode] = useState<'link' | 'new'>('link');
  const [authId, setAuthId] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!authId.trim() || !password)
      return setError('아이디와 비밀번호를 입력해주세요.');
    if (mode === 'new' && (!username.trim() || password.length < 8)) {
      return setError('이름과 8자 이상의 비밀번호를 입력해주세요.');
    }
    setBusy(true);
    setError('');
    try {
      await runtime.account.linkGoogle({
        idToken,
        linkToken,
        authId: authId.trim(),
        password,
        ...(mode === 'new' ? { username: username.trim() } : {}),
      });
    } catch (e) {
      setError(messageFor(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ paddingHorizontal: 7, paddingTop: 5.5 }}>
        <IconButton label="뒤로" onPress={() => navigation.goBack()}>
          <ArrowLeft color={theme.secondary} size={19.5} />
        </IconButton>
      </View>
      <View style={{ paddingHorizontal: 16, paddingBottom: 9 }}>
        <Title>이 Google 계정은 처음이에요</Title>
        <Body muted>
          Thread 계정에 연결하면 다음부터 Google로 바로 로그인해요.
        </Body>
      </View>
      <Option
        title="쓰던 계정에 연결"
        detail="아이디와 비밀번호를 한 번 확인합니다."
        selected={mode === 'link'}
        onPress={() => setMode('link')}
      />
      <Option
        title="새로 가입"
        detail="아이디·비밀번호도 함께 만듭니다."
        selected={mode === 'new'}
        onPress={() => setMode('new')}
      />
      {mode === 'new' && (
        <Field placeholder="이름" value={username} onChangeText={setUsername} />
      )}
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
        onSubmitEditing={submit}
      />
      <ErrorText>{error}</ErrorText>
      <Button
        kind="primary"
        label={mode === 'link' ? '연결하고 계속' : '가입하고 계속'}
        busy={busy}
        onPress={submit}
      />
    </Screen>
  );
}
