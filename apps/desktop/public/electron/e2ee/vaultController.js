// Main-process coordinator. No keys or database handles cross the renderer bridge.
const { VaultSession } = require("./localStore");
function createVaultController({ vault, osAuth, getWindow, clearRenderer, powerMonitor }) {
  let disposed = false;
  const session = new VaultSession({
    reauthenticate: request => request.method === "os" ? osAuth.verify(getWindow()) : true,
    openStore: request => request.method === "os" ? vault.open() : vault.openWithPassword(request.password),
    clearRenderer,
  });
  const stop = powerMonitor ? session.watch(powerMonitor) : () => session.lock();
  return Object.freeze({
    async unlock(method, password) {
      if (disposed) throw Error("VAULT_SESSION_CLOSED");
      if (method !== "os" && method !== "password") throw Error("INVALID_UNLOCK_METHOD");
      if (method === "password" && (typeof password !== "string" || !password.length ||
          Buffer.byteLength(password, "utf8") > 1024)) throw Error("INVALID_VAULT_PASSWORD");
      const request = { method, password: method === "password" ? password : undefined };
      password = undefined;
      try { await session.unlock(request); return true; }
      finally { request.password = undefined; }
    },
    use(operation) {
      if (disposed) throw Error("VAULT_SESSION_CLOSED");
      return session.use(operation);
    },
    lock() { session.lock(); },
    dispose() { if (!disposed) { disposed = true; stop(); } },
  });
}
module.exports = { createVaultController };
