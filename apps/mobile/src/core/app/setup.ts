import type { EncryptedStore } from '@/core/vault/store';
import type { MobileWorkspace, Transport } from '@/core/workspace/workspace';

const { EncryptedReplica } = require('@thread/e2ee/src/replica');
const { ApplicationAdapter } = require('@thread/e2ee/src/applicationAdapter');

const READY = '$mobile-ready';

// Where an unlocked vault stands in the setup flow (#85):
//  READY         connected (paired, recovered, or first device activated) -> the app
//  OWNER_BACKUP  first device: keep the recovery code and file, then confirm them
//  OWNER_FINISH  first device: recovery confirmed; register and activate on the server
//  CONNECT       empty vault: ask the server whether this is a new account or an existing one
export type SetupState = 'READY' | 'OWNER_BACKUP' | 'OWNER_FINISH' | 'CONNECT';

export function setupState(store: EncryptedStore): SetupState {
  if (store.get('recovery', READY) || store.get('recovery', '$paired-device'))
    return 'READY';
  const recovery = store.get('recovery', '$lost-device-recovery');
  if (recovery?.phase === 'ACTIVE') return 'READY';
  const owner = store.get('recovery', '$owner-identity');
  if (owner?.phase === 'RECOVERY_UNCONFIRMED') return 'OWNER_BACKUP';
  if (owner?.phase === 'RECOVERY_CONFIRMED') return 'OWNER_FINISH';
  return 'CONNECT';
}

export function markReady(store: EncryptedStore) {
  store.put('recovery', READY, { schema: 1 });
}

// New account or existing data? Read from the server (vault/status).
export async function accountKind(
  transport: Transport,
  signal?: AbortSignal,
): Promise<'NEW' | 'EXISTING'> {
  const status = await transport.accountStatus(signal);
  return status.accountMode === 'e2ee' && status.vaultMode === 'active'
    ? 'EXISTING'
    : 'NEW';
}

// First device after the recovery check: register the vault and activate it.
export async function finishOwner(
  workspace: MobileWorkspace,
  store: EncryptedStore,
  signal?: AbortSignal,
) {
  const registered = await workspace.registerIdentity(signal);
  if (registered.phase !== 'REGISTERED') throw Error('PAIRING_REQUIRED');
  const active = await workspace.activateEmpty(signal);
  if (active.phase !== 'ACTIVE') throw Error('ACCOUNT_STATE_CHANGED');
  markReady(store);
}

// The application layer on the local replica: works offline once the first sync
// installed the vault snapshot ($sync-state).
export function adapterFor(store: EncryptedStore) {
  const meta = store.get('confirmed', '$sync-state');
  if (!meta) return null;
  return new ApplicationAdapter(
    new EncryptedReplica(store, meta.scope, { initialize: false }),
  );
}
