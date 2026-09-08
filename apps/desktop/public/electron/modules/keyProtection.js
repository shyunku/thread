// Main-process only. No renderer bridge; persistence and vault lifecycle belong to #48.
// OS protection is not user reauthentication and does not encrypt the task database.
function createKeyProtection({ app, safeStorage, platform = process.platform }) {
  function ensureAvailable() {
    if (!app.isReady()) throw new Error("KEYSTORE_NOT_READY");
    if (!["win32", "darwin", "linux"].includes(platform))
      throw new Error("KEYSTORE_UNSUPPORTED");
    if (platform === "linux" && ![
      "gnome_libsecret", "kwallet", "kwallet5", "kwallet6",
    ].includes(safeStorage.getSelectedStorageBackend()))
      throw new Error("KEYSTORE_INSECURE_BACKEND");
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("KEYSTORE_UNAVAILABLE");
  }

  function validateContext(context) {
    if (!context || !["development", "production"].includes(context.environment) ||
        typeof context.accountId !== "string" || !context.accountId.trim() ||
        typeof context.purpose !== "string" || !context.purpose.trim())
      throw new Error("KEY_CONTEXT_INVALID");
    return {
      environment: context.environment,
      accountId: context.accountId,
      purpose: context.purpose,
    };
  }

  return Object.freeze({
    protect(key, context) {
      ensureAvailable();
      const scope = validateContext(context);
      if (!Buffer.isBuffer(key) || key.length !== 32)
        throw new Error("KEY_MATERIAL_INVALID");
      // Context is inside the OS-protected envelope, not mutable file metadata.
      return safeStorage.encryptString(JSON.stringify({
        version: 1, ...scope, key: key.toString("base64"),
      }));
    },
    unprotect(ciphertext, context) {
      ensureAvailable();
      const scope = validateContext(context);
      if (!Buffer.isBuffer(ciphertext) || !ciphertext.length || ciphertext.length > 16384)
        throw new Error("KEY_ENVELOPE_INVALID");
      let envelope;
      try {
        envelope = JSON.parse(safeStorage.decryptString(ciphertext));
      } catch {
        // Do not expose native errors, key material, or serialized envelopes.
        throw new Error("KEY_UNWRAP_FAILED");
      }
      if (!envelope || envelope.version !== 1 ||
          Object.keys(scope).some(name => envelope[name] !== scope[name]))
        throw new Error("KEY_CONTEXT_MISMATCH");
      if (typeof envelope.key !== "string" ||
          !/^[A-Za-z0-9+/]{43}=$/.test(envelope.key))
        throw new Error("KEY_ENVELOPE_INVALID");
      const key = Buffer.from(envelope.key, "base64");
      if (key.length !== 32 || key.toString("base64") !== envelope.key) {
        key.fill(0);
        throw new Error("KEY_ENVELOPE_INVALID");
      }
      return key;
    },
  });
}

module.exports = { createKeyProtection };
