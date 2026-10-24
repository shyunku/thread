// Device names (#77): the phone's device list and rename sheet, with the shared write
// switch off (2.4.0) and on (2.5.0, flipped here only).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import { installE2eePlatform } from '@/core/e2ee/platform';
import { LocalVault } from '@/core/vault/localVault';
import { VaultSession } from '@/core/vault/session';
import {
  MobileWorkspace,
  VaultActivity,
  vaultIdFor,
} from '@/core/workspace/workspace';
import { SyncService, type Device } from '@/core/sync/syncService';
import { adapterFor } from '@/core/app/setup';
import { createTestDatabases } from '../jest/testDatabases';
import { fakeKeychain } from '../jest/fakeKeychain';
import { createFakeThreadServer } from '../jest/fakeThreadServer';
import DataSettingsScreen from '@/screens/app/DataSettingsScreen';

jest.setTimeout(30000);
const flags = require('@thread/e2ee/src/model/deviceNames').flags;
afterEach(() => {
  flags.DEVICE_NAMES_WRITE = false;
});

beforeAll(async () => {
  await installE2eePlatform().sodium.ready;
});
const cleanups: (() => void)[] = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach(cleanup => cleanup()),
);

// A first phone on an in-memory server (as in workspace.test.ts).
async function ownerPhone() {
  const scope = {
    environment: 'development' as const,
    accountId: 'u1',
    vaultId: vaultIdFor('development', 'u1'),
  };
  const server = createFakeThreadServer(scope.vaultId);
  const dbs = createTestDatabases();
  cleanups.push(dbs.cleanup);
  const vault = new LocalVault(scope, {
    openDatabase: dbs.openDatabase,
    keychain: fakeKeychain().keychain,
    bootId: () => 'count:1',
  });
  const session = new VaultSession(vault);
  await session.create();
  cleanups.push(() => {
    session.lock().catch(() => {});
  });
  const activity = new VaultActivity();
  const transport = () => server.transport;
  const workspace = new MobileWorkspace({
    session,
    transport,
    reauthenticate: async () => true,
    activity,
  });
  const sync = new SyncService({
    session,
    transport,
    activity,
    deviceModel: () => 'SM-S921N',
  });
  cleanups.push(() => sync.close());
  await workspace.prepareIdentity();
  const kit = workspace.recoveryMaterial();
  await workspace.confirmRecovery(kit.code, kit.bytes);
  await workspace.registerIdentity();
  await workspace.activateEmpty();
  const nameRows = () =>
    session.use(store =>
      store
        .entries('visible', '', 256)
        .map((row: any) => row.value.fields?.[0]?.value)
        .filter((row: any) => row?.entityType === 'deviceName'),
    );
  const lists = () => session.use(store => adapterFor(store)!.lists());
  return { server, session, sync, nameRows, lists };
}
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 50)));

test('2.4.0 phone: no name row is written; the list shows this phone by its model', async () => {
  const phone = await ownerPhone();
  await phone.sync.syncNow();
  await settle();
  expect(phone.nameRows()).toEqual([]);
  const [own] = phone.sync.devices();
  expect(own).toMatchObject({
    self: true,
    name: 'SM-S921N',
    showId: false,
    canRename: false,
  });
  expect(() =>
    phone.session.use(store =>
      adapterFor(store)!.mutate('device/setDeviceName', [own.id, '내 폰']),
    ),
  ).toThrow('DEVICE_NAMES_DISABLED');
  expect(phone.nameRows()).toEqual([]);
});

test('switch on: the phone writes its model once after a sync and lists the name', async () => {
  flags.DEVICE_NAMES_WRITE = true;
  const phone = await ownerPhone();
  await phone.sync.syncNow();
  await settle();
  await phone.sync.syncNow();
  const rows = phone.nameRows();
  expect(rows).toHaveLength(1);
  expect(rows[0].fields).toMatchObject({
    name: 'SM-S921N',
    model: 'SM-S921N',
  });
  expect(phone.sync.status().pending).toBe(0);
  phone.session.use(store =>
    adapterFor(store)!.mutate('device/setDeviceName', [
      rows[0].entityId,
      '내 폰',
    ]),
  );
  const [own] = phone.sync.devices();
  expect(own).toMatchObject({ name: '내 폰', canRename: true });
  // Names passed from the model win over a fresh read; removed devices never show.
  const listed = phone.sync.devices([
    { deviceId: own.id, name: '다른 이름', model: null },
    { deviceId: 'gone-device', name: '옛 폰', model: null },
  ]);
  expect(listed.map(d => d.name)).toEqual(['다른 이름']);
  await phone.sync.syncNow();
  expect(phone.nameRows()).toHaveLength(1);
});

