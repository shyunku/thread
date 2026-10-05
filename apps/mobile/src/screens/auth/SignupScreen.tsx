import { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import {
  Body,
  Button,
  ErrorText,
  Field,
  IconButton,
  Screen,
  Title,
} from '@/ui/kit';
import { messageFor } from '@/ui/messages';
import { useTheme } from '@/ui/theme';

// Same rules as the desktop sign-up form (password at least 8 characters).
export default function SignupScreen() {
  const { runtime } = useApp();
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const [username, setUsername] = useState('');
  const [authId, setAuthId] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!username.trim() || !authId.trim())
      return setError('이름과 아이디를 입력해주세요.');
    if (password.length < 8) return setError('비밀번호는 8자 이상이어야 해요.');
    if (password !== confirm)
      return setError('비밀번호가 서로 다르게 입력됐어요.');
    setBusy(true);
    setError('');
    try {
      await runtime.account.signUp(username.trim(), authId.trim(), password);
      await runtime.account.signIn(authId.trim(), password);
    } catch (e) {
      setError(messageFor(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ paddingHorizontal: 8, paddingTop: 6 }}>
        <IconButton label="뒤로" onPress={() => navigation.goBack()}>
          <ArrowLeft color={theme.secondary} size={22} />
        </IconButton>
      </View>
      <View style={{ paddingHorizontal: 18, paddingBottom: 12 }}>
        <Title>가입하기</Title>
        <Body muted>할 일은 이 기기에서 암호화된 뒤 서버에 저장돼요.</Body>
      </View>
      <Field placeholder="이름" value={username} onChangeText={setUsername} />
      <Field
        placeholder="아이디"
        autoCapitalize="none"
        autoCorrect={false}
        value={authId}
        onChangeText={setAuthId}
      />
      <Field
        placeholder="비밀번호 (8자 이상)"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Field
        placeholder="비밀번호 확인"
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
        onSubmitEditing={submit}
      />
      <ErrorText>{error}</ErrorText>
      <Button
        kind="primary"
        label="가입하고 시작하기"
        busy={busy}
        onPress={submit}
      />
    </Screen>
  );
}
