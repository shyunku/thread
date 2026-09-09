// Main-process only. VaultSession must authenticate before open.
// Never migrate, regenerate a missing key, reset, or delete an existing vault.
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const { encode } = require("./protocol");
const { EncryptedStore } = require("./localStore");
function normalizeScope(scope) {
  if (!scope || !["development", "production"].includes(scope.environment) ||
      !["accountId", "vaultId"].every(name => typeof scope[name] === "string" &&
        scope[name].trim().length > 0 && scope[name].length <= 256))
    throw Error("INVALID_STORE_SCOPE");
  return Object.freeze({ environment: scope.environment, accountId: scope.accountId, vaultId: scope.vaultId });
}
function durableWrite(filename, bytes) {
  const fd = fs.openSync(filename, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
function requireFile(filename, limit) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > limit)
    throw Error("INVALID_VAULT_FILE");
}
class LocalVault {
  #protector;
  #scope;
  #directory;
  constructor({ baseDirectory, scope, protector }) {
    this.#scope = normalizeScope(scope);
    if (typeof baseDirectory !== "string" || !path.isAbsolute(baseDirectory)) throw Error("INVALID_VAULT_DIRECTORY");
    this.#directory = path.join(baseDirectory, createHash("sha256").update(encode(this.#scope)).digest("hex"));
    this.#protector = protector;
  }
  #keyContext() {
    return { environment: this.#scope.environment, accountId: this.#scope.accountId,
      purpose: "ldk:" + this.#scope.vaultId };
  }
  #initialize(key, passwordEnvelope) {
    let store;
    try {
      const wrapped = this.#protector.protect(key, this.#keyContext());
      if (!Buffer.isBuffer(wrapped) || !wrapped.length || wrapped.length > 16384) throw Error("INVALID_KEY_ENVELOPE");
      fs.mkdirSync(path.dirname(this.#directory), { recursive: true, mode: 0o700 });
      fs.mkdirSync(this.#directory, { mode: 0o700 }); // EEXIST: preserve originals.
      durableWrite(path.join(this.#directory, "ldk.protected"), wrapped);
      if (passwordEnvelope) durableWrite(path.join(this.#directory, "ldk.password"), passwordEnvelope);
      store = new EncryptedStore({ filename: path.join(this.#directory, "vault.db"),
        key, scope: this.#scope, create: true });
      store.close(); store = null;
      // Readiness is committed last. Missing marker requires explicit recovery.
      durableWrite(path.join(this.#directory, "ready"), Buffer.from("thread-local-vault-v1"));
    } finally { try { store?.close(); } finally { key.fill(0); } }
  }
  create() { this.#initialize(randomBytes(32)); }
  inspect() {
    if (!fs.existsSync(this.#directory)) return {phase:"ABSENT",passwordAvailable:false};
    try {
      const dir=fs.lstatSync(this.#directory);
      if(!dir.isDirectory()||dir.isSymbolicLink())throw Error("INVALID_VAULT_DIRECTORY");
      requireFile(path.join(this.#directory,"ready"),64);
      requireFile(path.join(this.#directory,"ldk.protected"),16384);
      requireFile(path.join(this.#directory,"vault.db"),Number.MAX_SAFE_INTEGER);
      if(fs.readFileSync(path.join(this.#directory,"ready"),"utf8")!=="thread-local-vault-v1")throw Error("VAULT_INCOMPLETE");
      return {phase:"LOCKED",passwordAvailable:fs.existsSync(path.join(this.#directory,"ldk.password"))};
    } catch { return {phase:"RECOVERY_REQUIRED",passwordAvailable:false}; }
  }
  async createWithPassword(password) {
    const key = randomBytes(32);
    try {
      const envelope = await require("./passwordProtection").protect(key, password, this.#keyContext());
      this.#initialize(key, envelope);
    } finally { key.fill(0); }
  }
  async openWithPassword(password) {
    let key;
    try {
      const directory = fs.lstatSync(this.#directory);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error("INVALID_VAULT_DIRECTORY");
      const ready = path.join(this.#directory, "ready");
      requireFile(ready, 64);
      if (fs.readFileSync(ready, "utf8") !== "thread-local-vault-v1") throw Error("VAULT_INCOMPLETE");
      const passwordFile = path.join(this.#directory, "ldk.password");
      requireFile(passwordFile, 4096);
      requireFile(path.join(this.#directory, "vault.db"), Number.MAX_SAFE_INTEGER);
      key = await require("./passwordProtection").unprotect(fs.readFileSync(passwordFile), password, this.#keyContext());
      return new EncryptedStore({ filename: path.join(this.#directory, "vault.db"), key, scope: this.#scope });
    } catch (error) {
      if (error.code === "ENOENT") throw Error("VAULT_RECOVERY_REQUIRED");
      throw error;
    } finally { key?.fill(0); }
  }
  open() {
    let key;
    try {
      const directory = fs.lstatSync(this.#directory);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error("INVALID_VAULT_DIRECTORY");
      const ready = path.join(this.#directory, "ready");
      requireFile(ready, 64);
      if (fs.readFileSync(ready, "utf8") !== "thread-local-vault-v1") throw Error("VAULT_INCOMPLETE");
      const keyFile = path.join(this.#directory, "ldk.protected");
      requireFile(keyFile, 16384);
      requireFile(path.join(this.#directory, "vault.db"), Number.MAX_SAFE_INTEGER);
      key = this.#protector.unprotect(fs.readFileSync(keyFile), this.#keyContext());
      return new EncryptedStore({ filename: path.join(this.#directory, "vault.db"), key, scope: this.#scope });
    } catch (error) {
      if (error.code === "ENOENT") throw Error("VAULT_RECOVERY_REQUIRED");
      throw error;
    } finally { key?.fill(0); }
  }
}
module.exports = { LocalVault };
