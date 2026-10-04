import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { ArrowLeft, FileCheck } from 'lucide-react-native';
import type { Buffer } from 'buffer';
import { useApp } from '@/app/AppContext';
import { accountKind, finishOwner } from '@/core/app/setup';
import { copySecret, pickRecoveryFile, saveRecoveryFile } from '@/core/files';
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

// Steps 2-3 of setup after the vault exists (#85): connect to the account's data
// (6-digit relay or recovery code), or for a new account create and confirm the
// recovery material, then register and activate.
type View_ =
  | 'loading'
  | 'choose'
  | 'pair'
  | 'joinRecovery'
  | 'backup'
  | 'confirm'
  | 'finishing'
  | 'error';

export default function SetupScreen() {
  const { account, setup, reloadSetup, setupDone, runtime } = useApp();
  const [view, setView] = useState<View_>('loading');
  const [error, setError] = useState('');
  const workspace = account?.workspace;

  const decide = useCallback(async () => {
    if (!account || !workspace) return;
    setError('');
    try {
      if (setup === 'OWNER_BACKUP') return setView('backup');
      if (setup === 'OWNER_FINISH') {
        setView('finishing');
        await account.session.use(store => finishOwner(workspace, store));
        return setupDone();
      }
      setView('loading');
      const kind = await accountKind(account.transport());
      if (kind === 'EXISTING') return setView('choose');
      await workspace.prepareIdentity();
      reloadSetup();
      setView('backup');
    } catch (e) {
      setError(messageFor(e));
      setView('error');
    }
  }, [account, workspace, setup, reloadSetup, setupDone]);

  useEffect(() => {
    decide();
    // Only when the setup state itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);

  if (!account || !workspace) return null;
  if (view === 'loading' || view === 'finishing') {
    return (
      <Screen scroll={false}>
        <Centered>
          <ActivityIndicator />
          <Body muted style={{ marginTop: 14 }}>
            {view === 'finishing'
              ? '서버에 이 기기를 등록하는 중…'
              : '계정 상태를 확인하는 중…'}
          </Body>
        </Centered>
      </Screen>
    );
  }
  if (view === 'error') {
    return (
      <Screen scroll={false}>
        <Centered>
          <Title>잠시 문제가 생겼어요</Title>
          <ErrorText>{error}</ErrorText>
        </Centered>
        <Button kind="primary" label="다시 시도" onPress={decide} />
        <Button
          kind="ghost"
          label="로그아웃"
          onPress={() => runtime.signOut()}
        />
      </Screen>
    );
  }
  if (view === 'choose')
    return (
      <ChooseView
        onPair={() => setView('pair')}
        onRecovery={() => setView('joinRecovery')}
      />
    );
  if (view === 'pair') return <PairView onBack={() => setView('choose')} />;
  if (view === 'joinRecovery')
    return <RecoveryJoinView onBack={() => setView('choose')} />;
  if (view === 'backup')
    return <BackupView onDone={() => setView('confirm')} />;
  return <ConfirmView onBack={() => setView('backup')} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
      }}
    >
      {children}
    </View>
  );
}

function Header({
  step,
  label,
  onBack,
}: {
  step?: number;
  label: string;
  onBack?: () => void;
}) {
  const theme = useTheme();
  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: onBack ? 8 : 18,
          paddingTop: onBack ? 6 : 18,
          paddingBottom: 8,
        }}
      >
        {onBack && (
          <IconButton label="뒤로" onPress={onBack}>
            <ArrowLeft color={theme.secondary} size={22} />
          </IconButton>
        )}
        <Text style={{ color: theme.muted, fontSize: 12.5 }}>{label}</Text>
      </View>
      {step != null && <Steps total={3} current={step} />}
    </>
  );
}

function ChooseView({
  onPair,
  onRecovery,
}: {
  onPair: () => void;
  onRecovery: () => void;
}) {
  const { user } = useApp();
  return (
    <Screen>
      <Header step={2} label="데이터 연결 · 2/3" />
      <View style={{ paddingHorizontal: 18, paddingBottom: 10 }}>
        <Title>데이터를 어떻게 가져올까요?</Title>
        <Body muted>
          {user?.username ?? user?.authId ?? '이'} 계정에 이미 데이터가 있어요.
        </Body>
      </View>
      <Option
        title="쓰던 기기와 연결"
        detail="PC나 다른 휴대폰에서 6자리 숫자를 비교합니다. 가장 쉬워요."
        onPress={onPair}
      />
      <Option
        title="복구 코드로 연결"
        detail="다른 기기를 모두 잃어버렸을 때. 복구 파일과 코드가 필요해요."
        onPress={onRecovery}
      />
    </Screen>
  );
}

