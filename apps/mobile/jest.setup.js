/* eslint-env jest */
// Native modules are not available under Jest. App code reaches them only through
// the device runtime (src/core/app/runtime.ts), which UI tests replace with fakes.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const icon = name => {
  const Icon = () => null;
  Icon.displayName = name;
  return Icon;
};
jest.mock(
  'lucide-react-native',
  () =>
    new Proxy(
      { __esModule: true },
      {
        get: (target, key) => (key in target ? target[key] : icon(String(key))),
      },
    ),
);
jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: { setString: jest.fn(), getString: jest.fn(async () => '') },
}));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  keepLocalCopy: jest.fn(),
  saveDocuments: jest.fn(async () => [{ uri: 'content://saved' }]),
  isErrorWithCode: () => false,
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
}));
jest.mock('@dr.pogodin/react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  readFile: jest.fn(),
  writeFile: jest.fn(async () => {}),
  unlink: jest.fn(async () => {}),
}));
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(),
    signOut: jest.fn(async () => null),
    signIn: jest.fn(),
  },
  isErrorWithCode: () => false,
  isSuccessResponse: () => false,
  statusCodes: {},
}));
jest.mock('react-native-keychain', () => ({
  ACCESS_CONTROL: {},
  ACCESSIBLE: {},
  STORAGE_TYPE: {},
}));
jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));
