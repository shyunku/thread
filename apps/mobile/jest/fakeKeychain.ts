import type { VaultKeychain } from '@/core/vault/localVault';

// In-memory Keystore stand-in; `authAllowed` decides whether biometric/PIN prompts succeed.
export function fakeKeychain() {
  const entries = new Map<string, { user: string; secret: string }>();
  const state = { authAllowed: true, authReads: 0 };
  const keychain: VaultKeychain = {
    async setAuthKey(service, keyHex) {
      entries.set(service, { user: 'thread', secret: keyHex });
    },
    async getAuthKey(service) {
      state.authReads++;
      return state.authAllowed ? entries.get(service)?.secret ?? null : null;
    },
    async setSessionKey(service, boot, keyHex) {
      entries.set(service, { user: boot, secret: keyHex });
    },
    async getSessionKey(service) {
      const entry = entries.get(service);
      return entry ? { bootId: entry.user, keyHex: entry.secret } : null;
    },
    async remove(service) {
      entries.delete(service);
    },
  };
  return { keychain, entries, state };
}
