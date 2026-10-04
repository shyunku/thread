import type { EncryptedStore } from './store';
import type { LocalVault } from './localVault';

export type VaultPhase = 'ABSENT' | 'LOCKED' | 'UNLOCKED' | 'RECOVERY_REQUIRED';

// Holds the open store for one vault. Lock policy (user decision 2026-10-04):
// no timer; the vault locks only when the user locks it or after a device reboot.
// A restarted app process reopens silently within the same boot (LocalVault.resume).
export class VaultSession {
  #vault: LocalVault;
  #store: EncryptedStore | null = null;
  #pending = false;
  #generation = 0;
  #listener: ((phase: VaultPhase) => void) | null = null;

  constructor(vault: LocalVault) {
    this.#vault = vault;
  }

  onChange(listener: ((phase: VaultPhase) => void) | null) {
    this.#listener = listener;
  }

  phase(): VaultPhase {
    if (this.#store) return 'UNLOCKED';
    return this.#vault.inspect().phase;
  }

  #emit() {
    this.#listener?.(this.phase());
  }

  async #open(opener: () => Promise<EncryptedStore | null>) {
    if (this.#pending) throw Error('UNLOCK_IN_PROGRESS');
    this.#pending = true;
    const generation = this.#generation;
    try {
      const store = await opener();
      if (!store) return false;
      // A lock that happened while waiting for the prompt wins.
      if (generation !== this.#generation) {
        store.close();
        throw Error('UNLOCK_CANCELLED');
      }
      this.#store?.close();
      this.#store = store;
      return true;
    } finally {
      this.#pending = false;
      this.#emit();
    }
  }

  start() {
    return this.#open(() => this.#vault.resume());
  }
  create(options: { password?: string } = {}) {
    return this.#open(() => this.#vault.create(options));
  }
  unlock() {
    return this.#open(() => this.#vault.unlock());
  }
  unlockWithPassword(password: string) {
    return this.#open(() => this.#vault.unlockWithPassword(password));
  }

  async lock() {
    this.#generation++;
    const store = this.#store;
    this.#store = null;
    try {
      store?.close();
      await this.#vault.forgetSession();
    } finally {
      this.#emit();
    }
  }

  use<T>(operation: (store: EncryptedStore) => T): T {
    if (!this.#store) throw Error('VAULT_LOCKED');
    return operation(this.#store);
  }
}
