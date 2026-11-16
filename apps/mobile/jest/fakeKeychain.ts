import type { VaultKeychain } from '@/core/vault/localVault';

// In-memory Keystore stand-in; `authAllowed` decides whether biometric/PIN prompts succeed.
// `delay` (ms) makes reads take time like the real Keystore (#112).
export function fakeKeychain() {
  const entries = new Map<string, { user: string; secret: string }>();
  const state = { authAllowed: true, authReads: 0, delay: 0 };
  const wait = () =>
    state.delay
      ? new Promise(resolve => setTimeout(resolve, state.delay))
      : Promise.resolve();
  const keychain: VaultKeychain = {
    async setAuthKey(service, keyHex) {
      entries.set(service, { user: 'thread', secret: keyHex });
    },
    async getAuthKey(service) {
      state.authReads++;
      await wait();
      return state.authAllowed ? entries.get(service)?.secret ?? null : null;
    },
    async setSessionKey(service, boot, keyHex) {
      entries.set(service, { user: boot, secret: keyHex });
    },
    async getSessionKey(service) {
      await wait();
      const entry = entries.get(service);
      return entry ? { bootId: entry.user, keyHex: entry.secret } : null;
    },
    async remove(service) {
      entries.delete(service);
    },
  };
  return { keychain, entries, state };
}
