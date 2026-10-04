// In-memory stand-in for the Thread API (v3 vault, relay pairing, sync) as the shared
// transport sees it. It stores and orders records like the server and enforces object
// versions and device counters, but checks no signatures: the devices verify everything.
import { Buffer } from 'buffer';

const p = require('@thread/e2ee/src/protocol');
const m = require('@thread/e2ee/src/membership');
const { createHash, randomBytes } = require('@thread/e2ee/src/platform');

const b64 = (value?: Uint8Array | null) =>
  value ? Buffer.from(value).toString('base64') : undefined;

export function createFakeThreadServer(vaultId: string) {
  let accountMode = 'e2ee_pending';
  let vaultMode = 'uninitialized';
  const epoch = '1';
  let genesis: any = null;
  let state: any = null;
  const events: any[] = [];
  const accepted: {
    record: string;
    result: { seq: string; versions: Record<string, string> };
  }[] = [];
  const objects = new Map<
    string,
    {
      version: string;
      seq: string;
      deleted: boolean;
      operationIndex: number;
      raw: Buffer;
    }
  >();
  const counters = new Map<string, bigint>();
  let session: any = null;
  const snapshots = new Map<string, any[]>();
  const listeners: (() => void)[] = [];

  const fail = (code: string) => {
    throw Error(code);
  };
  const needSession = (id: string) => {
    if (!session || session.sessionId !== id) fail('PAIRING_NOT_FOUND');
  };

  const transport = {
    accountStatus: async () => ({
      vaultId: genesis ? vaultId : '',
      accountMode,
      vaultMode,
      epoch: genesis ? epoch : '',
      keyGeneration: state?.keyGeneration ?? 0,
      revision: state?.revision ?? 0,
      head: state?.head ?? '',
    }),
    membership: async (after = 0) => {
      if (!genesis) fail('VAULT_NOT_FOUND');
      return {
        genesis: b64(p.encode(genesis)),
        head: { vaultId, revision: state.revision, digest: state.head },
        records: events
          .filter(event => event.body.revision > after)
          .map(event => b64(p.encode(event))),
        next: state.revision,
        more: false,
      };
    },
    createVault: async (record: any) => {
      if (genesis) fail('MIGRATION_CONFLICT');
      if (record.body.vaultId !== vaultId) fail('INVALID_VAULT');
      genesis = record;
      state = await m.verifyGenesis(record, p.fingerprint(record.body));
      vaultMode = 'pending';
      return null;
    },
    activateEmpty: async (record: any) => {
      if (record.body.operation !== 'activate-empty') fail('INVALID');
      accountMode = 'e2ee';
      vaultMode = 'active';
      return { accountMode, vaultMode, vaultId, epoch, head: state.head };
    },
    approve: async (event: any) => {
      const prior = events.find(
        old => old.body.revision === event.body.revision,
      );
      if (prior) return null;
      state = await m.applyMembership(state, event);
      events.push(event);
      return null;
    },
    // Relay pairing: write-once steps, JSON with base64 bytes.
    pairingCreate: async ({ fingerprint, commitment }: any) => {
      session = {
        sessionId: randomBytes(16).toString('hex'),
        vaultId,
        fingerprint,
        commitment,
        expiresAt: Date.now() + 600000,
      };
      return { sessionId: session.sessionId, expiresAt: session.expiresAt };
    },
    pairingSession: async () => {
      if (!session) fail('PAIRING_NOT_FOUND');
      const { sessionId, fingerprint, expiresAt } = session;
      return {
        sessionId,
        vaultId,
        fingerprint,
        expiresAt,
        commitment: b64(session.commitment),
        request: b64(session.request),
        nonceN: b64(session.nonceN),
        nonceE: b64(session.nonceE),
        transfer: b64(session.transfer),
      };
    },
    pairingRequest: async ({ sessionId, request, nonce }: any) => {
      needSession(sessionId);
      if (session.request) fail('PAIRING_CONFLICT');
      Object.assign(session, { request, nonceN: nonce });
      return null;
    },
    pairingReveal: async ({ sessionId, nonce }: any) => {
      needSession(sessionId);
      if (!session.request || session.nonceE) fail('PAIRING_CONFLICT');
      session.nonceE = nonce;
      return null;
    },
    pairingTransfer: async ({ sessionId, transfer }: any) => {
      needSession(sessionId);
      if (!session.nonceE || session.transfer) fail('PAIRING_CONFLICT');
      session.transfer = transfer;
      return null;
    },
    pairingCancel: async ({ sessionId }: any) => {
      if (session?.sessionId === sessionId) session = null;
      return null;
    },
    // Sync.
    push: async (record: any) => {
      const raw = p.encode(record);
      const previous = accepted.find(
        change =>
          p.decode(Buffer.from(change.record, 'base64')).body.mutationId ===
          record.body.mutationId,
      );
      if (previous) return previous.result;
      const body = record.body;
      if (
        body.epoch !== epoch ||
        body.membershipRevision !== state.revision ||
        body.keyGeneration !== state.keyGeneration
      ) {
        fail('SYNC_CHECKPOINT_CONFLICT');
      }
      const counter = BigInt(body.counter);
      if (counter <= (counters.get(body.deviceId) ?? 0n))
        fail('SYNC_CHECKPOINT_CONFLICT');
      for (const op of body.operations) {
        const object = objects.get(op.objectId);
        if ((object?.version ?? '0') !== op.baseVersion || object?.deleted)
          fail('OBJECT_CONFLICT');
      }
      const seq = String(accepted.length + 1);
      const versions: Record<string, string> = {};
      body.operations.forEach((op: any, index: number) => {
        const version = String(BigInt(op.baseVersion) + 1n);
        versions[op.objectId] = version;
        objects.set(op.objectId, {
          version,
          seq,
          deleted: op.deleted,
          operationIndex: index,
          raw,
        });
      });
      counters.set(body.deviceId, counter);
      const result = { seq, versions };
      accepted.push({ record: raw.toString('base64'), result });
      listeners.forEach(listener => listener());
      return result;
    },
    pull: async (proof: any) => {
      const { after, until } = proof.body.parameters;
      const target = until === '0' ? String(accepted.length) : until;
      return {
        until: target,
        next: target,
        more: false,
        changes: accepted.slice(Number(after), Number(target)),
      };
    },
    snapshot: async () => {
      const list = [...objects.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
      const hash = createHash('sha256');
      for (const [objectId, o] of list) {
        hash.update(
          p.encode([
            objectId,
            o.version,
            o.seq,
            o.deleted,
            o.operationIndex,
            createHash('sha256').update(o.raw).digest(),
          ]),
        );
      }
      const id = '00000000-0000-0000-0000-' + randomBytes(6).toString('hex');
      snapshots.set(id, list);
      return {
        id,
        epoch,
        seq: String(accepted.length),
        membershipHead: state.head,
        count: list.length,
        digest: hash.digest('hex'),
      };
    },
    snapshotPage: async (proof: any) => {
      const { snapshotId, after } = proof.body.parameters;
      const list = snapshots.get(snapshotId) ?? fail('NOT_FOUND');
      const page = list
        .filter(([objectId]: any) => objectId > after)
        .slice(0, 32);
      const rest =
        list.filter(([objectId]: any) => objectId > after).length > page.length;
      return {
        objects: page.map(([objectId, o]: any) => ({
          objectId,
          version: o.version,
          seq: o.seq,
          deleted: o.deleted,
          operationIndex: o.operationIndex,
          record: o.raw.toString('base64'),
        })),
        next: page.length ? page[page.length - 1][0] : after,
        more: rest,
      };
    },
  };

  return {
    transport,
    onPush: (listener: () => void) => listeners.push(listener),
    get session() {
      return session;
    },
    get accepted() {
      return accepted;
    },
    get modes() {
      return { accountMode, vaultMode };
    },
  };
}
