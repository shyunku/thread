const crypto = require('node:crypto');
const fs = require('node:fs');

const ROLES = ['root', 'targets', 'snapshot', 'timestamp'];
const MIN_PASSPHRASE_BYTES = 12;

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

module.exports = { ROLES, MIN_PASSPHRASE_BYTES, promptSecret, newPassphrase, loadEncryptedKey };
