import { Buffer } from 'buffer';
import { NativeModules } from 'react-native';
import { open } from '@op-engineering/op-sqlite';
import * as Keychain from 'react-native-keychain';
import type { VaultDeps, VaultKeychain } from './localVault';
import type { OpenDatabase } from './sqlite';

// Device implementations of the vault's dependencies.

// SQLCipher raw-key form (x'..'): the 32-byte key is used directly, no passphrase KDF.
export const openDatabase: OpenDatabase = ({ name, key }) => {
  const db = open(
    key
      ? { name, encryptionKey: `x'${Buffer.from(key).toString('hex')}'` }
      : { name },
  );
  return {
    executeSync: (sql, params) => db.executeSync(sql, params as any) as any,
    close: () => db.close(),
  };
};

const prompt = {
  title: 'Thread 잠금 해제',
  subtitle: '지문, 얼굴 또는 화면 잠금으로 확인',
  cancel: '취소',
};

export const keychain: VaultKeychain = {
  async setAuthKey(service, keyHex) {
    const ok = await Keychain.setGenericPassword('thread', keyHex, {
      service,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      storage: Keychain.STORAGE_TYPE.AES_GCM,
      authenticationPrompt: prompt,
    });
    if (!ok) throw Error('KEYSTORE_WRITE_FAILED');
  },
  async getAuthKey(service) {
    try {
      const entry = await Keychain.getGenericPassword({
        service,
        accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
        authenticationPrompt: prompt,
      });
      return entry ? entry.password : null;
    } catch {
      return null; // Cancelled, failed or locked out.
    }
  },
  async setSessionKey(service, boot, keyHex) {
    const ok = await Keychain.setGenericPassword(boot, keyHex, {
      service,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
    });
    if (!ok) throw Error('KEYSTORE_WRITE_FAILED');
  },
  async getSessionKey(service) {
    try {
      const entry = await Keychain.getGenericPassword({ service });
      return entry ? { bootId: entry.username, keyHex: entry.password } : null;
    } catch {
      return null;
    }
  },
  async remove(service) {
    await Keychain.resetGenericPassword({ service });
  },
};

export function bootId(): string {
  const module = NativeModules.ThreadBootInfo;
  if (!module?.getBootId) throw Error('BOOT_INFO_UNAVAILABLE');
  return String(module.getBootId());
}

export const deviceVaultDeps: VaultDeps = { openDatabase, keychain, bootId };
