import { Buffer } from 'buffer';
import type { EncryptedStore } from '@/core/vault/store';
import type { VaultSession } from '@/core/vault/session';

const identity = require('@thread/e2ee/src/ownerIdentity');
const { registerOwner } = require('@thread/e2ee/src/ownerRegistration');
const { activateEmpty } = require('@thread/e2ee/src/newAccountActivation');
const { OwnerRelay, RecipientRelay } = require('@thread/e2ee/src/relayPairing');
const lostRecovery = require('@thread/e2ee/src/lostRecovery');
const { createHash } = require('@thread/e2ee/src/platform');

// Same vault id as the desktop (workspaceService.context): both devices of an
// account must name the vault identically or pairing reports a scope mismatch.
export function vaultIdFor(
  environment: 'development' | 'production',
  uid: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify([environment, uid, 'vault-v1']))
    .digest('hex');
}

export type Transport = Record<string, (...args: any[]) => Promise<any>>;

// One vault action at a time across the workspace and sync (like the desktop's `busy`).
export class VaultActivity {
  busy = false;
}

// Vault-level account actions (UI-agnostic), mirroring the desktop VaultWorkspaceService:
// first-device setup with recovery material, server registration and activation,
// device connection through the relay, and joining with a recovery code.
// One action runs at a time; relay polling may run beside a background sync.
export class MobileWorkspace {
  #session: VaultSession;
  #transport: () => Transport;
  #reauthenticate: () => Promise<boolean>;
  #activity: VaultActivity;
  #relay: any = null;
  #relayBusy = false;

  constructor({
    session,
    transport,
    reauthenticate,
    activity = new VaultActivity(),
  }: {
    session: VaultSession;
    transport: () => Transport;
    reauthenticate: () => Promise<boolean>;
    activity?: VaultActivity;
  }) {
    this.#activity = activity;
    this.#session = session;
    this.#transport = transport;
    this.#reauthenticate = reauthenticate;
  }

  get #busy() {
    return this.#activity.busy;
  }
  set #busy(value: boolean) {
    this.#activity.busy = value;
  }

  #store(): EncryptedStore {
    return this.#session.use(store => store);
  }

  async #exclusive<T>(
    operation: (store: EncryptedStore) => Promise<T> | T,
  ): Promise<T> {
    if (this.#busy) throw Error('VAULT_BUSY');
    this.#busy = true;
    try {
      return await operation(this.#store());
    } finally {
      this.#busy = false;
    }
  }

  // --- First device of a new account ---
  prepareIdentity() {
    return this.#exclusive(store => identity.prepareOwner(store));
  }
  identityStatus() {
    return identity.ownerStatus(this.#store());
  }
  // Code to write down and the encrypted recovery file (.trec) to keep elsewhere.
  recoveryMaterial(): { code: string; bytes: Buffer; fingerprint: string } {
    return identity.recoveryMaterial(this.#store());
  }
  // The user proves they kept both by entering the code and reopening the file.
  confirmRecovery(code: string, bytes: Buffer) {
    return this.#exclusive(store =>
      identity.confirmOwnerRecovery(store, code, bytes),
    );
  }
  registerIdentity(signal?: AbortSignal) {
    return this.#exclusive(store =>
      registerOwner({ store, transport: this.#withSignal(signal), signal }),
    );
  }
  activateEmpty(signal?: AbortSignal) {
    return this.#exclusive(store =>
      activateEmpty({ store, transport: this.#withSignal(signal), signal }),
    );
  }

  #withSignal(signal?: AbortSignal): Transport {
    const base = this.#transport();
    const wrapped: Transport = {};
    for (const [name, method] of Object.entries(base)) {
      wrapped[name] = (value?: any) =>
        name === 'pairingSession' || name === 'accountStatus'
          ? method(signal)
          : method(value, signal);
    }
    return wrapped;
  }

  // --- Device connection through the server relay (6-digit comparison) ---
  // This device as the existing one: ownerStart, ownerPoll, ownerApprove.
  // This device as the new one: recipientPoll, recipientConfirm, recipientReject.
  async relay(action: string, signal?: AbortSignal) {
    const actions = [
      'ownerStart',
      'ownerPoll',
      'ownerApprove',
      'recipientPoll',
      'recipientConfirm',
      'recipientReject',
      'cancel',
    ];
    if (!actions.includes(action)) throw Error('INVALID_PAIR_ACTION');
    const approving = action === 'ownerApprove';
    // Approval changes membership; it waits for a running action instead of interleaving.
    if (approving)
      for (let i = 0; this.#busy && i < 100; i++)
        await new Promise(resolve => setTimeout(resolve, 100));
    if ((approving && this.#busy) || this.#relayBusy) throw Error('VAULT_BUSY');
    const store = this.#store();
    const transport = this.#withSignal(signal);
    this.#relayBusy = true;
    if (approving) this.#busy = true;
    try {
      if (action === 'ownerStart') {
        await this.#relay?.cancel?.();
        this.#relay = new OwnerRelay({ store, transport });
        return await this.#relay.start();
      }
      if (action === 'recipientPoll') {
        if (!(this.#relay instanceof RecipientRelay))
          this.#relay = new RecipientRelay({ store, transport });
        return await this.#relay.poll();
      }
      const relay = this.#relay;
      if (!relay) throw Error('PAIRING_NOT_READY');
      if (action === 'cancel') {
        this.#relay = null;
        return await relay.cancel();
      }
      if (action.startsWith('owner') !== relay instanceof OwnerRelay)
        throw Error('PAIRING_NOT_READY');
      if (action === 'ownerPoll') return await relay.poll();
      if (action === 'ownerApprove')
        return await relay.approve(this.#reauthenticate);
      if (action === 'recipientConfirm') return relay.confirm();
      return await relay.reject();
    } finally {
      this.#relayBusy = false;
      if (approving) this.#busy = false;
    }
  }

  // --- Joining with the recovery code and file (all other devices lost) ---
  // prepare -> (new recovery material: code + file) -> confirm -> commit.
  async recovery(
    action: 'status' | 'prepare' | 'material' | 'confirm' | 'commit' | 'cancel',
    input: { code?: string; bytes?: Buffer; confirmed?: boolean } = {},
    signal?: AbortSignal,
  ) {
    return this.#exclusive(async store => {
      const ready = () => {
        if (signal?.aborted) throw Error('SYNC_CANCELLED');
        store.scope();
      };
      if (action === 'status') return lostRecovery.status(store);
      if (action === 'material') return lostRecovery.material(store);
      if (action === 'cancel') return lostRecovery.cancel(store);
      if (action === 'prepare' || action === 'commit') {
        if (input.confirmed !== true) throw Error('RECOVERY_CONSENT_REQUIRED');
        if (!(await this.#reauthenticate())) throw Error('AUTH_CANCELLED');
        ready();
      }
      const transport = this.#withSignal(signal);
      if (action === 'commit')
        return lostRecovery.commit({ store, transport, ready });
      if (!input.code || !Buffer.isBuffer(input.bytes))
        throw Error('RECOVERY_INPUT_REQUIRED');
      return lostRecovery[action]({
        store,
        transport,
        code: input.code,
        bytes: input.bytes,
        ready,
      });
    });
  }
}
