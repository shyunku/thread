const { Worker } = require("node:worker_threads");
const path = require("node:path");
const sodium = require("libsodium-wrappers");
const { encode, decode } = require("./protocol");
const KDF = Object.freeze({ algorithm: "argon2id13", operations: 3, memory: 67108864 });
let working = false;
function passwordBytes(password, creating = false) {
  if (typeof password !== "string" || (creating && Array.from(password).length < 12) ||
      !password.length || Buffer.byteLength(password, "utf8") > 1024) throw Error("INVALID_VAULT_PASSWORD");
  return Buffer.from(password, "utf8"); // Exact UTF-8, no trimming or normalization.
}
function derive(password, salt) {
  if (working) return Promise.reject(Error("PASSWORD_KDF_BUSY"));
  working = true;
  return new Promise((resolve, reject) => {
    let worker, timeout, settled = false;
    const finish = (error, key) => {
      if (settled) { key?.fill(0); return; }
      settled = true; clearTimeout(timeout);
      Promise.resolve(worker?.terminate()).catch(() => {}).then(() => {
        working = false;
        if (error) reject(error); else resolve(key);
      });
    };
    try {
      worker = new Worker(path.join(__dirname, "passwordKdf.worker.js"), { workerData: { password, salt } });
      timeout = setTimeout(() => finish(Error("PASSWORD_KDF_TIMEOUT")), 30000);
      worker.once("message", data => {
        if (data.error || !data.key || data.key.length !== 32) finish(Error("PASSWORD_KDF_FAILED"));
        else finish(null, Buffer.from(data.key));
      });
      worker.once("error", () => finish(Error("PASSWORD_KDF_FAILED")));
      worker.once("exit", () => { if (!settled) finish(Error("PASSWORD_KDF_FAILED")); });
    } catch { finish(Error("PASSWORD_KDF_FAILED")); }
    finally { password.fill(0); }
  });
}
function associated(context) { return encode(["thread-local-password-v1", KDF, context]); }
async function protect(key, password, context) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error("INVALID_LDK");
  const bytes = passwordBytes(password, true);
  await sodium.ready;
  const salt = Buffer.from(sodium.randombytes_buf(16)), nonce = Buffer.from(sodium.randombytes_buf(24));
  let derived;
  try {
    derived = await derive(bytes, salt);
    return encode({ version: 1, kdf: KDF, salt, nonce,
      ciphertext: Buffer.from(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(key, associated(context), null, nonce, derived)) });
  } finally { bytes.fill(0); derived?.fill(0); }
}
async function unprotect(encoded, password, context) {
  if (!Buffer.isBuffer(encoded) || encoded.length > 4096) throw Error("INVALID_PASSWORD_ENVELOPE");
  const envelope = decode(encoded);
  if (envelope.version !== 1 || !encode(envelope.kdf).equals(encode(KDF)) ||
      !Buffer.isBuffer(envelope.salt) || envelope.salt.length !== 16 ||
      !Buffer.isBuffer(envelope.nonce) || envelope.nonce.length !== 24 ||
      !Buffer.isBuffer(envelope.ciphertext) || envelope.ciphertext.length !== 48)
    throw Error("INVALID_PASSWORD_ENVELOPE"); // Never honor attacker-selected KDF costs.
  let derived;
  const bytes = passwordBytes(password);
  try {
    derived = await derive(bytes, envelope.salt);
    await sodium.ready;
    try {
      return Buffer.from(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, envelope.ciphertext, associated(context), envelope.nonce, derived));
    } catch { throw Error("INVALID_PASSWORD_OR_DAMAGED_KEY"); }
  } finally { bytes.fill(0); derived?.fill(0); }
}
module.exports = { protect, unprotect };
