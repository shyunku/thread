// Offline trust ceremonies (initial root, renewal and key rotation). Never run with operational keys in CI or on RMS.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const tufRequire = createRequire(require.resolve('tuf-js'));
const models = tufRequire('@tufjs/models');
const { TrustedMetadataStore } = tufRequire('./store');
const { ROLES, RELEASE_ROLES, MIN_PASSPHRASE_BYTES, promptSecret, newPassphrase, loadEncryptedKey,
  generatePassphrase, writeReleasePassphrases, loadReleasePassphrases } = require('./updateSigningSecrets.cjs');

const PASSPHRASE_FILE = 'release-passphrases.json';
const keyFile = role => `${role}.pem`;

function check(ok, code) { if (!ok) throw Error(code); }

// Intermediate roots in a published chain may be expired; the latest one must not be.
function verifyRootBytes(bytes, { allowExpired = false } = {}) {
  check(bytes.length > 0 && bytes.length <= 1024 * 1024, 'INVALID_ROOT_SIZE');
  const raw = JSON.parse(bytes.toString('utf8'));
  check(raw?.signed?._type === 'root' && Number.isSafeInteger(raw.signed.version) &&
    raw.signed.version > 0, 'INVALID_ROOT_METADATA');
  check(raw.signed.consistent_snapshot === false &&
    (allowExpired || Date.parse(raw.signed.expires) > Date.now()), 'INVALID_ROOT_POLICY');
  const ids = [];
  for (const role of ROLES) {
    const assigned = raw.signed.roles?.[role];
    check(assigned?.threshold === 1 && assigned.keyids?.length === 1, 'INVALID_ROOT_ROLE');
    const id = assigned.keyids[0], key = raw.signed.keys?.[id];
    check(key?.keytype === 'ed25519' && key.scheme === 'ed25519' &&
      /^[0-9a-f]{64}$/.test(key.keyval?.public), 'INVALID_ROOT_KEY');
    ids.push(id);
  }
  check(new Set(ids).size === ROLES.length, 'ROOT_ROLE_KEYS_MUST_DIFFER');
  const root = models.Metadata.fromJSON('root', raw);
  root.verifyDelegate('root', root);
  return { version: raw.signed.version, expires: raw.signed.expires,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function checkRootExpiry(expires) {
  check(typeof expires === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(expires) &&
    Number.isFinite(Date.parse(expires)) && Date.parse(expires) > Date.now(), 'INVALID_ROOT_EXPIRY');
}

function publicKeyOf(privateKey) {
  check(privateKey?.type === 'private' && privateKey.asymmetricKeyType === 'ed25519',
    'ED25519_KEY_REQUIRED');
  return crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
}

function rolePublicKey(rootBytes, role) {
  const signed = JSON.parse(rootBytes).signed;
  return Buffer.from(signed.keys[signed.roles[role].keyids[0]].keyval.public, 'hex');
}

// publicKeys: role -> 32-byte Ed25519 public key. signingKeys: private keys that sign this root.
// A renewed root is signed by the previous root key and, when rotated, also by the new one.
function signRootBytes(publicKeys, expires, { version = 1, signingKeys }) {
  checkRootExpiry(expires);
  const root = new models.Root({ version, specVersion: '1.0.31', expires, consistentSnapshot: false });
  const ids = [];
  for (const role of ROLES) {
    const publicKey = publicKeys[role];
    check(Buffer.isBuffer(publicKey) && publicKey.length === 32, 'ED25519_KEY_REQUIRED');
    const id = crypto.createHash('sha256').update(publicKey).digest('hex');
    ids.push(id);
    root.addKey(new models.Key({ keyID: id, keyType: 'ed25519', scheme: 'ed25519',
      keyVal: { public: publicKey.toString('hex') } }), role);
  }
  check(new Set(ids).size === ROLES.length, 'ROOT_ROLE_KEYS_MUST_DIFFER');
  const metadata = new models.Metadata(root);
  for (const key of signingKeys) {
    const id = crypto.createHash('sha256').update(publicKeyOf(key)).digest('hex');
    metadata.sign(data => new models.Signature({ keyID: id,
      sig: crypto.sign(null, data, key).toString('hex') }), true);
  }
  const bytes = Buffer.from(JSON.stringify(metadata.toJSON()));
  verifyRootBytes(bytes);
  return bytes;
}

function createRootBytes(keys, expires) {
  const publicKeys = {};
  for (const role of ROLES) publicKeys[role] = publicKeyOf(keys[role]);
  return signRootBytes(publicKeys, expires, { signingKeys: [keys.root] });
}

function checkOutputLocation(output) {
  check(path.isAbsolute(output) && !fs.existsSync(output), 'OUTPUT_MUST_BE_NEW_ABSOLUTE_DIRECTORY');
  const parent = fs.realpathSync(path.dirname(output));
  check(fs.statSync(parent).isDirectory(), 'OUTPUT_PARENT_MISSING');
  const project = fs.realpathSync(path.resolve(__dirname, '../../..'));
  const relative = path.relative(project, path.join(parent, path.basename(output)));
  check(path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep),
    'PRIVATE_KEYS_MUST_BE_OUTSIDE_PROJECT');
}

function newEncryptedKey(passphrase) {
  check(Buffer.isBuffer(passphrase) && passphrase.length >= MIN_PASSPHRASE_BYTES, 'WEAK_KEY_PASSPHRASE');
  const key = crypto.generateKeyPairSync('ed25519').privateKey;
  return { key, pem: key.export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase }) };
}

