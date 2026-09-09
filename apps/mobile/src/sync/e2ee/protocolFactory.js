const {Buffer} = require('buffer');
const SUITE = 'thread-e2ee-v1', MAX_BYTES = 1024 * 1024;
function check(ok, code) { if (!ok) throw Error(code); }
function bytes(value, length) { check(Buffer.isBuffer(value) && value.length === length, 'INVALID_KEY_OR_NONCE'); }
function validate(value, depth = 0) {
  check(depth <= 24, 'ENCODING_DEPTH');
  if (value === null || typeof value === 'boolean' || Buffer.isBuffer(value)) return;
  if (typeof value === 'string') { check(value.length <= MAX_BYTES, 'ENCODING_SIZE'); return; }
  if (typeof value === 'number') { check(Number.isSafeInteger(value), 'ENCODING_INTEGER'); return; }
  if (Array.isArray(value)) { check(value.length <= 65536, 'ENCODING_SIZE'); value.forEach(v => validate(v, depth + 1)); return; }
  check(value && Object.getPrototypeOf(value) === Object.prototype, 'ENCODING_TYPE');
  check(Object.keys(value).length <= 65536, 'ENCODING_SIZE');
  for (const [key, child] of Object.entries(value)) {
    check(!['__proto__', 'prototype', 'constructor'].includes(key), 'ENCODING_KEY');
    validate(child, depth + 1);
  }
}

// Native libsodium in the app; injected independently in Node golden-vector tests.
// No custom cryptographic primitive and no plaintext/native-unavailable fallback.
function createProtocol({sodium, cbor, hkdf, sha256}) {
  function encode(value) {
    validate(value);
    const result = Buffer.from(cbor.encode(value));
    check(result.length <= MAX_BYTES, 'ENCODING_SIZE'); return result;
  }
  function normalize(value) {
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (Array.isArray(value)) return value.map(normalize);
    if (value instanceof Map) {
      const object = {};
      for (const [key, child] of value) {
        check(typeof key === 'string' && !['__proto__', 'prototype', 'constructor'].includes(key), 'ENCODING_KEY');
        object[key] = normalize(child);
      }
      return object;
    }
    return value;
  }
  function decode(raw) {
    check(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= MAX_BYTES, 'ENCODING_SIZE');
    const options = {strict:true,allowIndefinite:false,allowUndefined:false,allowBigInt:false,rejectDuplicateMapKeys:true,useMaps:true};
    // Bound nesting before the library recursively constructs objects.
    const tokens = new cbor.Tokenizer(raw, options), remaining = [1];
    while (!tokens.done()) {
      while (remaining.length && remaining[remaining.length - 1] === 0) remaining.pop();
      check(remaining.length > 0 && remaining.length <= 25, 'ENCODING_DEPTH');
      remaining[remaining.length - 1]--;
      const token = tokens.next();
      check(token.type !== cbor.Type.tag, 'ENCODING_TYPE');
      if (token.type === cbor.Type.array || token.type === cbor.Type.map) {
        check(Number.isSafeInteger(token.value) && token.value <= 65536, 'ENCODING_SIZE');
        remaining.push(token.value * (token.type === cbor.Type.map ? 2 : 1));
      }
    }
    const value = normalize(cbor.decode(raw, options));
    check(encode(value).equals(raw), 'NON_CANONICAL_ENCODING'); return value;
  }
  function derive(secret, purpose, context) {
    bytes(secret,32); check(typeof purpose==='string' && purpose.length>0 && purpose.length<64,'INVALID_PURPOSE');
    return Buffer.from(hkdf(sha256,secret,Buffer.from(SUITE),encode([purpose,context]),32));
  }
  function aad(context) {
    const fields=['vaultId','vaultEpoch','objectId','fieldSlot','keyGeneration','mutationId','deviceId'];
    check(context && Object.keys(context).length===fields.length,'INVALID_AAD');
    for (const field of fields) {
      check(['fieldSlot','keyGeneration'].includes(field)
        ? Number.isSafeInteger(context[field]) && context[field]>=0
        : typeof context[field]==='string' && context[field].length>0 && context[field].length<=128,'INVALID_AAD');
    }
    return encode([SUITE,context]);
  }
  async function encrypt(secret, context, value) {
    await sodium.ready;
    const associated=aad(context), key=derive(secret,'field',context), plain=encode(value);
    try {
      const nonce=Buffer.from(sodium.randombytes_buf(24));
      return {nonce,ciphertext:Buffer.from(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plain,associated,null,nonce,key))};
    } finally { key.fill(0);plain.fill(0); }
  }
  async function decrypt(secret, context, envelope) {
    await sodium.ready;bytes(envelope.nonce,24);
    check(Buffer.isBuffer(envelope.ciphertext) && envelope.ciphertext.length>=16 && envelope.ciphertext.length<=MAX_BYTES+16,'INVALID_CIPHERTEXT');
    const associated=aad(context),key=derive(secret,'field',context);let plain;
    try { plain=Buffer.from(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null,envelope.ciphertext,associated,envelope.nonce,key));return decode(plain); }
    finally { key.fill(0);plain?.fill(0); }
  }
  async function sign(key,purpose,body) {
    await sodium.ready;bytes(key,64);
    return Buffer.from(sodium.crypto_sign_detached(encode([SUITE,purpose,body]),key));
  }
  async function verify(key,purpose,body,signature) {
    await sodium.ready;bytes(key,32);bytes(signature,64);
    check(sodium.crypto_sign_verify_detached(signature,encode([SUITE,purpose,body]),key),'INVALID_SIGNATURE');return body;
  }
  async function createDevice() {
    await sodium.ready;const signing=sodium.crypto_sign_keypair(),encryption=sodium.crypto_box_keypair();
    return {signing:{publicKey:Buffer.from(signing.publicKey),privateKey:Buffer.from(signing.privateKey)},
      encryption:{publicKey:Buffer.from(encryption.publicKey),privateKey:Buffer.from(encryption.privateKey)}};
  }
  async function seal(recipient,sender,request,keyring) {
    await sodium.ready;bytes(recipient,32);const plain=encode(keyring);
    try { const body={request,recipient,ciphertext:Buffer.from(sodium.crypto_box_seal(plain,recipient))};
      return {body,signature:await sign(sender,'pairing-response',body)};
    } finally { plain.fill(0); }
  }
  async function unseal(recipient,sender,response,request,now=Date.now()) {
    await verify(sender,'pairing-response',response.body,response.signature);
    check(encode(request).equals(encode(response.body.request)),'PAIRING_REQUEST_MISMATCH');
    check(Number.isSafeInteger(request.expiresAt)&&request.expiresAt>now&&request.expiresAt<=now+600000,'PAIRING_EXPIRED');
    bytes(recipient.publicKey,32);bytes(recipient.privateKey,32);
    check(Buffer.isBuffer(response.body.recipient)&&response.body.recipient.equals(recipient.publicKey),'PAIRING_RECIPIENT_MISMATCH');
    const plain=Buffer.from(sodium.crypto_box_seal_open(response.body.ciphertext,recipient.publicKey,recipient.privateKey));
    try { return decode(plain); } finally { plain.fill(0); }
  }
  function fingerprint(value) { return Buffer.from(sha256(encode([SUITE,'genesis',value]))).toString('hex'); }
  return {SUITE,MAX_BYTES,encode,decode,derive,encrypt,decrypt,sign,verify,createDevice,seal,unseal,fingerprint};
}
module.exports={createProtocol};
