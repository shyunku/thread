import * as Keychain from 'react-native-keychain';
import type { AccountStorage } from './account';

const SERVICE = 'thread.account';

// Account and tokens in the Keystore without a prompt (needed for background sync).
export const accountStorage: AccountStorage = {
  async load() {
    try {
      const entry = await Keychain.getGenericPassword({ service: SERVICE });
      if (!entry) return null;
      const value = JSON.parse(entry.password);
      if (
        typeof value?.user?.uid !== 'string' ||
        typeof value?.tokens?.accessToken !== 'string'
      )
        return null;
      return value;
    } catch {
      return null;
    }
  },
  async save(value) {
    const ok = await Keychain.setGenericPassword(
      value.user.uid,
      JSON.stringify(value),
      {
        service: SERVICE,
        accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
      },
    );
    if (!ok) throw Error('KEYSTORE_WRITE_FAILED');
  },
  async clear() {
    await Keychain.resetGenericPassword({ service: SERVICE });
  },
};
