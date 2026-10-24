import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  ArrowLeft,
  ChevronRight,
  Smartphone,
  MonitorSmartphone,
} from 'lucide-react-native';
import { useApp } from '@/app/AppContext';
import { copySecret, saveRecoveryFile } from '@/core/files';
import { Body, Button, Field, IconButton, Sheet } from '@/ui/kit';
import { messageFor } from '@/ui/messages';
import { useTheme } from '@/ui/theme';
import type { Device } from '@/core/sync/syncService';
import { Group, Item } from './SettingsScreen';
import { useNow } from './parts';

const { shortDeviceId, MAX_LENGTH } = require('@thread/e2ee/src/model/deviceNames');

// "회사 노트북", "Galaxy S24 · C90D" when two names are the same, "다른 기기 · 7BE0" when
// the device has no name yet (#77).
export const deviceLabel = (device: {
  id: string;
  name?: string | null;
  shortId?: string;
  showId?: boolean;
}) => {
  const short = device.shortId ?? shortDeviceId(device.id);
  if (!device.name) return `다른 기기 · ${short}`;
  return device.showId ? `${device.name} · ${short}` : device.name;
};
const roleLabel = (device: Device) =>
  device.canAuthorizeDevices
    ? '보기·편집 · 기기 승인'
    : device.role === 'write'
    ? '보기·편집'
    : '보기만';
const addedLabel = (time: number | null) =>
  time == null
    ? null
    : `${new Date(time).getMonth() + 1}월 ${new Date(time).getDate()}일 연결`;