// New device side of the relay (RecipientRelay): wait, compare the code, confirm.
function PairView({ onBack }: { onBack: () => void }) {
  const { account, setupDone } = useApp();
  const theme = useTheme();
  const [status, setStatus] = useState<{ phase: string; code: string | null }>({
    phase: 'WAITING',
    code: null,
  });
  const [error, setError] = useState('');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const tick = async () => {
      if (!alive.current || !account) return;
      try {
        const next = await account.workspace.relay('recipientPoll');
        if (!alive.current) return;
        if (next.phase === 'PAIRED') return setupDone();
        // A session that expired or was cancelled: start listening for a new one.
        if (['EXPIRED', 'CANCELLED'].includes(next.phase))
          await account.workspace.relay('cancel').catch(() => null);
        setStatus(next);
        setError('');
      } catch (e: any) {
        if (alive.current && e?.message !== 'VAULT_BUSY')
          setError(messageFor(e));
      }
      if (alive.current) setTimeout(tick, 1500);
    };
    tick();
    return () => {
      alive.current = false;
      account?.workspace.relay('cancel').catch(() => null);
    };
  }, [account, setupDone]);

  const answer = async (same: boolean) => {
    try {
      const next = same
        ? await account!.workspace.relay('recipientConfirm')
        : await account!.workspace.relay('recipientReject');
      setStatus(next);
    } catch (e) {
      setError(messageFor(e));
    }
  };

  const comparing = status.phase === 'COMPARE' && status.code;
  return (
    <Screen>
      <Header label="쓰던 기기와 연결" onBack={onBack} />
      {comparing ? (
        <>
          <View
            style={{
              alignItems: 'center',
              paddingHorizontal: 24,
              paddingTop: 30,
            }}
          >
            <Title>두 기기의 숫자가 같나요?</Title>
            <Body muted>쓰던 기기 화면의 숫자와 비교하세요.</Body>
            <Code value={status.code!} />
          </View>
          <Button kind="primary" label="같아요" onPress={() => answer(true)} />
          <Button kind="ghost" label="달라요" onPress={() => answer(false)} />
        </>
      ) : status.phase === 'APPROVAL' ? (
        <Centered>
          <ActivityIndicator />
          <Title style={{ marginTop: 14 }}>쓰던 기기에서 승인해주세요</Title>
          <Body muted>승인하면 할 일이 내려받아집니다.</Body>
        </Centered>
      ) : status.phase === 'MISMATCH' ? (
        <View style={{ padding: 24 }}>
          <Title>연결을 취소했어요</Title>
          <Body muted>
            숫자가 다르면 다른 사람이 끼어들었을 수 있어요. 처음부터 다시
            시도해주세요.
          </Body>
          <View style={{ height: 16 }} />
          <Button
            kind="primary"
            label="다시 시도"
            onPress={onBack}
            style={{ marginHorizontal: 0 }}
          />
        </View>
      ) : (
        <>
          <View
            style={{
              alignItems: 'center',
              paddingHorizontal: 24,
              paddingTop: 40,
              paddingBottom: 24,
            }}
          >
            <ActivityIndicator />
            <Title style={{ marginTop: 16 }}>쓰던 기기를 기다리는 중</Title>
            <Body muted style={{ textAlign: 'center' }}>
              PC나 휴대폰의 설정 → 데이터 →{' '}
              <Text style={{ color: theme.text, fontWeight: '600' }}>
                새 기기 추가
              </Text>
              를 눌러주세요.
            </Body>
          </View>
          <Card>
            <Text
              style={{ color: theme.text, fontWeight: '600', marginBottom: 4 }}
            >
              연결은 이렇게 보호돼요
            </Text>
            <Body muted small>
              서버는 중계만 하고 내용은 볼 수 없어요. 두 화면의 숫자가 같을 때만
              연결됩니다.
            </Body>
          </Card>
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

export function Code({ value }: { value: string }) {
  const theme = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', gap: 8, marginVertical: 20 }}
      accessibilityLabel={`숫자 ${value.split('').join(' ')}`}
    >
      {value.split('').map((digit, index) => (
        <View
          key={index}
          style={{
            width: 42,
            height: 56,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: theme.text, fontSize: 28, fontWeight: '700' }}>
            {digit}
          </Text>
        </View>
      ))}
    </View>
  );
}

function RecoveryMaterial({
  code,
  bytes,
  fileName,
}: {
  code: string;
  bytes: Buffer;
  fileName: string;
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <Card>
        <Text style={{ color: theme.text, fontWeight: '600', marginBottom: 8 }}>
          ① 복구 코드
        </Text>
        <Text
          selectable
          style={{
            color: theme.text,
            fontFamily: 'monospace',
            fontSize: 13,
            fontWeight: '600',
            lineHeight: 22,
            padding: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: theme.border,
            backgroundColor: theme.canvas,
          }}
        >
          {code}
        </Text>
        <Button
          label={copied ? '복사했어요 (30초 뒤 지움)' : '복사 (30초 뒤 지움)'}
          onPress={() => {
            copySecret(code);
            setCopied(true);
          }}
          style={{ marginHorizontal: 0, marginTop: 10, marginBottom: 0 }}
        />
      </Card>
      <Card>
        <Text style={{ color: theme.text, fontWeight: '600', marginBottom: 4 }}>
          ② 복구 파일 (.trec)
        </Text>
        <Body muted small>
          암호화된 파일. 코드와 함께 있어야 열려요. 드라이브나 PC 같은 다른 곳에
          저장하세요.
        </Body>
        <Button
          label={saved ? '저장했어요' : '파일로 저장'}
          onPress={async () => {
            try {
              setError('');
              if (await saveRecoveryFile(bytes, fileName)) setSaved(true);
            } catch (e) {
              setError(messageFor(e));
            }
          }}
          style={{ marginHorizontal: 0, marginTop: 10, marginBottom: 0 }}
        />
      </Card>
      <ErrorText>{error}</ErrorText>
    </>
  );
}

function BackupView({ onDone }: { onDone: () => void }) {
  const { account } = useApp();
  const material = account!.workspace.recoveryMaterial();
  return (
    <Screen>
      <Header step={3} label="복구 자료 · 3/3" />
      <View style={{ paddingHorizontal: 18, paddingBottom: 8 }}>
        <Title>복구 자료를 따로 보관하세요</Title>
        <Body muted>
          모든 기기를 잃어버렸을 때 데이터를 되찾는 유일한 방법이에요. 우리도
          대신 찾아드릴 수 없어요.
        </Body>
      </View>
      <RecoveryMaterial
        code={material.code}
        bytes={material.bytes}
        fileName="thread_recovery.trec"
      />
      <Button kind="primary" label="보관했어요" onPress={onDone} />
    </Screen>
  );
}

function PickedFile({
  name,
  onPick,
}: {
  name: string | null;
  onPick: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPick} accessibilityRole="button">
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <FileCheck color={name ? theme.success : theme.muted} size={22} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontWeight: '600' }}>
            {name ?? '복구 파일 고르기'}
          </Text>
          <Body muted small>
            {name
              ? '다시 누르면 다른 파일을 고릅니다.'
              : '저장한 .trec 파일을 선택하세요.'}
          </Body>
        </View>
      </Card>
    </Pressable>
  );
}

