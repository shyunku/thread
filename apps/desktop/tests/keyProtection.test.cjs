const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createKeyProtection } = require("../public/electron/modules/keyProtection");
const scope = { environment: "development", accountId: "fixture-a", purpose: "ldk" };
function fixture(options = {}) {
  let calls = 0;
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: value => { calls++; return Buffer.from(value); },
    decryptString: value => { calls++; return value.toString(); },
    ...options.storage,
  };
  return {
    protector: createKeyProtection({
      app: { isReady: () => options.ready !== false },
      platform: options.platform || "win32", safeStorage,
    }),
    calls: () => calls,
  };
}
test("32-byte key envelope round trip and input preservation (mock OS only)", () => {
  const { protector } = fixture();
  const key = Buffer.alloc(32, 7);
  assert.deepEqual(protector.unprotect(protector.protect(key, scope), scope), key);
  assert.equal(key[0], 7);
});
test("dev/prod, account and purpose cannot be interchanged", () => {
  const { protector } = fixture();
  const envelope = protector.protect(Buffer.alloc(32), scope);
  for (const changed of [
    { environment: "production" }, { accountId: "fixture-b" }, { purpose: "device-signing" },
  ]) assert.throws(() => protector.unprotect(envelope, { ...scope, ...changed }), /KEY_CONTEXT_MISMATCH/);
});
test("unready, unavailable and insecure backends fail closed before cryptography", () => {
  for (const options of [
    { ready: false }, { platform: "unsupported" },
    { storage: { isEncryptionAvailable: () => false } },
    ...["basic_text", "unknown", "new-unverified-backend"].map(backend => ({
      platform: "linux", storage: { getSelectedStorageBackend: () => backend },
    })),
  ]) {
    const f = fixture(options);
    assert.throws(() => f.protector.protect(Buffer.alloc(32), scope), /KEYSTORE_/);
    assert.throws(() => f.protector.unprotect(Buffer.from("fixture"), scope), /KEYSTORE_/);
    assert.equal(f.calls(), 0);
  }
});
test("known OS backends supported; invalid material and context rejected", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const { protector } = fixture({ platform });
    assert.ok(protector.protect(Buffer.alloc(32), scope));
    assert.throws(() => protector.protect(Buffer.alloc(31), scope), /KEY_MATERIAL_INVALID/);
    assert.throws(() => protector.protect(Buffer.alloc(32), { ...scope, accountId: "" }), /KEY_CONTEXT_INVALID/);
    assert.throws(() => protector.unprotect(Buffer.from("not-json"), scope), /KEY_UNWRAP_FAILED/);
  }
});
