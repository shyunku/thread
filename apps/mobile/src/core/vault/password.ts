import { Buffer } from 'buffer';

const { encode, decode } = require('@thread/e2ee/src/protocol');
const { sodium, randomBytes } = require('@thread/e2ee/src/platform');

// Same envelope and Argon2id cost as the desktop
// (apps/desktop/public/electron/e2ee/passwordProtection.js), checked against a
// desktop-made envelope in packages/e2ee/test/fixtures.json.
// The native KDF call blocks the JS thread for about a second.
const KDF = Object.freeze({
  algorithm: 'argon2id13',
  operations: 3,
  memory: 67108864,
});

export type KeyContext = {
  environment: string;
  accountId: string;
  purpose: string;
};

function passwordBytes(password: string, creating = false): Buffer {
  if (
    typeof password !== 'string' ||
    (creating && Array.from(password).length < 12) ||
    !password.length ||
    Buffer.byteLength(password, 'utf8') > 1024
  ) {
    throw Error('INVALID_VAULT_PASSWORD');
  }
  return Buffer.from(password, 'utf8'); // Exact UTF-8, no trimming or normalization.
}

async function derive(password: Buffer, salt: Buffer): Promise<Buffer> {
  await sodium.ready;
  try {
    return Buffer.from(
      sodium.crypto_pwhash(
        32,
        password,
        salt,
        KDF.operations,
        KDF.memory,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      ),
    );
  } catch {
    throw Error('PASSWORD_KDF_FAILED');
  }
}

function associated(context: KeyContext) {
  return encode(['thread-local-password-v1', KDF, context]);
}

export async function protect(
  key: Buffer,
  password: string,
  context: KeyContext,
): Promise<Buffer> {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('INVALID_LDK');
  const secret = passwordBytes(password, true);
  const salt = randomBytes(16);
  const nonce = randomBytes(24);
  let derived: Buffer | undefined;
  try {
    derived = await derive(secret, salt);
    const ciphertext = Buffer.from(
      sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        key,
        associated(context),
        null,
        nonce,
        derived,
      ),
    );
    return encode({ version: 1, kdf: KDF, salt, nonce, ciphertext });
  } finally {
    secret.fill(0);
    derived?.fill(0);
  }
}

export async function unprotect(
  encoded: Buffer,
  password: string,
  context: KeyContext,
): Promise<Buffer> {
  if (!Buffer.isBuffer(encoded) || encoded.length > 4096)
    throw Error('INVALID_PASSWORD_ENVELOPE');
  const envelope = decode(encoded);
  if (
    envelope.version !== 1 ||
    !encode(envelope.kdf).equals(encode(KDF)) ||
    !Buffer.isBuffer(envelope.salt) ||
    envelope.salt.length !== 16 ||
    !Buffer.isBuffer(envelope.nonce) ||
    envelope.nonce.length !== 24 ||
    !Buffer.isBuffer(envelope.ciphertext) ||
    envelope.ciphertext.length !== 48
  ) {
    throw Error('INVALID_PASSWORD_ENVELOPE'); // Never honor attacker-selected KDF costs.
  }
  const secret = passwordBytes(password);
  let derived: Buffer | undefined;
  try {
    derived = await derive(secret, envelope.salt);
    try {
      return Buffer.from(
        sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
          null,
          envelope.ciphertext,
          associated(context),
          envelope.nonce,
          derived,
        ),
      );
    } catch {
      throw Error('INVALID_PASSWORD_OR_DAMAGED_KEY');
    }
  } finally {
    secret.fill(0);
    derived?.fill(0);
  }
}