// The user proves they kept both: reopen the saved file and type the code.
function ConfirmView({ onBack }: { onBack: () => void }) {
  const { account, setupDone, reloadSetup } = useApp();
  const [file, setFile] = useState<{ name: string; bytes: Buffer } | null>(
    null,
  );
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const confirm = async () => {
    if (!file || !code.trim())
      return setError('복구 파일을 고르고 코드를 입력해주세요.');
    setBusy(true);
    setError('');
    try {
      await account!.workspace.confirmRecovery(code.trim(), file.bytes);
      await account!.session.use(store =>
        finishOwner(account!.workspace, store),
      );
      setupDone();
    } catch (e) {
      reloadSetup();
      setError(messageFor(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header label="복구 자료 확인" onBack={onBack} />
      <View style={{ paddingHorizontal: 18, paddingBottom: 8 }}>
        <Title>제대로 보관했는지 확인할게요</Title>
        <Body muted>저장한 파일을 다시 열고 코드를 입력하세요.</Body>
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
        placeholder="복구 코드 (THREAD1-…)"
        autoCapitalize="characters"
        autoCorrect={false}
        value={code}
        onChangeText={setCode}
      />
      <ErrorText>{error}</ErrorText>
      <Button
        kind="primary"
        label="확인하고 시작하기"
        busy={busy}
        onPress={confirm}
      />
    </Screen>
  );
}

// All other devices lost: the recovery file + code join this phone and replace the
// keys (desktop lost-device recovery), with fresh recovery material to keep.
function RecoveryJoinView({ onBack }: { onBack: () => void }) {
  const { account, setupDone } = useApp();
  const [stage, setStage] = useState<'old' | 'new' | 'confirm'>('old');
  const [file, setFile] = useState<{ name: string; bytes: Buffer } | null>(
    null,
  );
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const workspace = account!.workspace;
  const [material, setMaterial] = useState<{
    code: string;
    bytes: Buffer;
  } | null>(null);
  useEffect(() => {
    if (stage !== 'new') return;
    workspace
      .recovery('material')
      .then(setMaterial)
      .catch(e => setError(messageFor(e)));
  }, [stage, workspace]);

  const pickFile = async () => {
    try {
      const picked = await pickRecoveryFile();
      if (picked) setFile(picked);
    } catch (e) {
      setError(messageFor(e));
    }
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  if (stage === 'new') {
    if (!material) return null;
    return (
      <Screen>
        <Header label="복구 코드로 연결 · 새 복구 자료" />
        <View style={{ paddingHorizontal: 18, paddingBottom: 8 }}>
          <Title>새 복구 자료를 보관하세요</Title>
          <Body muted>
            복구하면 예전 코드와 파일은 더 이상 쓸 수 없어요. 새 자료를 따로
            보관하세요.
          </Body>
        </View>
        <RecoveryMaterial
          code={material.code}
          bytes={material.bytes}
          fileName="thread_recovery_new.trec"
        />
        <Button
          kind="primary"
          label="보관했어요"
          onPress={() => {
            setFile(null);
            setCode('');
            setStage('confirm');
          }}
        />
      </Screen>
    );
  }
  return (
    <Screen>
      <Header
        label={stage === 'old' ? '복구 코드로 연결' : '새 복구 자료 확인'}
        onBack={stage === 'old' ? onBack : () => setStage('new')}
      />
      <View style={{ paddingHorizontal: 18, paddingBottom: 8 }}>
        <Title>
          {stage === 'old'
            ? '복구 파일과 코드를 준비하세요'
            : '새 복구 자료를 확인할게요'}
        </Title>
        <Body muted>
          {stage === 'old'
            ? '계정을 만들 때 저장한 .trec 파일과 코드가 필요해요. 이 휴대폰이 새 소유 기기가 되고, 다른 기기는 연결이 끊겨요.'
            : '방금 저장한 새 파일을 다시 열고 새 코드를 입력하세요.'}
        </Body>
      </View>
      <PickedFile name={file?.name ?? null} onPick={pickFile} />
      <Field
        placeholder="복구 코드 (THREAD1-…)"
        autoCapitalize="characters"
        autoCorrect={false}
        value={code}
        onChangeText={setCode}
      />
      <ErrorText>{error}</ErrorText>
      <Button
        kind="primary"
        busy={busy}
        label={stage === 'old' ? '확인하고 복구 시작' : '확인하고 연결 마치기'}
        onPress={() =>
          run(async () => {
            if (!file || !code.trim()) throw Error('RECOVERY_INPUT_REQUIRED');
            if (stage === 'old') {
              await workspace.recovery('prepare', {
                confirmed: true,
                code: code.trim(),
                bytes: file.bytes,
              });
              setStage('new');
            } else {
              await workspace.recovery('confirm', {
                code: code.trim(),
                bytes: file.bytes,
              });
              await workspace.recovery('commit', { confirmed: true });
              setupDone();
            }
          })
        }
      />
    </Screen>
  );
}