// ---- Screen ----
const mockApp: any = {};
const mockNavigate = jest.fn();
jest.mock('@/app/AppContext', () => ({ useApp: () => mockApp }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useFocusEffect: () => {},
}));

const device = (patch: Partial<Device>): Device => ({
  id: 'x',
  role: 'write',
  canAuthorizeDevices: false,
  self: false,
  addedAt: null,
  name: null,
  model: null,
  shortId: 'X',
  showId: true,
  canRename: false,
  ...patch,
});
function screenWith(devices: Device[]) {
  Object.assign(mockApp, {
    sync: { phase: 'ACTIVE', connected: true, pending: 0, lastSyncedAt: null },
    model: { deviceNames: [] },
    mutate: jest.fn(),
    account: {
      session: {
        use: (fn: any) =>
          fn({ get: () => ({ phase: 'RECOVERY_CONFIRMED' }) }),
      },
      sync: { devices: () => devices, syncNow: jest.fn() },
      vault: { inspect: () => ({ passwordAvailable: false }) },
      workspace: { rotation: jest.fn(async () => null) },
    },
  });
  return render(
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <DataSettingsScreen />
    </SafeAreaProvider>,
  );
}
const sep24 = new Date(2026, 8, 24).getTime();
const list = (canRename: boolean) => [
  device({
    id: 'c90d1',
    self: true,
    name: 'Galaxy S24',
    model: 'Galaxy S24',
    shortId: 'C90D',
    showId: true,
    canRename,
  }),
  device({
    id: '2a911',
    role: 'read',
    name: 'Galaxy S24',
    model: 'Galaxy S24',
    shortId: '2A91',
    showId: true,
    addedAt: sep24,
    canRename,
  }),
  device({ id: '7be01', shortId: '7BE0', addedAt: sep24, canRename }),
];

test('rows: name, the short id when names repeat, "다른 기기" without a name', async () => {
  await screenWith(list(false));
  expect(screen.getByText('C90D')).toBeTruthy();
  expect(screen.getByText('2A91')).toBeTruthy();
  expect(screen.getByText('이 휴대폰 · 처음 만든 기기')).toBeTruthy();
  expect(screen.getByText('9월 24일 연결 · 보기만')).toBeTruthy();
  expect(screen.getByText('9월 24일 연결')).toBeTruthy();
  expect(screen.getByText(/다른 기기/)).toBeTruthy();
});

test('switch off: no rename sheet; the own row is not pressable', async () => {
  await screenWith(list(false));
  await fireEvent.press(screen.getByText('이 휴대폰 · 처음 만든 기기'));
  expect(screen.queryByText('Galaxy S24 · C90D')).toBeNull();
  await fireEvent.press(screen.getByText('9월 24일 연결'));
  expect(await screen.findByText('다른 기기 · 7BE0')).toBeTruthy();
  expect(screen.queryByText('이름 저장')).toBeNull();
  expect(screen.queryByLabelText('기기 이름')).toBeNull();
  expect(screen.getByText('기기 해제')).toBeTruthy();
});

test('switch on: tapping a row opens the name sheet and saving renames it', async () => {
  await screenWith(list(true));
  await fireEvent.press(screen.getByText('이 휴대폰 · 처음 만든 기기'));
  expect(await screen.findByText('Galaxy S24 · C90D')).toBeTruthy();
  expect(
    screen.getByText(/비워 두면 모델 이름\(Galaxy S24\)으로 보여요/),
  ).toBeTruthy();
  // The own device cannot be removed from here.
  expect(screen.queryByText('기기 해제')).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('기기 이름'), '내 폰');
  await fireEvent.press(screen.getByText('이름 저장'));
  expect(mockApp.mutate).toHaveBeenCalledWith('device/setDeviceName', [
    'c90d1',
    '내 폰',
  ]);
});

test('switch on: a device without a known model needs a name, errors are shown', async () => {
  await screenWith(list(true));
  mockApp.mutate.mockImplementation(() => {
    throw Error('DEVICE_NAME_INVALID');
  });
  await fireEvent.press(screen.getByText('9월 24일 연결'));
  await screen.findByText('다른 기기 · 7BE0');
  expect(screen.queryByText(/비워 두면/)).toBeNull();
  expect(
    screen.getByRole('button', { name: '이름 저장' }).props.accessibilityState
      .disabled,
  ).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('기기 이름'), '회사 노트북');
  await fireEvent.press(screen.getByText('이름 저장'));
  expect(await screen.findByText(/이름은 1~40자로/)).toBeTruthy();
  expect(screen.getByText('기기 해제')).toBeTruthy();
});
