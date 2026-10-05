import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import { Body, Button, ErrorText, Field, Screen, Title } from '@/ui/kit';
import { messageFor } from '@/ui/messages';
import { useTheme } from '@/ui/theme';

// Shown only after a reboot or a manual lock (#83 decision).
export default function LockScreen() {
  const { account, user, runtime } = useApp();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const passwordAvailable = account?.vault.inspect().passwordAvailable ?? false;

  const unlock = async () => {
    if (!account) return;
    setBusy(true);
    setError('');
    try {
      if (usePassword) await account.session.unlockWithPassword(password);
      else await account.session.unlock();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  // Ask right away when the screen opens; the user can still cancel and retry.
  useEffect(() => {
    unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen>
      <View
        style={{
          alignItems: 'center',
          paddingTop: 140,
          paddingHorizontal: 24,
          paddingBottom: 30,
        }}
      >
        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: 26,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 14,
          }}
        >
          <Lock color={theme.warning} size={38} />
        </View>
        <Title>Thread가 잠겨 있어요</Title>
        <Body muted>휴대폰을 다시 켰거나 직접 잠갔어요.</Body>
      </View>
      {usePassword ? (
        <>
          <Field
            placeholder="비밀번호"
            secureTextEntry
            autoFocus
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={unlock}
          />
          <ErrorText>{error}</ErrorText>
          <Button kind="primary" label="열기" busy={busy} onPress={unlock} />
          <Button
            kind="ghost"
            label="지문·얼굴로 열기"
            onPress={() => setUsePassword(false)}
          />
        </>
      ) : (
        <>
          <ErrorText>{error}</ErrorText>
          <Button
            kind="primary"
            label="지문·얼굴로 열기"
            busy={busy}
            onPress={unlock}
          />
          {passwordAvailable && (
            <Button
              kind="ghost"
              label="비밀번호로 열기"
              onPress={() => setUsePassword(true)}
            />
          )}
        </>
      )}
      <Button
        kind="ghost"
        label={`${user?.username ?? user?.authId ?? ''} · 로그아웃`}
        onPress={() => runtime.signOut()}
      />
    </Screen>
  );
}
