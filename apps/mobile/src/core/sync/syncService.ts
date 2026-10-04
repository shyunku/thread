import type { VaultSession } from '@/core/vault/session';
import { VaultActivity, type Transport } from '@/core/workspace/workspace';

const { openSyncSession } = require('@thread/e2ee/src/syncSession');
const {
  startSyncEvents,
  syncScheduler,
} = require('@thread/e2ee/src/syncEvents');

export type SyncStatus = {
  phase:
    | 'IDLE'
    | 'SYNCING'
    | 'ACTIVE'
    | 'WAITING_FOR_MIGRATION'
    | 'OFFLINE'
    | 'LOCKED'
    | 'ERROR';
  connected: boolean;
  syncing: boolean;
  pending: number | null;
  conflicts: number;
  lastSyncedAt: number | null;
  error: string | null;
};

// Encrypted sync for the open vault, the same engine as the desktop (packages/e2ee):
// signed pull/push, snapshot on open, automatic conflict rebase (#94).
// Triggers: local edits (requestSync), the server's change signals while the app is
// in the foreground, returning to the foreground, and a 15-second fallback poll.
// Edits made offline stay in the encrypted outbox and are sent on the next success.
export class SyncService {
  #session: VaultSession;
  #transport: () => Transport;
  #activity: VaultActivity;
  #sync: any = null;
  #running: Promise<SyncStatus> | null = null;
  #abort = new AbortController();
  #status: SyncStatus = {
    phase: 'IDLE',
    connected: false,
    syncing: false,
    pending: null,
    conflicts: 0,
    lastSyncedAt: null,
    error: null,
  };
  #listener: ((status: SyncStatus) => void) | null = null;
  #poller: ReturnType<typeof setInterval> | null = null;
  #events: { done: Promise<void> } | null = null;
  #eventsAbort: AbortController | null = null;
  readonly requestSync: () => void;

  constructor({
    session,
    transport,
    activity = new VaultActivity(),
  }: {
    session: VaultSession;
    transport: () => Transport;
    activity?: VaultActivity;
  }) {
    this.#session = session;
    this.#transport = transport;
    this.#activity = activity;
    // Coalesces bursts of triggers into one run; retries while another vault action runs.
    this.requestSync = syncScheduler(() => this.syncNow());
  }

  onChange(listener: ((status: SyncStatus) => void) | null) {
    this.#listener = listener;
  }
  status() {
    return this.#status;
  }
  #set(patch: Partial<SyncStatus>) {
    this.#status = { ...this.#status, ...patch };
    this.#listener?.(this.#status);
  }

  #counts() {
    try {
      return this.#session.use(() => this.#sync?.replica.status() ?? null);
    } catch {
      return null;
    }
  }

  syncNow(): Promise<SyncStatus> {
    if (this.#running) return this.#running;
    const running = this.#run().finally(() => {
      if (this.#running === running) this.#running = null;
    });
    this.#running = running;
    return running;
  }

  async #run(): Promise<SyncStatus> {
    if (this.#activity.busy) throw Error('VAULT_BUSY');
    this.#activity.busy = true;
    const signal = this.#abort.signal;
    this.#set({ syncing: true });
    try {
      const transport = this.#transport();
      if (!this.#sync) {
        const store = this.#session.use(value => value);
        const result = await openSyncSession({ store, transport, signal });
        if (result.phase !== 'ACTIVE') {
          this.#set({
            phase: result.phase,
            syncing: false,
            connected: true,
            error: null,
          });
          return this.#status;
        }
        this.#sync = result;
      }
      const status = await this.#sync.engine.run();
      const counts = this.#counts() ?? status;
      this.#set({
        phase: 'ACTIVE',
        connected: true,
        syncing: false,
        pending: counts.pending,
        conflicts: counts.conflicts,
        lastSyncedAt: Date.now(),
        error: null,
      });
      return this.#status;
    } catch (error: any) {
      const message = error?.message ?? 'SYNC_UNAVAILABLE';
      if (message === 'VAULT_LOCKED') this.close();
      const offline = [
        'SYNC_UNAVAILABLE',
        'NETWORK_UNAVAILABLE',
        'NETWORK_TIMEOUT',
      ].includes(message);
      const counts = this.#counts();
      this.#set({
        phase:
          message === 'VAULT_LOCKED' ? 'LOCKED' : offline ? 'OFFLINE' : 'ERROR',
        connected: false,
        syncing: false,
        pending: counts?.pending ?? this.#status.pending,
        error: offline ? null : message,
      });
      throw error;
    } finally {
      this.#activity.busy = false;
    }
  }

  // Foreground: change signals + fallback poll. Background: stop both (Android limits
  // background network; the next foreground sync catches up through the outbox).
  startForeground({
    endpoint,
    tokens,
    fetch,
  }: {
    endpoint: string;
    tokens: any;
    fetch: any;
  }) {
    this.stopForeground();
    const trigger = () => this.requestSync();
    this.#poller = setInterval(trigger, 15000);
    this.#eventsAbort = new AbortController();
    try {
      this.#events = startSyncEvents({
        endpoint,
        tokens,
        fetch,
        signal: this.#eventsAbort.signal,
        onChange: trigger,
      });
    } catch {
      this.#events = null;
    }
    trigger();
  }

  stopForeground() {
    if (this.#poller) clearInterval(this.#poller);
    this.#poller = null;
    this.#eventsAbort?.abort();
    this.#eventsAbort = null;
    this.#events = null;
  }

  // On lock or sign-out: cancel in-flight work and forget the session keys.
  close() {
    this.stopForeground();
    this.#abort.abort();
    this.#abort = new AbortController();
    this.#sync?.close();
    this.#sync = null;
    this.#set({ phase: 'LOCKED', connected: false, syncing: false });
  }

  // For the application layer (#88): the shared replica of the open vault.
  replica() {
    if (!this.#sync) throw Error('SYNC_REQUIRED');
    return this.#sync.replica;
  }
}
