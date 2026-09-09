import {Buffer} from 'buffer';
import sha256 from 'sha256';

type Scope = {environment: 'development' | 'production'; accountId: string; vaultId: string};
const pendingCreations = new Set<string>();

// No AsyncStorage fallback, no automatic reset, no key deletion API.
// The app must explicitly inject react-native-keychain and Platform.OS.
export function createMobileKeyProtection(keychain: any, platform: string) {
  const pending = pendingCreations;
  function context(scope: Scope) {
    if (!scope || !['development', 'production'].includes(scope.environment) ||
        ![scope.accountId, scope.vaultId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 256))
      throw new Error('INVALID_VAULT_SCOPE');
    return {environment: scope.environment, accountId: scope.accountId, vaultId: scope.vaultId};
  }
  async function options(scope: Scope) {
    if (!['android', 'ios'].includes(platform) || !keychain?.setGenericPassword || !keychain?.getGenericPassword)
      throw new Error('SECURE_STORAGE_UNAVAILABLE');
    if (platform === 'android') {
      const level = await keychain.getSecurityLevel();
      const levels = keychain.SECURITY_LEVEL;
      if (!levels || ![levels.SECURE_SOFTWARE, levels.SECURE_HARDWARE].filter(v => v != null).includes(level))
        throw new Error('SECURE_STORAGE_UNAVAILABLE');
    }
    return {
      service: 'thread.vault.v1.' + sha256(JSON.stringify(context(scope))),
      accessible: keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
      accessControl: keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
      ...(platform === 'android' ? {storage: keychain.STORAGE_TYPE.AES_GCM, securityLevel: keychain.SECURITY_LEVEL.SECURE_SOFTWARE} : {}),
      authenticationPrompt: {title: 'Thread 보관함 잠금 해제'},
    };
  }
  return {
    async create(scope: Scope, key: Uint8Array) {
      const pinned = context(scope);
      if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error('INVALID_VAULT_KEY');
      const service = 'thread.vault.v1.' + sha256(JSON.stringify(pinned));
      if (pending.has(service)) throw new Error('VAULT_KEY_BUSY');
      pending.add(service);
      try {
        const opts = await options(scope);
        if (await keychain.hasGenericPassword({service})) throw new Error('VAULT_KEY_EXISTS');
        const result = await keychain.setGenericPassword('vault-key', JSON.stringify({schema: 1, ...pinned, key: Buffer.from(key).toString('base64')}), opts);
        if (!result) throw new Error('VAULT_KEY_UNAVAILABLE');
        return true;
      } finally {pending.delete(service);}
    },
    async open(scope: Scope) {
      const pinned = context(scope), opts = await options(scope);
      let credentials;
      try {credentials = await keychain.getGenericPassword(opts);} catch {throw new Error('VAULT_KEY_UNAVAILABLE');}
      if (!credentials) throw new Error('VAULT_KEY_UNAVAILABLE');
      let envelope;
      try {envelope = JSON.parse(credentials.password);} catch {throw new Error('VAULT_KEY_DAMAGED');}
      if (!envelope || envelope.schema !== 1 || Object.entries(pinned).some(([k,v]) => envelope[k] !== v) ||
          typeof envelope.key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(envelope.key)) throw new Error('VAULT_KEY_DAMAGED');
      const key = Buffer.from(envelope.key, 'base64');
      if (key.length !== 32 || key.toString('base64') !== envelope.key) {key.fill(0);throw new Error('VAULT_KEY_DAMAGED');}
      return key;
    },
  };
}