// files: role -> encrypted PEM bytes. A partial ceremony is left for inspection; never overwritten on retry.
function writeTrustDirectory(output, rootBytes, files, releasePassphrases) {
  fs.mkdirSync(output, { mode: 0o700 });
  for (const role of ROLES)
    fs.writeFileSync(path.join(output, keyFile(role)), files[role], { flag: 'wx', mode: 0o600 });
  writeReleasePassphrases(path.join(output, PASSPHRASE_FILE), releasePassphrases);
  fs.writeFileSync(path.join(output, 'root.json'), rootBytes, { flag: 'wx', mode: 0o600 });
}

function writeInitialTrust(output, expires, passphrases) {
  checkOutputLocation(output);
  const keys = {}, files = {};
  for (const role of ROLES) ({ key: keys[role], pem: files[role] } = newEncryptedKey(passphrases[role]));
  const rootBytes = createRootBytes(keys, expires);
  writeTrustDirectory(output, rootBytes, files, passphrases);
  return verifyRootBytes(rootBytes);
}

// Signs root version N+1 with the current root key. The current root may already be expired:
// installed clients follow the signed chain regardless, and resume once the new root is published.
function renewTrust({ source, output, expires, rootPassphrase, newRootPassphrase, rotateReleaseKeys = false }) {
  checkOutputLocation(output);
  const currentBytes = fs.readFileSync(path.join(source, 'root.json'));
  const current = verifyRootBytes(currentBytes, { allowExpired: true });
  const rootKey = loadEncryptedKey(path.join(source, keyFile('root')), rootPassphrase);
  check(publicKeyOf(rootKey).equals(rolePublicKey(currentBytes, 'root')), 'ROOT_KEY_MISMATCH');
  const publicKeys = {}, files = {}, signingKeys = [rootKey];
  if (newRootPassphrase) {
    const next = newEncryptedKey(newRootPassphrase);
    publicKeys.root = publicKeyOf(next.key);
    files.root = next.pem;
    signingKeys.push(next.key);
  } else {
    publicKeys.root = rolePublicKey(currentBytes, 'root');
    files.root = fs.readFileSync(path.join(source, keyFile('root')));
  }
  let releasePassphrases;
  if (rotateReleaseKeys) {
    releasePassphrases = {};
    for (const role of RELEASE_ROLES) {
      releasePassphrases[role] = generatePassphrase();
      const next = newEncryptedKey(releasePassphrases[role]);
      publicKeys[role] = publicKeyOf(next.key);
      files[role] = next.pem;
    }
  } else {
    releasePassphrases = loadReleasePassphrases(path.join(source, PASSPHRASE_FILE));
    for (const role of RELEASE_ROLES) {
      files[role] = fs.readFileSync(path.join(source, keyFile(role)));
      check(publicKeyOf(loadEncryptedKey(path.join(source, keyFile(role)), releasePassphrases[role]))
        .equals(rolePublicKey(currentBytes, role)), 'RELEASE_KEY_MISMATCH');
      publicKeys[role] = rolePublicKey(currentBytes, role);
    }
  }
  const rootBytes = signRootBytes(publicKeys, expires, { version: current.version + 1, signingKeys });
  // Same check the installed client performs when it downloads N+1.root.json.
  new TrustedMetadataStore(currentBytes).updateRoot(rootBytes);
  writeTrustDirectory(output, rootBytes, files, releasePassphrases);
  return { previousVersion: current.version, ...verifyRootBytes(rootBytes),
    rotatedRootKey: Boolean(newRootPassphrase), rotatedReleaseKeys: rotateReleaseKeys };
}

