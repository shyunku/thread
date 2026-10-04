import { installE2eePlatform } from '@/core/e2ee/platform';

const { runConformance } = require('@thread/e2ee/test/conformance');

// Under Jest react-native-libsodium maps to libsodium-wrappers (jest.config.js);
// the native module runs the same check on a device (see HomeScreen in dev builds).
test('mobile platform reproduces the shared E2EE conformance fixtures', async () => {
  installE2eePlatform();
  expect(await runConformance()).toEqual([]);
});
