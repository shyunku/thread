import { Buffer } from 'buffer';
import { EncryptedStore, StoreScope, validScope } from './store';
import { protect, unprotect, KeyContext } from './password';
import type { OpenDatabase } from './sqlite';

const { encode } = require('@thread/e2ee/src/protocol');
const { createHash, randomBytes } = require('@thread/e2ee/src/platform');

// Key storage on the device (react-native-keychain on Android Keystore).
//  - auth: needs biometrics or the device PIN on every read.
//  - session: no prompt, tagged with the boot it was written in. It lets the vault
//    reopen after the app process restarts and is ignored after a reboot, so the
//    user authenticates once per boot or after locking manually (user decision).
export interface VaultKeychain {
  setAuthKey(service: string, keyHex: string): Promise<void>;
  getAuthKey(service: string): Promise<string | null>; // null = cancelled or failed
  setSessionKey(service: string, bootId: string, keyHex: string): Promise<void>;
  getSessionKey(
    service: string,
  ): Promise<{ bootId: string; keyHex: string } | null>;
  remove(service: string): Promise<void>;
}

export type VaultDeps = {
  openDatabase: OpenDatabase;
  keychain: VaultKeychain;
  bootId: () => string;
};

export type VaultInspection = {
  phase: 'ABSENT' | 'LOCKED' | 'RECOVERY_REQUIRED';
  passwordAvailable: boolean;
};

const INDEX_DB = 'thread-vaults.db';

function keyFromHex(hex: string | null | undefined): Buffer {
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex))
    throw Error('INVALID_LDK');
  return Buffer.from(hex, 'hex');
}

export class LocalVault {
  readonly id: string;
  #scope: StoreScope;
  #deps: VaultDeps;

  constructor(scope: StoreScope, deps: VaultDeps) {
    if (!validScope(scope)) throw Error('INVALID_STORE_SCOPE');
    this.#scope = Object.freeze({
      environment: scope.environment,
      accountId: scope.accountId,
      vaultId: scope.vaultId,
    });
    this.#deps = deps;
    this.id = createHash('sha256').update(encode(this.#scope)).digest('hex');
  }

  get #authService() {
    return `thread.vault.${this.id}.auth`;
  }
  get #sessionService() {
    return `thread.vault.${this.id}.session`;
  }
  get #dbName() {
    return `vault-${this.id}.db`;
  }
  #keyContext(): KeyContext {
    return {
      environment: this.#scope.environment,
      accountId: this.#scope.accountId,
      purpose: 'ldk:' + this.#scope.vaultId,
    };
  }

  #index<T>(operation: (db: ReturnType<OpenDatabase>) => T): T {
    const db = this.#deps.openDatabase({ name: INDEX_DB });
    try {
      db.executeSync(
        'CREATE TABLE IF NOT EXISTS vaults(id TEXT PRIMARY KEY,ready INTEGER NOT NULL,password BLOB)',
      );
      return operation(db);
    } finally {
      db.close();
    }
  }

  #row(): { ready: boolean; password: Buffer | null } | null {
    return this.#index(db => {
      const row = db.executeSync(
        'SELECT ready,password FROM vaults WHERE id=?',
        [this.id],
      ).rows[0];
      if (!row) return null;
      const password =
        row.password == null
          ? null
          : Buffer.from(
              new Uint8Array(row.password as ArrayBuffer | Uint8Array),
            );
      return { ready: row.ready === 1, password };
    });
  }

  inspect(): VaultInspection {
    const row = this.#row();
    if (!row) return { phase: 'ABSENT', passwordAvailable: false };
    // A vault whose creation did not finish is never reset automatically.
    if (!row.ready)
      return { phase: 'RECOVERY_REQUIRED', passwordAvailable: false };
    return { phase: 'LOCKED', passwordAvailable: row.password != null };
  }

  #openStore(key: Buffer, create = false): EncryptedStore {
    const db = this.#deps.openDatabase({ name: this.#dbName, key });
    return new EncryptedStore({ db, scope: this.#scope, create });
  }

  async #rememberSession(key: Buffer) {
    await this.#deps.keychain.setSessionKey(
      this.#sessionService,
      this.#deps.bootId(),
      key.toString('hex'),
    );
  }

  async create({
    password,
  }: { password?: string } = {}): Promise<EncryptedStore> {
    if (this.#row()) throw Error('VAULT_EXISTS'); // Never overwrite an existing vault.
    const key = randomBytes(32);
    try {
      const envelope = password
        ? await protect(key, password, this.#keyContext())
        : null;
      this.#index(db =>
        db.executeSync('INSERT INTO vaults(id,ready,password) VALUES(?,0,?)', [
          this.id,
          envelope,
        ]),
      );
      await this.#deps.keychain.setAuthKey(
        this.#authService,
        key.toString('hex'),
      );
      const store = this.#openStore(key, true);
      // Readiness is committed last; a missing marker needs explicit recovery.
      this.#index(db =>
        db.executeSync('UPDATE vaults SET ready=1 WHERE id=?', [this.id]),
      );
      await this.#rememberSession(key);
      return store;
    } finally {
      key.fill(0);
    }
  }

  // Reopen without a prompt if this boot was already unlocked; otherwise null.
  async resume(): Promise<EncryptedStore | null> {
    if (this.inspect().phase !== 'LOCKED') return null;
    const session = await this.#deps.keychain.getSessionKey(
      this.#sessionService,
    );
    if (!session) return null;
    if (session.bootId !== this.#deps.bootId()) {
      await this.#deps.keychain.remove(this.#sessionService);
      return null;
    }
    const key = keyFromHex(session.keyHex);
    try {
      return this.#openStore(key);
    } finally {
      key.fill(0);
    }
  }

  async unlock(): Promise<EncryptedStore> {
    if (this.inspect().phase !== 'LOCKED')
      throw Error('VAULT_RECOVERY_REQUIRED');
    const hex = await this.#deps.keychain.getAuthKey(this.#authService);
    if (hex == null) throw Error('AUTH_FAILED_OR_CANCELLED');
    const key = keyFromHex(hex);
    try {
      const store = this.#openStore(key);
      await this.#rememberSession(key);
      return store;
    } finally {
      key.fill(0);
    }
  }

  async unlockWithPassword(password: string): Promise<EncryptedStore> {
    const row = this.#row();
    if (!row?.ready) throw Error('VAULT_RECOVERY_REQUIRED');
    if (!row.password) throw Error('PASSWORD_NOT_SET');
    const key = await unprotect(row.password, password, this.#keyContext());
    try {
      const store = this.#openStore(key);
      await this.#rememberSession(key);
      return store;
    } finally {
      key.fill(0);
    }
  }

  // Manual lock: the next open needs biometrics, the device PIN or the password.
  async forgetSession() {
    await this.#deps.keychain.remove(this.#sessionService);
  }
}
