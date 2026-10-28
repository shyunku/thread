import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Check, X } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import {
  Body,
  Button,
  Card,
  ErrorText,
  Field,
  IconButton,
  Screen,
  Title,
} from '@/ui/kit';
import { messageFor } from '@/ui/messages';
import { useTheme } from '@/ui/theme';

const ACK = '모든 기기의 데이터가 지워지는 것을 이해했어요';

// 계정 삭제 (#92, docs/designs/account-delete-mock.html frame ⑤), a full-screen step like
// 기기 해제: what goes, a backup hint (the PC app exports), "이해했어요", then the phone's
// unlock (biometrics/PIN; the vault password when that does not work) and the deletion.
// When it is done the account listener signs out and the login screen says so.
export default function DeleteAccountScreen() {
  const { user, account, runtime } = useApp();
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const id = user?.authId ?? user?.googleEmail ?? user?.username ?? '이';
  // Read once: listing devices reads the vault.
  const { devices, passwordAvailable } = useMemo(() => {
    let count: number | null = null;
    let password = false;
    try {
      const list = account?.sync.devices();
      count = Array.isArray(list) && list.length ? list.length : null;
    } catch {}
    try {
      password = !!account?.vault.inspect().passwordAvailable;
    } catch {}
    return { devices: count, passwordAvailable: password };
  }, [account]);

  const remove = async () => {
    try {
      await runtime.deleteAccount();
    } catch (e) {
      if (alive.current) setError(messageFor(e));
    }
  };

  // Biometrics/PIN first, like approving a device.
  const confirmAndDelete = async () => {
    if (!ack || busy || !account) return;
    setBusy(true);
    setError('');
    let confirmed = false;
    try {
      confirmed = await account.workspace.confirmUser();
    } catch {}
    if (confirmed) await remove();
    else if (alive.current && passwordAvailable) {
      setUsePassword(true);
      setError('지문·PIN으로 확인하지 못했어요. 보관함 비밀번호를 입력해 주세요.');
    } else if (alive.current) setError(messageFor('AUTH_FAILED_OR_CANCELLED'));
    if (alive.current) setBusy(false);
  };

  const deleteWithPassword = async () => {
    if (!ack || busy || !account || !password) return;
    const typed = password;
    setPassword('');
    setBusy(true);
    setError('');
    let confirmed = false;
    try {
      const store = await account.vault.unlockWithPassword(typed);
      store.close();
      confirmed = true;
    } catch (e) {
      if (alive.current) setError(messageFor(e));
    }
    if (confirmed) await remove();
    if (alive.current) setBusy(false);
  };

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 8,
          paddingTop: 8,
        }}
      >
        <IconButton label="닫기" onPress={() => !busy && navigation.goBack()}>
          <X color={theme.secondary} size={22} />
        </IconButton>
        <Text style={{ color: theme.muted, fontSize: 12.5 }}>계정 삭제</Text>
      </View>
      <View style={{ paddingHorizontal: 18, paddingTop: 4, paddingBottom: 8 }}>
        <Title>계정을 삭제할까요?</Title>
        <Body muted>
          <Text style={{ color: theme.text, fontWeight: '600' }}>{id}</Text>
          {' 계정을 지우면 아래 내용이 모든 기기에서 바로 지워져요. 되돌릴 수 없어요.'}
        </Body>
      </View>
      <Card>
        <Text
          style={{
            color: theme.text,
            fontSize: 15,
            fontWeight: '600',
            marginBottom: 4,
          }}
        >
          지워지는 것
        </Text>
        {[
          '계정(아이디, 사용자 이름, Google 연결)',
          '모든 기기의 할 일과 카테고리',
          devices ? `연결된 기기 ${devices}대와 로그인` : '연결된 기기와 로그인',
          '복구 코드와 복구 파일(더 이상 못 써요)',
        ].map(line => (
          <Body key={line} muted small style={{ lineHeight: 19 }}>
            {`• ${line}`}
          </Body>
        ))}
      </Card>
      <Card
        style={{
          borderColor: theme.scheme === 'light' ? '#c9d8f7' : '#2b3d5d',
          backgroundColor: theme.scheme === 'light' ? '#eef3fd' : '#182234',
        }}
      >
        <Body
          small
          style={{
            color: theme.scheme === 'light' ? theme.secondary : '#c7d7f5',
            lineHeight: 19,
          }}
        >
          할 일을 남겨 두려면 먼저 PC 앱의 설정 → 데이터 → 데이터 백업으로
          내보내세요.
        </Body>
      </Card>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ack, disabled: busy }}
        disabled={busy}
        onPress={() => setAck(!ack)}
        style={{
          flexDirection: 'row',
          gap: 12,
          marginHorizontal: 18,
          marginBottom: 10,
          padding: 14,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: ack ? theme.danger : theme.border,
          backgroundColor: ack
            ? theme.scheme === 'light'
              ? '#fdecee'
              : '#2a1c20'
            : theme.surface,
        }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            marginTop: 1,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: ack ? theme.danger : theme.muted,
            backgroundColor: ack ? theme.danger : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {ack && (
            <Check
              color={theme.scheme === 'light' ? '#ffffff' : '#2a0b0f'}
              size={14}
              strokeWidth={3}
            />
          )}
        </View>
        <Text
          style={{
            flex: 1,
            color: theme.text,
            fontSize: 15,
            fontWeight: '600',
            lineHeight: 21,
          }}
        >
          {ACK}
        </Text>
      </Pressable>
      {usePassword && (
        <Field
          placeholder="보관함 비밀번호"
          accessibilityLabel="보관함 비밀번호"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={deleteWithPassword}
        />
      )}
      <ErrorText>{error}</ErrorText>
      {usePassword ? (
        <Button
          kind="kill"
          label="비밀번호로 계정 삭제"
          busy={busy}
          disabled={!ack || !password}
          onPress={deleteWithPassword}
        />
      ) : (
        <Button
          kind="kill"
          label="계정 삭제 (지문·PIN)"
          busy={busy}
          disabled={!ack}
          onPress={confirmAndDelete}
        />
      )}
      {!usePassword && (
        <Text
          style={{
            color: theme.muted,
            fontSize: 12.5,
            lineHeight: 18,
            textAlign: 'center',
            marginHorizontal: 20,
            marginTop: -2,
            marginBottom: 12,
          }}
        >
          {passwordAvailable
            ? '지문·PIN이 안 되면 보관함 비밀번호로 확인해요.'
            : '휴대폰의 지문·PIN으로 확인해요.'}
        </Text>
      )}
      <Button
        kind="ghost"
        label="취소"
        disabled={busy}
        onPress={() => navigation.goBack()}
      />
    </Screen>
  );
}
