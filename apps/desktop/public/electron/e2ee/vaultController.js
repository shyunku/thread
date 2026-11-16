// Main-process coordinator. No keys or database handles cross the renderer bridge.
const { VaultSession } = require("./localStore");
function createVaultController({ vault, osAuth, getWindow, clearRenderer, powerMonitor }) {
  let disposed = false;
  // The start open (#111): only this object, never a request built from IPC arguments.
  const START = Object.freeze({ method: "start" });
  const session = new VaultSession({
    reauthenticate: request => request === START ? true : request.method === "os" ? osAuth.verify(getWindow()) : true,
    openStore: request => request === START || request.method === "os" ? vault.open() : vault.openWithPassword(request.password),
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
    // Opens with the OS-protected key and no prompt, for the lock-screen skip at start (#111).
    // Main-only: the workspace decides when; vault/unlock reaches unlock(), "os" or "password".
    async openAtStart() {
      if (disposed) throw Error("VAULT_SESSION_CLOSED");
      await session.unlock(START);
      return true;
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
