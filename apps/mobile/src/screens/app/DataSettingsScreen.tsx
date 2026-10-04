import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Smartphone, MonitorSmartphone } from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import { copySecret, saveRecoveryFile } from '@/core/files';
import { Button, IconButton } from '@/ui/kit';
import { messageFor } from '@/ui/messages';
import { useTheme } from '@/ui/theme';
import { Group, Item } from './SettingsScreen';
import { useNow } from './parts';

export default function DataSettingsScreen() {
  const { account, sync } = useApp();
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const now = useNow();
  const [note, setNote] = useState('');
  const [syncing, setSyncing] = useState(false);
  if (!account) return null;

  const owner = account.session.use(store =>
    store.get('recovery', '$owner-identity'),
  );
  const devices = account.sync.devices();
  const inspection = account.vault.inspect();
  const pending = sync?.pending ?? 0;
  const synced =
    !!sync?.lastSyncedAt && pending === 0 && sync.phase === 'ACTIVE';
  const minutes = sync?.lastSyncedAt
    ? Math.floor((now - sync.lastSyncedAt) / 60000)
    : null;
  const when =
    minutes == null
      ? '아직 없음'
      : minutes < 1
      ? '방금'
      : minutes < 60
      ? `${minutes}분 전`
      : `${Math.floor(minutes / 60)}시간 전`;

  return (
    <View style={{ flex: 1, backgroundColor: theme.canvas }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 8,
          paddingTop: 8,
        }}
      >
        <IconButton label="뒤로" onPress={() => navigation.goBack()}>
          <ArrowLeft color={theme.secondary} size={22} />
        </IconButton>
        <Text style={{ color: theme.text, fontSize: 19, fontWeight: '700' }}>
          데이터
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 40, paddingTop: 8 }}>
        <View
          style={{
            marginHorizontal: 12,
            padding: 14,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surface,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 3,
                borderRadius: 999,
                backgroundColor: sync?.connected
                  ? theme.successSoft
                  : theme.hover,
              }}
            >
              <Text
                style={{
                  color: sync?.connected ? theme.success : theme.secondary,
                  fontSize: 12,
                  fontWeight: '600',
                }}
              >
                {sync?.syncing
                  ? '동기화 중'
                  : sync?.connected
                  ? '온라인'
                  : '오프라인'}
              </Text>
            </View>
            <View
              style={{
                flex: 1,
                height: 8,
                borderRadius: 4,
                flexDirection: 'row',
                gap: 3,
                opacity: sync?.connected ? 1 : 0.4,
              }}
            >
              <View
                style={{
                  flex: pending ? 82 : 1,
                  borderRadius: 4,
                  backgroundColor:
                    synced || pending ? theme.success : theme.border,
                }}
              />
              {pending > 0 && (
                <View
                  style={{
                    flex: 18,
                    borderRadius: 4,
                    backgroundColor: theme.warning,
                  }}
                />
              )}
            </View>
            <Text
              style={{
                color: synced
                  ? theme.success
                  : pending
                  ? theme.warning
                  : theme.muted,
                fontSize: 12,
                fontWeight: '600',
              }}
            >
              {synced
                ? '모두 동기화됨'
                : pending
                ? `보낼 변경 ${pending}개`
                : '—'}
            </Text>
          </View>
          <Text style={{ color: theme.muted, fontSize: 12, marginTop: 8 }}>
            마지막 동기화 {when} · 서버는 암호화된 내용만 봅니다
          </Text>
          {!!sync?.error && (
            <Text style={{ color: theme.danger, fontSize: 12, marginTop: 4 }}>
              {messageFor(sync.error)}
            </Text>
          )}
          {(sync?.conflicts ?? 0) > 0 && (
            <Text style={{ color: theme.warning, fontSize: 12, marginTop: 4 }}>
              직접 확인이 필요한 변경 {sync!.conflicts}개 (PC에서 정리할 수
              있어요)
            </Text>
          )}
          <Button
            label="지금 동기화"
            busy={syncing}
            onPress={() => {
              setSyncing(true);
              account.sync
                .syncNow()
                .catch(() => null)
                .finally(() => setSyncing(false));
            }}
            style={{ marginHorizontal: 0, marginTop: 12, marginBottom: 0 }}
          />
        </View>

        <Group title="연결된 기기">
          {devices.length === 0 && <Item title="첫 동기화 뒤에 보여요" last />}
          {devices.map((device, index) => (
            <View
              key={device.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderBottomWidth: index === devices.length - 1 ? 0 : 1,
                borderColor: theme.border,
              }}
            >
              {device.self ? (
                <Smartphone color={theme.secondary} size={20} />
              ) : (
                <MonitorSmartphone color={theme.secondary} size={20} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 15 }}>
                  {device.self
                    ? '이 휴대폰'
                    : `기기 ${device.id.slice(0, 4).toUpperCase()}`}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 12 }}>
                  {device.canAuthorizeDevices
                    ? '소유 기기'
                    : device.role === 'write'
                    ? '읽기·쓰기'
                    : '읽기 전용'}
                </Text>
              </View>
            </View>
          ))}
        </Group>
        <Button
          kind="primary"
          label="새 기기 추가"
          onPress={() => navigation.navigate('ApproveDevice')}
          style={{ marginTop: 12 }}
        />

        <Group title="보호">
          <Item
            title="잠금 해제"
            value={
              inspection.passwordAvailable ? '생체·PIN + 비밀번호' : '생체·PIN'
            }
          />
          {owner && (
            <>
              <Item
                title="복구 코드 복사"
                detail="30초 뒤 클립보드에서 지워져요"
                onPress={() => {
                  copySecret(account.workspace.recoveryMaterial().code);
                  setNote('복구 코드를 복사했어요.');
                }}
              />
              <Item
                title="복구 파일 다시 저장"
                last
                onPress={() =>
                  saveRecoveryFile(account.workspace.recoveryMaterial().bytes)
                    .then(saved => saved && setNote('복구 파일을 저장했어요.'))
                    .catch(e => setNote(messageFor(e)))
                }
              />
            </>
          )}
        </Group>
        {!!note && (
          <Text
            style={{
              color: theme.muted,
              fontSize: 12,
              marginHorizontal: 20,
              marginTop: 8,
            }}
          >
            {note}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
