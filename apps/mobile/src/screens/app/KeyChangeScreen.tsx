import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Check, X } from 'lucide-react-native';
import { Buffer } from 'buffer';
import { useApp } from '@/app/AppContext';
import { pickRecoveryFile } from '@/core/files';
import {
  Body,
  Button,
  Card,
  ErrorText,
  Field,
  IconButton,
  Option,
  Screen,
  Steps,
  Title,
} from '@/ui/kit';
import { messageFor } from '@/ui/messages';
import { useTheme } from '@/ui/theme';
import { PickedFile, RecoveryMaterial } from '@/screens/setup/SetupScreen';
import { deviceLabel } from './DataSettingsScreen';

const PENDING = ['RECOVERY_UNCONFIRMED', 'RECOVERY_CONFIRMED', 'COMMITTING'];
const stepFor = (phase?: string | null) =>
  phase === 'RECOVERY_UNCONFIRMED' ? 2 : PENDING.includes(phase ?? '') ? 3 : 1;

// Removing a device and making a new recovery key are one key rotation (desktop
// KeyChangeDialog): see the impact -> keep the new recovery code and file -> reopen
// the file and type the code, then apply -> re-protect existing data.
export default function KeyChangeScreen() {
  const { account, refresh } = useApp();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const theme = useTheme();
  const removing: { id: string; addedAt: number | null } | null =
    route.params?.device ?? null;
  const [step, setStep] = useState(1);
  const [consent, setConsent] = useState(false);
  const [saved, setSaved] = useState(false);
  const [file, setFile] = useState<{ name: string; bytes: Buffer } | null>(
    null,
  );
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{
    phase: string;
    count: number;
  } | null>(null);
  const [material, setMaterial] = useState<{
    code: string;
    bytes: Buffer;
  } | null>(null);
  const alive = useRef(true);
  const started = useRef(false);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // An unfinished change continues where it stopped (the vault keeps it).
  useEffect(() => {
    account?.workspace
      .rotation('status')
      .then((status: any) => {
        if (alive.current && status && PENDING.includes(status.phase))
          setStep(stepFor(status.phase));
      })
      .catch(() => null);
  }, [account]);
  useEffect(() => {
    if (step !== 2 || material) return;
    account?.workspace
      .rotation('material')
      .then((value: any) => alive.current && setMaterial(value))
      .catch((e: unknown) => alive.current && setError(messageFor(e)));
  }, [account, step, material]);

  // After applying: one verified sync, then re-protect existing data; each later
  // sync continues it (SyncService), so the app can be closed in between.
  useEffect(() => {
    if (step !== 4 || !account) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        await account.sync.syncNow().catch(() => null);
        let status: any = account.workspace.reencryption('status');
        if (!started.current) {
          // A finished job from an earlier change does not cover the new key.
          if (!status || ['DONE', 'CANCELLED'].includes(status.phase))
            status = account.workspace.reencryption('start');
          started.current = true;
        } else if (status?.phase === 'PAUSED') {
          status = account.workspace.reencryption('step');
        }
        if (alive.current) setProgress(status);
        if (status?.phase === 'DONE') return refresh();
      } catch (e: any) {
        if (e?.message !== 'VAULT_BUSY' && alive.current)
          setError(messageFor(e));
      }
      if (alive.current) timer = setTimeout(tick, 1500);
    };
    tick();
    return () => clearTimeout(timer);
  }, [step, account, refresh]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      if (alive.current) setError(messageFor(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const prepare = () =>
    run(async () => {
      await account!.workspace.rotation('prepare', {
        remove: removing ? [removing.id] : [],
        confirmed: true,
      });
      setStep(2);
    });
  const cancel = () =>
    run(async () => {
      if (step > 1) await account!.workspace.rotation('cancel');
      navigation.goBack();
    });
  const apply = () =>
    run(async () => {
      const status: any = await account!.workspace.rotation('status');
      if (status?.phase === 'RECOVERY_UNCONFIRMED') {
        if (!file || !code.trim()) {
          setError('복구 파일을 고르고 코드를 입력해주세요.');
          return;
        }
        await account!.workspace.rotation('confirm', {
          code: code.trim(),
          bytes: file.bytes,
        });
        setCode('');
      }
      await account!.workspace.rotation('commit', { confirmed: true });
      setStep(4);
    });

  const title = removing ? '기기 해제' : '복구 키 새로 만들기';
  const header = (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 7,
          paddingTop: 7,
        }}
      >
        {step < 4 && (
          <IconButton label="닫기" onPress={cancel}>
            <X color={theme.secondary} size={19.5} />
          </IconButton>
        )}
        <Text
          style={{
            color: theme.muted,
            fontSize: 11,
            paddingLeft: step < 4 ? 0 : 9,
          }}
        >
          {step < 4 ? `${title} · ${step}/3` : title}
        </Text>
      </View>
      {step < 4 && <Steps total={3} current={step} />}
    </>
  );

  if (step === 1)
    return (
      <Screen>
        {header}
        <View style={{ paddingHorizontal: 16, paddingBottom: 9 }}>
          <Title>
            {removing ? '이 기기를 해제할까요?' : '복구 키를 새로 만들까요?'}
          </Title>
        </View>
        {removing && (
          <Card>
            <Text style={{ color: theme.text, fontWeight: '600' }}>
              {deviceLabel(removing.id)}
            </Text>
            {removing.addedAt != null && (
              <Body muted small>
                {new Date(removing.addedAt).getMonth() + 1}월{' '}
                {new Date(removing.addedAt).getDate()}일 연결
              </Body>
            )}
          </Card>
        )}
        <Card>
          <Text
            style={{ color: theme.text, fontWeight: '600', marginBottom: 3.5 }}
          >
            이렇게 돼요
          </Text>
          {[
            removing && '그 기기는 새 데이터를 받거나 보낼 수 없어요.',
            '새 복구 코드와 파일을 만들어요. 이전 것은 못 써요.',
            '기존 데이터를 새 키로 다시 잠가요(동기화하며 자동).',
            removing &&
              '이미 그 기기에 있는 데이터는 지울 수 없어요. 잃어버린 기기면 계정 비밀번호도 바꾸세요.',
          ]
            .filter(Boolean)
            .map(line => (
              <Body key={line as string} muted small>
                {`• ${line}`}
              </Body>
            ))}
        </Card>
        <Option
          title="이해했어요"
          selected={consent}
          onPress={() => setConsent(!consent)}
        />
        <ErrorText>{error}</ErrorText>
        <Button
          kind="primary"
          label="계속 (지문·PIN)"
          busy={busy}
          disabled={!consent}
          onPress={prepare}
        />
        <Button kind="ghost" label="취소" onPress={cancel} />
      </Screen>
    );

  if (step === 2)
    return (
      <Screen>
        {header}
        <View style={{ paddingHorizontal: 16, paddingBottom: 7 }}>
          <Title>새 복구 자료를 따로 보관하세요</Title>
          <Body muted>
            적용하면 이전 복구 코드와 파일은 쓸 수 없어요. 새 것을 저장하세요.
          </Body>
        </View>
        {material && (
          <RecoveryMaterial
            code={material.code}
            bytes={material.bytes}
            fileName="thread_recovery_rotated.trec"
            onSaved={() => setSaved(true)}
          />
        )}
        <ErrorText>{error}</ErrorText>
        <Button
          kind="primary"
          label="저장했어요"
          disabled={!saved}
          onPress={() => {
            setMaterial(null);
            setStep(3);
          }}
        />
        <Button kind="ghost" label="변경 취소" busy={busy} onPress={cancel} />
      </Screen>
    );

  if (step === 3)
    return (
      <Screen>
        {header}
        <View style={{ paddingHorizontal: 16, paddingBottom: 7 }}>
          <Title>제대로 보관했는지 확인할게요</Title>
          <Body muted>저장한 새 파일을 다시 열고 새 코드를 입력하세요.</Body>
        </View>
        <PickedFile
          name={file?.name ?? null}
          onPick={async () => {
            try {
              const picked = await pickRecoveryFile();
              if (picked) setFile(picked);
            } catch (e) {
              setError(messageFor(e));
            }
          }}
        />
        <Field
          placeholder="새 복구 코드 (THREAD1-…)"
          autoCapitalize="characters"
          autoCorrect={false}
          value={code}
          onChangeText={setCode}
        />
        <Body muted small style={{ marginHorizontal: 17.5, marginBottom: 9 }}>
          적용하면 이전 복구 키는 쓸 수 없어요.
        </Body>
        <ErrorText>{error}</ErrorText>
        <Button
          kind="primary"
          label={`${removing ? '해제 적용' : '적용'} (지문·PIN)`}
          busy={busy}
          onPress={apply}
        />
        <Button kind="ghost" label="변경 취소" onPress={cancel} />
      </Screen>
    );

  const done = progress?.phase === 'DONE';
  return (
    <Screen>
      {header}
      <View style={{ alignItems: 'center', padding: 21, paddingTop: 35 }}>
        <View
          style={{
            width: 74,
            height: 74,
            borderRadius: 23,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
          }}
        >
          <Check color={theme.success} size={33} />
        </View>
        <Title style={{ textAlign: 'center' }}>
          {removing ? '기기를 해제했어요' : '새 복구 키로 바꿨어요'}
        </Title>
        <Body muted style={{ textAlign: 'center' }}>
          이전 복구 코드와 파일은 이제 쓸 수 없어요.
        </Body>
      </View>
      <Card>
        <Text style={{ color: theme.text, fontWeight: '600' }}>
          {done
            ? '기존 데이터를 새 키로 잠갔어요'
            : '기존 데이터 다시 잠그는 중'}
        </Text>
        <Body muted small>
          {done
            ? `${progress?.count ?? 0}개 완료`
            : `${
                progress?.count ?? 0
              }개 완료 · 앱을 닫아도 다음 동기화에서 이어서 해요.`}
        </Body>
      </Card>
      <ErrorText>{error}</ErrorText>
      <Button kind="primary" label="완료" onPress={() => navigation.goBack()} />
    </Screen>
  );
}
