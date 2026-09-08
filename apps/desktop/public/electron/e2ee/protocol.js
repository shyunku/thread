const sodium = require("libsodium-wrappers");
const cbor = require("cbor");
const { hkdfSync, createHash } = require("node:crypto");
const MAX_BYTES = 1024 * 1024;
const SUITE = "thread-e2ee-v1";
function check(value, message) { if (!value) throw Error(message); }
function bytes(value, size) {
  check(Buffer.isBuffer(value) && value.length === size, "INVALID_KEY_OR_NONCE");
}
function validate(value, depth = 0) {
  check(depth <= 24, "ENCODING_DEPTH");
  if (value === null || typeof value === "boolean" || Buffer.isBuffer(value)) return;
  if (typeof value === "string") { check(value.length <= MAX_BYTES, "ENCODING_SIZE"); return; }
  if (typeof value === "number") { check(Number.isSafeInteger(value), "ENCODING_INTEGER"); return; }
  if (Array.isArray(value)) { value.forEach(v => validate(v, depth + 1)); return; }
  check(value && Object.getPrototypeOf(value) === Object.prototype, "ENCODING_TYPE");
  for (const [k, v] of Object.entries(value)) {
    check(!["__proto__", "prototype", "constructor"].includes(k), "ENCODING_KEY");
    validate(v, depth + 1);
  }
}
function encode(value) {
  validate(value);
  const encoded = cbor.encodeCanonical(value);
  check(encoded.length <= MAX_BYTES, "ENCODING_SIZE");
  return encoded;
}
function decode(encoded) {
  check(Buffer.isBuffer(encoded) && encoded.length <= MAX_BYTES, "ENCODING_SIZE");
  // CBOR byte strings may alias the input. Keep decoded keys independent of
  // temporary plaintext buffers which callers wipe after decoding.
  const value = cbor.decodeFirstSync(Buffer.from(encoded), { preventDuplicateKeys: true, max_depth: 24 });
  check(encode(value).equals(encoded), "NON_CANONICAL_ENCODING");
  return value;
}
function derive(secret, purpose, context) {
  bytes(secret, 32);
  check(typeof purpose === "string" && purpose.length > 0 && purpose.length < 64, "INVALID_PURPOSE");
  return Buffer.from(hkdfSync("sha256", secret, Buffer.from(SUITE), encode([purpose, context]), 32));
}
function aad(context) {
  const required = ["vaultId", "vaultEpoch", "objectId", "fieldSlot", "keyGeneration", "mutationId", "deviceId"];
  check(context && Object.keys(context).length === required.length, "INVALID_AAD");
  for (const field of required) {
    if (["fieldSlot", "keyGeneration"].includes(field)) {
      check(Number.isSafeInteger(context[field]) && context[field] >= 0, "INVALID_AAD");
    } else check(typeof context[field] === "string" && context[field].length > 0 && context[field].length <= 128, "INVALID_AAD");
  }
  return encode([SUITE, context]);
}
async function encrypt(secret, context, value) {
  await sodium.ready;
  const associated = aad(context), plaintext = encode(value);
  const key = derive(secret, "field", context);
  const nonce = Buffer.from(sodium.randombytes_buf(24));
  try {
    return { nonce, ciphertext: Buffer.from(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, associated, null, nonce, key)) };
  } finally { key.fill(0); plaintext.fill(0); }
}
async function decrypt(secret, context, envelope) {
  await sodium.ready;
  bytes(envelope.nonce, 24);
  check(Buffer.isBuffer(envelope.ciphertext) && envelope.ciphertext.length >= 16 && envelope.ciphertext.length <= MAX_BYTES + 16, "INVALID_CIPHERTEXT");
  const associated = aad(context), key = derive(secret, "field", context);
  let plaintext;
  try {
    plaintext = Buffer.from(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, envelope.ciphertext, associated, envelope.nonce, key));
    return decode(plaintext);
  } finally { key.fill(0); plaintext?.fill(0); }
}
async function sign(secretKey, purpose, body) {
  await sodium.ready; bytes(secretKey, 64);
  return Buffer.from(sodium.crypto_sign_detached(encode([SUITE, purpose, body]), secretKey));
}
async function verify(publicKey, purpose, body, signature) {
  await sodium.ready; bytes(publicKey, 32); bytes(signature, 64);
  check(sodium.crypto_sign_verify_detached(signature, encode([SUITE, purpose, body]), publicKey), "INVALID_SIGNATURE");
  return body;
}
async function createDevice() {
  await sodium.ready;
  const signing = sodium.crypto_sign_keypair(), encryption = sodium.crypto_box_keypair();
  return { signing: { publicKey: Buffer.from(signing.publicKey), privateKey: Buffer.from(signing.privateKey) },
    encryption: { publicKey: Buffer.from(encryption.publicKey), privateKey: Buffer.from(encryption.privateKey) } };
}
async function seal(recipientPublicKey, senderSecretKey, request, keyring) {
  await sodium.ready; bytes(recipientPublicKey, 32);
  const body = { request, recipient: recipientPublicKey,
    ciphertext: Buffer.from(sodium.crypto_box_seal(encode(keyring), recipientPublicKey)) };
  return { body, signature: await sign(senderSecretKey, "pairing-response", body) };
}
async function unseal(recipient, senderPublicKey, response, expectedRequest, now = Date.now()) {
  await verify(senderPublicKey, "pairing-response", response.body, response.signature);
  check(encode(expectedRequest).equals(encode(response.body.request)), "PAIRING_REQUEST_MISMATCH");
  check(Number.isSafeInteger(expectedRequest.expiresAt) && expectedRequest.expiresAt > now &&
    expectedRequest.expiresAt <= now + 600000, "PAIRING_EXPIRED");
  check(response.body.recipient.equals(recipient.publicKey), "PAIRING_RECIPIENT_MISMATCH");
  const plain = Buffer.from(sodium.crypto_box_seal_open(response.body.ciphertext, recipient.publicKey, recipient.privateKey));
  try { return decode(plain); } finally { plain.fill(0); }
}
function fingerprint(genesis) { return createHash("sha256").update(encode([SUITE, "genesis", genesis])).digest("hex"); }
module.exports = { SUITE, MAX_BYTES, encode, decode, derive, encrypt, decrypt, sign, verify, createDevice, seal, unseal, fingerprint };
