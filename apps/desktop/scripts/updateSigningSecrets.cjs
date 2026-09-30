const crypto = require('node:crypto');
const fs = require('node:fs');

const ROLES = ['root', 'targets', 'snapshot', 'timestamp'];
const RELEASE_ROLES = ['targets', 'snapshot', 'timestamp'];
const MIN_PASSPHRASE_BYTES = 12;
const GENERATED_PASSPHRASE_LENGTH = 18;
const PASSPHRASE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function promptSecret(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function')
    throw Error('INTERACTIVE_TTY_REQUIRED');
  process.stdout.write(`${label}: `);
  return new Promise((resolve, reject) => {
    const bytes = [];
    const finish = (error) => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(Buffer.from(bytes));
      bytes.fill(0);
    };
    const onData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 3) return finish(Error('INPUT_CANCELLED'));
        if (byte === 13 || byte === 10) return finish();
        if (byte === 8 || byte === 127) bytes.pop();
        else if (byte >= 32 && bytes.length < 1024) bytes.push(byte);
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

async function newPassphrase(role) {
  const first = await promptSecret(`${role} key passphrase (${MIN_PASSPHRASE_BYTES}+ bytes)`);
  try {
    if (first.length < MIN_PASSPHRASE_BYTES) throw Error('WEAK_KEY_PASSPHRASE');
    const confirm = await promptSecret(`${role} key passphrase again`);
    try {
      if (first.length !== confirm.length || !crypto.timingSafeEqual(first, confirm))
        throw Error('KEY_PASSPHRASE_MISMATCH');
      return Buffer.from(first);
    } finally { confirm.fill(0); }
  } finally { first.fill(0); }
}

function loadEncryptedKey(file, passphrase) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > 16384)
    throw Error('INVALID_PRIVATE_KEY_FILE');
  const bytes = fs.readFileSync(file);
  try {
    if (!bytes.subarray(0, 40).toString('ascii').includes('ENCRYPTED PRIVATE KEY'))
      throw Error('ENCRYPTED_PRIVATE_KEY_REQUIRED');
    const key = crypto.createPrivateKey({ key: bytes, format: 'pem', passphrase });
    if (key.asymmetricKeyType !== 'ed25519') throw Error('ED25519_KEY_REQUIRED');
    return key;
  } finally { bytes.fill(0); }
}

// Unbiased random alphanumeric passphrase; easy to paste, ~5.95 bits per character.
function generatePassphrase(length = GENERATED_PASSPHRASE_LENGTH) {
  if (!Number.isSafeInteger(length) || length < MIN_PASSPHRASE_BYTES || length > 256)
    throw Error('INVALID_PASSPHRASE_LENGTH');
  let value = '';
  for (let i = 0; i < length; i++) value += PASSPHRASE_ALPHABET[crypto.randomInt(PASSPHRASE_ALPHABET.length)];
  return Buffer.from(value, 'ascii');
}

// Release-key passphrases are stored beside their keys by decision; the root passphrase never is.
function writeReleasePassphrases(file, passphrases) {
  const content = { schema: 1 };
  for (const role of RELEASE_ROLES) {
    if (!Buffer.isBuffer(passphrases[role]) || passphrases[role].length < MIN_PASSPHRASE_BYTES)
      throw Error('WEAK_KEY_PASSPHRASE');
    content[role] = passphrases[role].toString('utf8');
  }
  fs.writeFileSync(file, JSON.stringify(content, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

function loadReleasePassphrases(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > 16384) throw Error('INVALID_PASSPHRASE_FILE');
  const content = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (content?.schema !== 1) throw Error('INVALID_PASSPHRASE_FILE');
  const passphrases = {};
  for (const role of RELEASE_ROLES) {
    if (typeof content[role] !== 'string' || Buffer.byteLength(content[role]) < MIN_PASSPHRASE_BYTES)
      throw Error('INVALID_PASSPHRASE_FILE');
    passphrases[role] = Buffer.from(content[role], 'utf8');
  }
  return passphrases;
}

module.exports = { ROLES, RELEASE_ROLES, MIN_PASSPHRASE_BYTES, promptSecret, newPassphrase, loadEncryptedKey,
  generatePassphrase, writeReleasePassphrases, loadReleasePassphrases };
