import { useState } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '@/app/AppContext';
import {
  Body,
  Button,
  ErrorText,
  Field,
  Option,
  Screen,
  Steps,
  Title,
} from '@/ui/kit';
import { messageFor } from '@/ui/messages';
import { useTheme } from '@/ui/theme';

// Step 1/3 of setup: create this phone's encrypted vault (#83). Biometrics or the
// device screen lock always; a password is optional (desktop KDF, at least 12 chars).
export default function LockMethodScreen() {
  const { account } = useApp();
  const theme = useTheme();
  const [withPassword, setWithPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    if (!account) return;
    if (withPassword) {
      if (Array.from(password).length < 12)
        return setError('비밀번호는 12자 이상이어야 해요.');
      if (password !== confirm)
        return setError('비밀번호가 서로 다르게 입력됐어요.');
    }
    setBusy(true);
    setError('');
    try {
      // The Keystore asks for biometrics or the screen lock while the key is stored.
      await account.session.create(withPassword ? { password } : {});
    } catch (e) {
      setError(messageFor(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text
        style={{
          color: theme.muted,
          fontSize: 11,
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 7,
        }}
      >
        이 기기 보호 · 1/3
      </Text>
      <Steps total={3} current={1} />
      <View style={{ paddingHorizontal: 16, paddingBottom: 9 }}>
        <Title>이 휴대폰의 데이터 잠금</Title>
        <Body muted>
          할 일은 이 휴대폰 안에서도 암호화돼요. 휴대폰을 다시 켰거나 직접 잠근
          뒤에 열 때 확인해요.
        </Body>
      </View>
      <Option
        title="지문·얼굴 또는 화면 잠금"
        detail="추천. 휴대폰 잠금과 같은 방법."
        selected={!withPassword}
        onPress={() => setWithPassword(false)}
      />
      <Option
        title="+ 비밀번호도 함께"
        detail="생체 인증이 안 될 때 쓸 12자 이상 비밀번호."
        selected={withPassword}
        onPress={() => setWithPassword(true)}
      />
      {withPassword && (
        <>
          <Field
            placeholder="비밀번호 (12자 이상)"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Field
            placeholder="비밀번호 확인"
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
          />
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <Button
        kind="primary"
        label="계속"
        busy={busy}
        onPress={create}
        style={{ marginTop: 5.5 }}
      />
    </Screen>
  );
}
