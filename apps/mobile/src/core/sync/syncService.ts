import type { VaultSession } from '@/core/vault/session';
import { VaultActivity, type Transport } from '@/core/workspace/workspace';
import { deviceModel as nativeModel } from '@/core/device';
import type { DeviceName } from '@/core/model/view';

const { ApplicationAdapter } = require('@thread/e2ee/src/applicationAdapter');
const names = require('@thread/e2ee/src/model/deviceNames');

const { openSyncSession } = require('@thread/e2ee/src/syncSession');
const reencryption = require('@thread/e2ee/src/reencryption');
const {
  startSyncEvents,
  syncScheduler,
} = require('@thread/e2ee/src/syncEvents');

// A membership device as the data screen shows it (#77: name, short id, renaming).
export type Device = {
  id: string;
  role: string;
  canAuthorizeDevices: boolean;
  self: boolean;
  addedAt: number | null;
  name: string | null;
  model: string | null;
  shortId: string;
  showId: boolean;
  canRename: boolean;
};

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
// signed pull/push, a snapshot on the first open (later opens pull changes and check
// the server state digest, #98), automatic conflict rebase (#94).
// Triggers: local edits (requestSync), the server's change signals while the app is
// in the foreground, returning to the foreground, and a 15-second fallback poll.
// Edits made offline stay in the encrypted outbox and are sent on the next success.
export class SyncService {
  #session: VaultSession;
  #transport: () => Transport;
  #activity: VaultActivity;
  #sync: any = null;
  #openFailures = 0;
  #openRetryAt = 0;
  #openError: string | null = null;
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
  #listeners = new Set<(status: SyncStatus) => void>();
  #poller: ReturnType<typeof setInterval> | null = null;
  #events: { done: Promise<void> } | null = null;
  #eventsAbort: AbortController | null = null;
  #deviceModel: () => string;
  #ownNameChecked = false;
  readonly requestSync: () => void;

  constructor({
    session,
    transport,
    activity = new VaultActivity(),
    deviceModel = nativeModel,
  }: {
    session: VaultSession;
    transport: () => Transport;
    activity?: VaultActivity;
    deviceModel?: () => string;
  }) {
    this.#session = session;
    this.#transport = transport;
    this.#activity = activity;
    this.#deviceModel = deviceModel;
    // Coalesces bursts of triggers into one run; retries while another vault action runs.
    this.requestSync = syncScheduler(() => this.syncNow());
  }

  // Replaces every listener (simple single-owner use); see subscribe for more.
  onChange(listener: ((status: SyncStatus) => void) | null) {
    this.#listeners.clear();
    if (listener) this.#listeners.add(listener);
  }
  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  status() {
    return this.#status;
  }
  #set(patch: Partial<SyncStatus>) {
    this.#status = { ...this.#status, ...patch };
    for (const listener of [...this.#listeners]) listener(this.#status);
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
        // A first open (or a digest mismatch) downloads a server snapshot, and the
        // server allows only a few per account at a time (SNAPSHOT_LIMIT). After a
        // failed open, wait before trying again instead of on every trigger, and keep
        // showing the error that started it.
        if (Date.now() < this.#openRetryAt)
          throw Error(this.#openError ?? 'SYNC_UNAVAILABLE');
        const store = this.#session.use(value => value);
        let result;
        try {
          result = await openSyncSession({ store, transport, signal });
        } catch (error: any) {
          const code = error?.message ?? 'SYNC_UNAVAILABLE';
          if (code !== 'SYNC_CANCELLED') {
            this.#openFailures++;
            this.#openRetryAt =
              Date.now() +
              Math.min(15 * 60000, 20000 * 2 ** (this.#openFailures - 1));
            if (code !== 'SNAPSHOT_LIMIT' || !this.#openError)
              this.#openError = code;
          }
          throw error;
        }
        this.#openFailures = 0;
        this.#openRetryAt = 0;
        this.#openError = null;
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
      // The verified point re-encryption checks against, then one re-encryption step
      // if a key change left data to re-protect (desktop workspaceService.sync).
      const sync = this.#sync;
      this.#session.use(store =>
        store.put('recovery', '$last-sync-authority', {
          epoch: sync.epoch,
          keyGeneration: sync.engine.history.current.keyGeneration,
          head: sync.engine.history.current.head,
          cursor: status.cursor,
        }),
      );
      reencryption.advance(sync.replica);
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
      // The own device name (#77) goes out with another sync right after this one.
      if (this.#ensureOwnName()) setTimeout(() => this.requestSync(), 0);
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
    this.#ownNameChecked = false;
    this.#set({ phase: 'LOCKED', connected: false, syncing: false });
  }

  // Device names (#77, written from 2.5.0): once per session, after a sync, a write phone
  // adds its model as its own name when the vault has none for it. True when queued.
  #ensureOwnName(): boolean {
    if (this.#ownNameChecked || !names.writable() || !this.#sync) return false;
    this.#ownNameChecked = true;
    try {
      const sync = this.#sync;
      const deviceId = sync.engine.deviceId;
      const role = sync.engine.history.current.devices.get(deviceId)?.role;
      return this.#session.use(() => {
        const adapter = new ApplicationAdapter(sync.replica);
        const next = names.ownNameMutation(adapter.lists().deviceNames, {
          deviceId,
          role,
          model: this.#deviceModel(),
        });
        return next ? !!adapter.mutate(...next) : false;
      });
    } catch {
      return false;
    }
  }

  // After a key change (device removal, new recovery key, lost-device recovery):
  // drop the session holding the old membership; the next sync reopens it.
  reset() {
    this.#sync?.close();
    this.#sync = null;
  }

  // Devices in the verified membership (after the first sync of this session).
  // addedAt is approximate like the desktop list: a signed add record carries the
  // pairing request's expiry (request time + 10 minutes); other devices have none.
  // Names (#77) are joined for current members only: `deviceNames` from the model when
  // the caller has it, else read here (display only, a failed read means no names).
  devices(deviceNames?: DeviceName[]): Device[] {
    const history = this.#sync?.engine.history;
    if (!history) return [];
    const self = this.#sync.engine.deviceId;
    let known = deviceNames;
    if (!known) {
      try {
        known = this.#session.use(
          () => new ApplicationAdapter(this.#sync.replica).lists().deviceNames,
        );
      } catch {
        known = [];
      }
    }
    const canRename =
      names.writable() && history.current.devices.get(self)?.role === 'write';
    const added = new Map<string, number>();
    for (const record of history.records.values()) {
      const body = record?.body;
      if (
        body?.operation === 'add' &&
        typeof body.device?.id === 'string' &&
        Number.isSafeInteger(body.expiresAt)
      )
        added.set(body.device.id, body.expiresAt - 600000);
    }
    const list = [...history.current.devices.values()].map((device: any) => ({
      id: device.id,
      role: device.role,
      canAuthorizeDevices: !!device.canAuthorizeDevices,
      self: device.id === self,
      addedAt: added.get(device.id) ?? null,
    }));
    let ownModel: string | null = null;
    try {
      ownModel = this.#deviceModel();
    } catch {}
    return names
      .withNames(list, known, { ownId: self, ownModel })
      .map((device: any) => ({ ...device, canRename }));
  }

  // For the application layer (#88): the shared replica of the open vault.
  replica() {
    if (!this.#sync) throw Error('SYNC_REQUIRED');
    return this.#sync.replica;
  }
}
