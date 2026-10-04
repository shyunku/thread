import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { X } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import {
  Body,
  Button,
  ErrorText,
  IconButton,
  Screen,
  Steps,
  Title,
} from '@/ui/kit';
import { messageFor } from '@/ui/messages';
import { useTheme } from '@/ui/theme';
import { Code } from '@/screens/setup/SetupScreen';

// This phone as the existing device (OwnerRelay): open a session, compare the code
// with the new device, approve after biometrics/PIN.
export default function ApproveDeviceScreen() {
  const { account } = useApp();
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const [status, setStatus] = useState<{ phase: string; code: string | null }>({
    phase: 'STARTING',
    code: null,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    if (!account) return;
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!alive.current) return;
      try {
        const next = await account.workspace.relay('ownerPoll');
        if (alive.current) setStatus(next);
        if (!['WAITING', 'COMPARE'].includes(next.phase)) return;
      } catch (e: any) {
        if (e?.message !== 'VAULT_BUSY' && alive.current)
          setError(messageFor(e));
      }
      if (alive.current) timer = setTimeout(poll, 1500);
    };
    account.workspace
      .relay('ownerStart')
      .then(started => {
        setStatus(started);
        timer = setTimeout(poll, 1500);
      })
      .catch(e => setError(messageFor(e)));
    return () => {
      alive.current = false;
      clearTimeout(timer);
      account.workspace.relay('cancel').catch(() => null);
    };
  }, [account]);

  const approve = async () => {
    setBusy(true);
    setError('');
    try {
      setStatus(await account!.workspace.relay('ownerApprove'));
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  const step = status.phase === 'DONE' ? 3 : status.phase === 'COMPARE' ? 2 : 1;
  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 7,
          paddingTop: 7,
        }}
      >
        <IconButton label="닫기" onPress={() => navigation.goBack()}>
          <X color={theme.secondary} size={19.5} />
        </IconButton>
        <Text style={{ color: theme.text, fontSize: 16.5, fontWeight: '700' }}>
          새 기기 추가
        </Text>
      </View>
      <Steps total={3} current={step} />
      {status.phase === 'DONE' ? (
        <View style={{ alignItems: 'center', padding: 21 }}>
          <Title>연결했어요</Title>
          <Body muted>새 기기에서 할 일을 내려받는 중이에요.</Body>
          <View style={{ height: 14 }} />
          <Button
            kind="primary"
            label="완료"
            onPress={() => navigation.goBack()}
            style={{ alignSelf: 'stretch', marginHorizontal: 0 }}
          />
        </View>
      ) : status.phase === 'COMPARE' && status.code ? (
        <>
          <View
            style={{
              alignItems: 'center',
              paddingHorizontal: 21,
              paddingTop: 9,
            }}
          >
            <Body muted style={{ textAlign: 'center' }}>
              새 기기의 숫자와 비교하세요.
            </Body>
            <Code value={status.code} />
            <Body>두 기기의 숫자가 같나요?</Body>
          </View>
          <View style={{ height: 14 }} />
          <Button
            kind="primary"
            label="같아요, 연결 승인"
            busy={busy}
            onPress={approve}
          />
          <Button
            kind="ghost"
            label="다르면 취소"
            onPress={() => navigation.goBack()}
          />
          <Body
            muted
            small
            style={{ textAlign: 'center', marginHorizontal: 21 }}
          >
            승인하려면 지문·얼굴 또는 화면 잠금을 다시 확인합니다.
          </Body>
        </>
      ) : ['EXPIRED', 'CANCELLED'].includes(status.phase) ? (
        <View style={{ padding: 21 }}>
          <Title>연결 시간이 지났어요</Title>
          <Body muted>새 기기 추가를 다시 눌러주세요.</Body>
        </View>
      ) : (
        <View style={{ alignItems: 'center', padding: 21 }}>
          <ActivityIndicator />
          <Title style={{ marginTop: 14 }}>새 기기를 기다리는 중</Title>
          <Body muted style={{ textAlign: 'center' }}>
            새 기기에서 로그인한 뒤{' '}
            <Text style={{ color: theme.text, fontWeight: '600' }}>
              "쓰던 기기와 연결"
            </Text>
            을 고르면 숫자가 나타납니다.
          </Body>
        </View>
      )}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
