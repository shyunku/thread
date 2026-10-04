import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/app/theme';
import { installE2eePlatform } from '@/core/e2ee/platform';
import { LocalVault } from '@/core/vault/localVault';
import { deviceVaultDeps } from '@/core/vault/native';
import { VaultSession, VaultPhase } from '@/core/vault/session';
import { createRuntime, environment } from '@/core/app/runtime';

// Development-only controls to exercise the vault on a device until the real
// lock screen is designed (#87). Uses a synthetic scope, never account data.
const DEV_SCOPE = {
  environment: 'development' as const,
  accountId: 'dev-harness',
  vaultId: 'dev-vault',
};
const DEV_PASSWORD = 'dev harness password 1234';

export default function VaultHarness() {
  const session = useMemo(() => {
    installE2eePlatform();
    return new VaultSession(new LocalVault(DEV_SCOPE, deviceVaultDeps));
  }, []);
  const [phase, setPhase] = useState<VaultPhase | null>(null);
  const [note, setNote] = useState('');
  const [account, setAccount] = useState('…');

  useEffect(() => {
    // Loads the account runtime (Keystore account entry, auth and sync modules).
    createRuntime()
      .account.restore()
      .then(user =>
        setAccount(`${environment} · ${user ? user.uid : '로그인 안 됨'}`),
      )
      .catch(error => setAccount(error.message));
  }, []);

  useEffect(() => {
    session.onChange(setPhase);
    session
      .start()
      .then(opened => setNote(opened ? '같은 부팅이라 바로 열림' : ''))
      .catch(error => setNote(error.message));
    return () => session.onChange(null);
  }, [session]);

  const run = (label: string, action: () => Promise<unknown>) => () => {
    setNote(`${label}…`);
    action()
      .then(result => {
        if (label === '쓰기') setNote('기록 수 ' + String(result));
        else setNote(`${label} 완료`);
      })
      .catch(error => setNote(`${label}: ${error.message}`));
  };

  const write = async () =>
    session.use(store => {
      store.put(
        'recovery',
        'dev-counter',
        (store.get('recovery', 'dev-counter') ?? 0) + 1,
      );
      return store.get('recovery', 'dev-counter');
    });

  return (
    <View style={styles.box}>
      <Text style={styles.title}>개발용 계정 · {account}</Text>
      <Text style={styles.title}>개발용 보관함 · {phase ?? '…'}</Text>
      <View style={styles.row}>
        <Button
          label="만들기"
          onPress={run('만들기', () =>
            session.create({ password: DEV_PASSWORD }),
          )}
        />
        <Button
          label="생체/PIN"
          onPress={run('열기', () => session.unlock())}
        />
        <Button
          label="비밀번호"
          onPress={run('비밀번호', () =>
            session.unlockWithPassword(DEV_PASSWORD),
          )}
        />
      </View>
      <View style={styles.row}>
        <Button label="쓰기" onPress={run('쓰기', write)} />
        <Button label="잠그기" onPress={run('잠그기', () => session.lock())} />
      </View>
      {!!note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: 28,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    width: '86%',
  },
  title: { color: colors.secondary, fontSize: 13, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  buttonText: { color: colors.text, fontSize: 13 },
  note: { color: colors.muted, fontSize: 12 },
});