function assertPackagedTrust(projectDir) {
  const source = path.join(projectDir, 'public/resources/update-trust/root.json');
  const bundled = path.join(projectDir, 'build/resources/update-trust/root.json');
  check(fs.existsSync(source) && fs.existsSync(bundled), 'UPDATE_TRUST_NOT_CONFIGURED');
  const sourceBytes = fs.readFileSync(source), bundledBytes = fs.readFileSync(bundled);
  check(sourceBytes.equals(bundledBytes), 'PACKAGED_ROOT_MISMATCH');
  return verifyRootBytes(bundledBytes);
}

// Default ceremony location: outside the repository, one new directory per run.
function defaultTrustOutput(now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  const stamp = `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return path.join(os.homedir(), '.thread-trust', `trust-${stamp}`);
}

function defaultRootExpiry(now = new Date()) {
  const expires = new Date(now);
  expires.setUTCFullYear(expires.getUTCFullYear() + 5);
  return expires.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function wipe(passphrases) {
  for (const value of Object.values(passphrases)) if (Buffer.isBuffer(value)) value.fill(0);
}

function printNextSteps(output) {
  console.error([
    '',
    `Created ${output}`,
    '- root.json is public: copy it to apps/desktop/public/resources/update-trust/root.json.',
    `- ${PASSPHRASE_FILE} holds the release-key passphrases. The root passphrase is not stored.`,
    '- Back up this directory offline and keep the root passphrase in a password manager.',
    '- Exclude ~/.thread-trust from cloud sync.',
  ].join('\n'));
}

async function runInitialTrust(output, expires) {
  // Validate before asking for the passphrase.
  checkRootExpiry(expires);
  checkOutputLocation(output);
  const passphrases = {};
  try {
    passphrases.root = await newPassphrase('root');
    for (const role of RELEASE_ROLES) passphrases[role] = generatePassphrase();
    console.log(JSON.stringify({ output, ...writeInitialTrust(output, expires, passphrases) }));
    printNextSteps(output);
  } finally { wipe(passphrases); }
}

async function runRenewTrust(source, expires, { rotateRootKey, rotateReleaseKeys }) {
  checkRootExpiry(expires);
  const output = defaultTrustOutput();
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  checkOutputLocation(output);
  const secrets = {};
  try {
    secrets.rootPassphrase = await promptSecret('current root key passphrase');
    if (rotateRootKey) secrets.newRootPassphrase = await newPassphrase('new root');
    console.log(JSON.stringify({ output, ...renewTrust({ source, output, expires, rotateReleaseKeys,
      ...secrets }) }));
    printNextSteps(output);
  } finally { wipe(secrets); }
}

const USAGE = [
  'Usage:',
  '  create [<UTC-ISO-expiry>]                          new directory under ~/.thread-trust (default expiry: 5 years)',
  '  renew <current-trust-directory> [<UTC-ISO-expiry>] [--rotate-release-keys] [--rotate-root-key]',
  '                                                     sign root version N+1 into a new directory',
  '  init <new-absolute-directory> <UTC-ISO-expiry>     e.g. init D:\\thread-trust 2031-09-30T00:00:00Z',
  '  verify <root.json>',
].join('\n');

if (require.main === module) {
  (async () => {
    const all = process.argv.slice(2).filter(arg => arg !== '--');
    const flags = new Set(all.filter(arg => arg.startsWith('--')));
    const args = all.filter(arg => !arg.startsWith('--'));
    const [command, first, second] = args;
    const known = ['--rotate-release-keys', '--rotate-root-key'];
    check([...flags].every(flag => command === 'renew' && known.includes(flag)), 'UNKNOWN_OPTION');
    if (command === 'verify' && args.length === 2) {
      console.log(JSON.stringify(verifyRootBytes(fs.readFileSync(path.resolve(first)))));
    } else if (command === 'init' && args.length === 3) {
      await runInitialTrust(first, second);
    } else if (command === 'create' && args.length <= 2) {
      const output = defaultTrustOutput();
      fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
      await runInitialTrust(output, first ?? defaultRootExpiry());
    } else if (command === 'renew' && (args.length === 2 || args.length === 3)) {
      await runRenewTrust(path.resolve(first), second ?? defaultRootExpiry(), {
        rotateRootKey: flags.has('--rotate-root-key'),
        rotateReleaseKeys: flags.has('--rotate-release-keys') });
    } else {
      console.error(USAGE);
      throw Error(`USAGE_CREATE_RENEW_INIT_OR_VERIFY: got ${args.length} argument(s)`);
    }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { verifyRootBytes, createRootBytes, writeInitialTrust, renewTrust, assertPackagedTrust,
  defaultTrustOutput, defaultRootExpiry, PASSPHRASE_FILE };
