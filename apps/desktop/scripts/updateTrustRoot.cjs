// Offline initial trust ceremony. Never run with operational keys in CI or on RMS.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const tufRequire = createRequire(require.resolve('tuf-js'));
const models = tufRequire('@tufjs/models');
const { ROLES, newPassphrase } = require('./updateSigningSecrets.cjs');

function check(ok, code) { if (!ok) throw Error(code); }

function verifyRootBytes(bytes) {
  check(bytes.length > 0 && bytes.length <= 1024 * 1024, 'INVALID_ROOT_SIZE');
  const raw = JSON.parse(bytes.toString('utf8'));
  check(raw?.signed?._type === 'root' && Number.isSafeInteger(raw.signed.version) &&
    raw.signed.version > 0, 'INVALID_ROOT_METADATA');
  check(raw.signed.consistent_snapshot === false && Date.parse(raw.signed.expires) > Date.now(),
    'INVALID_ROOT_POLICY');
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

function createRootBytes(keys, expires) {
  checkRootExpiry(expires);
  const root = new models.Root({ version: 1, specVersion: '1.0.31', expires,
    consistentSnapshot: false });
  const ids = [];
  for (const role of ROLES) {
    const privateKey = keys[role];
    check(privateKey?.type === 'private' && privateKey.asymmetricKeyType === 'ed25519',
      'ED25519_KEY_REQUIRED');
    const publicKey = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
    const id = crypto.createHash('sha256').update(publicKey).digest('hex');
    ids.push(id);
    root.addKey(new models.Key({ keyID: id, keyType: 'ed25519', scheme: 'ed25519',
      keyVal: { public: publicKey.toString('hex') } }), role);
  }
  check(new Set(ids).size === ROLES.length, 'ROOT_ROLE_KEYS_MUST_DIFFER');
  const metadata = new models.Metadata(root);
  metadata.sign(data => new models.Signature({ keyID: ids[0],
    sig: crypto.sign(null, data, keys.root).toString('hex') }));
  const bytes = Buffer.from(JSON.stringify(metadata.toJSON()));
  verifyRootBytes(bytes);
  return bytes;
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

function writeInitialTrust(output, expires, passphrases) {
  checkOutputLocation(output);
  const keys = {}, encrypted = {};
  for (const role of ROLES) {
    check(Buffer.isBuffer(passphrases[role]) && passphrases[role].length >= 16,
      'WEAK_KEY_PASSPHRASE');
    keys[role] = crypto.generateKeyPairSync('ed25519').privateKey;
    encrypted[role] = keys[role].export({ format: 'pem', type: 'pkcs8',
      cipher: 'aes-256-cbc', passphrase: passphrases[role] });
  }
  const rootBytes = createRootBytes(keys, expires);
  fs.mkdirSync(output, { mode: 0o700 });
  // A partial ceremony is left in place for inspection; never overwrite it on retry.
  for (const role of ROLES)
    fs.writeFileSync(path.join(output, `${role}.key.pem`), encrypted[role], { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(output, 'root.json'), rootBytes, { flag: 'wx', mode: 0o600 });
  return verifyRootBytes(rootBytes);
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
  expires.setUTCFullYear(expires.getUTCFullYear() + 3);
  return expires.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function runInitialTrust(output, expires) {
  // Validate before asking for eight passphrases.
  checkRootExpiry(expires);
  checkOutputLocation(output);
  const passphrases = {};
  try {
    for (const role of ROLES) passphrases[role] = await newPassphrase(role);
    console.log(JSON.stringify({ output, ...writeInitialTrust(output, expires, passphrases) }));
  } finally { for (const value of Object.values(passphrases)) value.fill(0); }
}

const USAGE = [
  'Usage:',
  '  create [<UTC-ISO-expiry>]                        new directory under ~/.thread-trust (default expiry: 3 years)',
  '  init <new-absolute-directory> <UTC-ISO-expiry>   e.g. init D:\\thread-trust 2029-09-30T00:00:00Z',
  '  verify <root.json>',
].join('\n');

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2).filter(arg => arg !== '--');
    const [command, first, second] = args;
    if (command === 'verify' && args.length === 2) {
      console.log(JSON.stringify(verifyRootBytes(fs.readFileSync(path.resolve(first)))));
    } else if (command === 'init' && args.length === 3) {
      await runInitialTrust(first, second);
    } else if (command === 'create' && args.length <= 2) {
      const output = defaultTrustOutput();
      fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
      await runInitialTrust(output, first ?? defaultRootExpiry());
    } else {
      console.error(USAGE);
      throw Error(`USAGE_CREATE_INIT_OR_VERIFY: got ${args.length} argument(s)`);
    }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { verifyRootBytes, createRootBytes, writeInitialTrust, assertPackagedTrust,
  defaultTrustOutput, defaultRootExpiry };
