// React Native implementation of the shared E2EE platform (packages/e2ee/src/platform.js).
// It must reproduce the desktop byte for byte; packages/e2ee/test/conformance.js checks that.
import { Buffer } from 'buffer';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import * as cbor from 'cborg';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { sha1 } from '@noble/hashes/legacy.js';
import * as sodium from 'react-native-libsodium';

const shared = require('@thread/e2ee/src/platform');

const MAX_DEPTH = 24;
const MAX_ITEMS = 65536;
const FORBIDDEN_KEYS = ['__proto__', 'prototype', 'constructor'];
const DECODE_OPTIONS = {
  strict: true,
  allowIndefinite: false,
  allowUndefined: false,
  allowBigInt: false,
  rejectDuplicateMapKeys: true,
  useMaps: true,
};

function fail(code: string): never {
  throw Error(code);
}

// cborg returns Uint8Array and Map; the protocol works with Buffer and plain objects.
function normalize(value: unknown): unknown {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value instanceof Map) {
    const object: Record<string, unknown> = {};
    for (const [key, child] of value) {
      if (typeof key !== 'string' || FORBIDDEN_KEYS.includes(key))
        fail('ENCODING_KEY');
      object[key] = normalize(child);
    }
    return object;
  }
  return value;
}

function decode(bytes: Uint8Array): unknown {
  // Bound nesting and sizes before the library builds objects recursively.
  const tokens = new cbor.Tokenizer(bytes, DECODE_OPTIONS);
  const remaining = [1];
  while (!tokens.done()) {
    while (remaining.length && remaining[remaining.length - 1] === 0)
      remaining.pop();
    if (!remaining.length) fail('ENCODING_TRAILING');
    if (remaining.length > MAX_DEPTH + 1) fail('ENCODING_DEPTH');
    remaining[remaining.length - 1]--;
    const token = tokens.next();
    if (token.type === cbor.Type.tag) fail('ENCODING_TYPE');
    if (token.type === cbor.Type.array || token.type === cbor.Type.map) {
      if (!Number.isSafeInteger(token.value) || token.value > MAX_ITEMS)
        fail('ENCODING_SIZE');
      remaining.push(token.value * (token.type === cbor.Type.map ? 2 : 1));
    }
  }
  return normalize(cbor.decode(bytes, DECODE_OPTIONS));
}

// react-native-libsodium's native AEAD only takes string additional data, but the
// protocol's AAD is binary CBOR. Use the audited pure-JS XChaCha20-Poly1305 (same
// combined ciphertext||tag output as libsodium) and keep native libsodium for the rest.
const aead = {
  crypto_aead_xchacha20poly1305_ietf_encrypt(
    message: Uint8Array,
    additionalData: Uint8Array,
    _secretNonce: null,
    nonce: Uint8Array,
    key: Uint8Array,
  ) {
    return xchacha20poly1305(key, nonce, additionalData).encrypt(message);
  },
  crypto_aead_xchacha20poly1305_ietf_decrypt(
    _secretNonce: null,
    ciphertext: Uint8Array,
    additionalData: Uint8Array,
    nonce: Uint8Array,
    key: Uint8Array,
  ) {
    return xchacha20poly1305(key, nonce, additionalData).decrypt(ciphertext);
  },
};
// Empty target: module namespaces may have non-configurable properties a proxy can't override.
const sodiumWithAead = new Proxy(
  {},
  {
    get: (_, key) =>
      key in aead ? aead[key as keyof typeof aead] : (sodium as any)[key],
  },
);

function createHash(algorithm: string) {
  // sha1 only for name-based UUIDs (recurring occurrence ids), never for security.
  if (algorithm !== 'sha256' && algorithm !== 'sha1') fail('UNSUPPORTED_HASH');
  const state = (algorithm === 'sha1' ? sha1 : sha256).create();
  const hash = {
    update(data: Uint8Array | string) {
      state.update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
      return hash;
    },
    digest(encoding?: 'hex') {
      const out = Buffer.from(state.digest());
      return encoding === 'hex' ? out.toString('hex') : out;
    },
  };
  return hash;
}

export function installE2eePlatform() {
  if (shared.installed()) return shared;
  shared.install({
    sodium: sodiumWithAead,
    cbor: { encode: (value: unknown) => cbor.encode(value), decode },
    hkdf: (
      secret: Uint8Array,
      salt: Uint8Array,
      info: Uint8Array,
      length: number,
    ) => hkdf(sha256, secret, salt, info, length),
    createHash,
    randomBytes: (size: number) => sodium.randombytes_buf(size),
  });
  return shared;
}