export default function DataSettingsScreen() {
  const { account, sync, model, mutate } = useApp();
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const now = useNow();
  const [note, setNote] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<Device | null>(null);
  const [draft, setDraft] = useState('');
  const [renameError, setRenameError] = useState('');
  const select = (device: Device | null) => {
    setSelected(device);
    setDraft(device?.name ?? '');
    setRenameError('');
  };
  const saveName = () => {
    if (!selected) return;
    // Unchanged: nothing to write.
    if ((draft.trim() || selected.model) === selected.name) return select(null);
    try {
      mutate('device/setDeviceName', [selected.id, draft]);
      select(null);
    } catch (error) {
      setRenameError(messageFor(error));
    }
  };
  const [pendingChange, setPendingChange] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      account?.workspace
        .rotation('status')
        .then((status: any) =>
          setPendingChange(
            status &&
              [
                'RECOVERY_UNCONFIRMED',
                'RECOVERY_CONFIRMED',
                'COMMITTING',
              ].includes(status.phase)
              ? status.phase
              : null,
          ),
        )
        .catch(() => null);
    }, [account]),
  );
  if (!account) return null;

  const owner = account.session.use(store =>
    store.get('recovery', '$owner-identity'),
  );
  // Removing devices and replacing the recovery key need the vault's owner keys.
  const canChangeKeys = owner?.phase === 'RECOVERY_CONFIRMED';
  const devices = account.sync.devices(model?.deviceNames);
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
            <Pressable
              key={device.id}
              accessibilityRole="button"
              disabled={device.self && !device.canRename}
              onPress={() => select(device)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderBottomWidth: index === devices.length - 1 ? 0 : 1,
                borderColor: theme.border,
                backgroundColor: pressed ? theme.hover : 'transparent',
              })}
            >
              {device.self ? (
                <Smartphone color={theme.secondary} size={20} />
              ) : (
                <MonitorSmartphone color={theme.secondary} size={20} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 15 }}>
                  {device.name ?? '다른 기기'}
                  {device.showId && (
                    <Text style={{ color: theme.muted, fontSize: 11.5 }}>
                      {'  '}
                      {device.shortId}
                    </Text>
                  )}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 12 }}>
                  {device.self
                    ? `이 휴대폰 · ${
                        canChangeKeys ? '처음 만든 기기' : '연결된 기기'
                      }`
                    : addedLabel(device.addedAt)
                    ? `${addedLabel(device.addedAt)}${
                        device.role === 'read' ? ' · 보기만' : ''
                      }`
                    : roleLabel(device)}
                </Text>
              </View>
              {(!device.self || device.canRename) && (
                <ChevronRight color={theme.muted} size={16} />
              )}
            </Pressable>
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
            title="잠금 해제 방식"
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
                last={!canChangeKeys}
                onPress={() =>
                  saveRecoveryFile(account.workspace.recoveryMaterial().bytes)
                    .then(saved => saved && setNote('복구 파일을 저장했어요.'))
                    .catch(e => setNote(messageFor(e)))
                }
              />
              {canChangeKeys && (
                <Item
                  title={
                    pendingChange
                      ? '키 변경 이어서 하기'
                      : '복구 키 새로 만들기'
                  }
                  detail={
                    pendingChange
                      ? '끝내지 않은 해제·키 변경이 있어요'
                      : '코드나 파일이 남에게 보였을 때'
                  }
                  last
                  onPress={() => navigation.navigate('KeyChange')}
                />
              )}
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
      {selected && (
        <Sheet
          visible
          onClose={() => select(null)}
          title={deviceLabel(selected)}
        >
          {selected.canRename && (
            <>
              <Text
                style={{
                  color: theme.secondary,
                  fontSize: 12.5,
                  fontWeight: '600',
                  marginHorizontal: 20,
                  marginBottom: 6,
                }}
              >
                이름
              </Text>
              <Field
                accessibilityLabel="기기 이름"
                value={draft}
                onChangeText={setDraft}
                placeholder={selected.model ?? undefined}
                maxLength={MAX_LENGTH}
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={saveName}
                style={{ marginBottom: 6 }}
              />
              <Body
                muted
                small
                style={{ marginHorizontal: 20, marginBottom: 10 }}
              >
                {selected.model
                  ? `비워 두면 모델 이름(${selected.model})으로 보여요. `
                  : ''}
                연결된 모든 기기에서 같은 이름으로 보여요.
              </Body>
              {!!renameError && (
                <Text
                  style={{
                    color: theme.danger,
                    fontSize: 12,
                    marginHorizontal: 20,
                    marginBottom: 8,
                  }}
                >
                  {renameError}
                </Text>
              )}
              <Button
                kind="primary"
                label="이름 저장"
                disabled={!draft.trim() && !selected.model}
                onPress={saveName}
              />
            </>
          )}
          <Item
            title="연결"
            value={
              selected.self
                ? '이 휴대폰'
                : addedLabel(selected.addedAt)?.replace(' 연결', '') ??
                  '알 수 없음'
            }
          />
          <Item title="권한" value={roleLabel(selected)} last />
          {!selected.self && (
            <Body
              muted
              small
              style={{ marginHorizontal: 20, marginTop: 10, marginBottom: 12 }}
            >
              {canChangeKeys
                ? '잃어버렸거나 더 안 쓰는 기기면 해제하세요. 해제하면 새 복구 키를 만들고 데이터를 새 키로 다시 잠가요.'
                : '기기 해제와 복구 키 변경은 처음 만든 기기에서만 할 수 있어요.'}
            </Body>
          )}
          {!selected.self && canChangeKeys && (
            <Button
              kind="danger"
              label={pendingChange ? '진행 중인 키 변경이 있어요' : '기기 해제'}
              disabled={!!pendingChange}
              onPress={() => {
                const device = selected;
                select(null);
                navigation.navigate('KeyChange', {
                  device: {
                    id: device.id,
                    addedAt: device.addedAt,
                    name: device.name,
                    shortId: device.shortId,
                    showId: device.showId,
                  },
                });
              }}
            />
          )}
          <Button kind="ghost" label="닫기" onPress={() => select(null)} />
        </Sheet>
      )}
    </View>
  );
}
