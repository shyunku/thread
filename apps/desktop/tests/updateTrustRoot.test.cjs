const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { ROLES, RELEASE_ROLES, loadEncryptedKey, loadReleasePassphrases, generatePassphrase } =
  require('../scripts/updateSigningSecrets.cjs');
const { createRootBytes, verifyRootBytes, writeInitialTrust, renewTrust, assertPackagedTrust,
  PASSPHRASE_FILE } = require('../scripts/updateTrustRoot.cjs');
const tufRequire = createRequire(require.resolve('tuf-js'));
const models = tufRequire('@tufjs/models');
const { TrustedMetadataStore } = tufRequire('./store');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'thread-trust-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const keys = {}, passphrases = {};
  for (const role of ROLES) {
    keys[role] = crypto.generateKeyPairSync('ed25519').privateKey;
    passphrases[role] = Buffer.from(`synthetic-${role}-passphrase-1234`);
  }
  const expires = new Date(Date.now() + 365 * 86400000).toISOString();
  return { directory, keys, passphrases, expires };
}

test('initial root has distinct authorized roles and rejects tampering', t => {
  const f = fixture(t), bytes = createRootBytes(f.keys, f.expires);
  assert.equal(verifyRootBytes(bytes).version, 1);
  const bad = JSON.parse(bytes);
  bad.signed.expires = new Date(Date.now() + 2 * 365 * 86400000).toISOString();
  assert.throws(() => verifyRootBytes(Buffer.from(JSON.stringify(bad))));
  assert.throws(() => createRootBytes({ ...f.keys, targets: f.keys.root }, f.expires),
    /ROOT_ROLE_KEYS_MUST_DIFFER/);
});

test('initial ceremony only writes encrypted keys outside the project and never overwrites', t => {
  const f = fixture(t), output = path.join(f.directory, 'trust');
  const result = writeInitialTrust(output, f.expires, f.passphrases);
  assert.equal(result.version, 1);
  assert.deepEqual(fs.readdirSync(output).sort(),
    [PASSPHRASE_FILE, 'root.json', 'root.pem', 'snapshot.pem', 'targets.pem', 'timestamp.pem']);
  // Release passphrases are stored by decision; the root passphrase never is.
  const stored = loadReleasePassphrases(path.join(output, PASSPHRASE_FILE));
  for (const role of RELEASE_ROLES) assert.deepEqual(stored[role], f.passphrases[role]);
  assert.ok(!fs.readFileSync(path.join(output, PASSPHRASE_FILE), 'utf8')
    .includes(f.passphrases.root.toString()));
  for (const role of ROLES) {
    const file = path.join(output, `${role}.pem`);
    const encrypted = fs.readFileSync(file, 'utf8');
    assert.match(encrypted, /BEGIN ENCRYPTED PRIVATE KEY/);
    assert.equal(loadEncryptedKey(file, f.passphrases[role]).asymmetricKeyType, 'ed25519');
    assert.throws(() => loadEncryptedKey(file, Buffer.from('wrong-passphrase')));
  }
  assert.throws(() => writeInitialTrust(output, f.expires, f.passphrases), /OUTPUT_MUST_BE_NEW/);
  const short = { ...f.passphrases, snapshot: Buffer.from('11-bytes-xx') };
  assert.throws(() => writeInitialTrust(path.join(f.directory, 'short'), f.expires, short),
    /WEAK_KEY_PASSPHRASE/);
  const minimum = { ...f.passphrases, snapshot: Buffer.from('12-bytes-xxx') };
  assert.equal(writeInitialTrust(path.join(f.directory, 'minimum'), f.expires, minimum).version, 1);
  assert.throws(() => writeInitialTrust(path.join(__dirname, 'unsafe'), f.expires, f.passphrases),
    /PRIVATE_KEYS_MUST_BE_OUTSIDE_PROJECT/);
});

test('packaging requires the same verified root in public and build', t => {
  const f = fixture(t), bytes = createRootBytes(f.keys, f.expires);
  const source = path.join(f.directory, 'public/resources/update-trust/root.json');
  const bundled = path.join(f.directory, 'build/resources/update-trust/root.json');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.dirname(bundled), { recursive: true });
  fs.writeFileSync(source, bytes);
  assert.throws(() => assertPackagedTrust(f.directory), /UPDATE_TRUST_NOT_CONFIGURED/);
  fs.writeFileSync(bundled, bytes);
  assert.equal(assertPackagedTrust(f.directory).version, 1);
  fs.writeFileSync(bundled, Buffer.from('{}'));
  assert.throws(() => assertPackagedTrust(f.directory), /PACKAGED_ROOT_MISMATCH/);
});

test('beforePack hook refuses a rootless package', async t => {
  const f = fixture(t);
  const beforePack = require('../public/electron/modules/buildAuthHelper.js');
  await assert.rejects(beforePack({ electronPlatformName: 'darwin',
    packager: { projectDir: f.directory } }), /UPDATE_TRUST_NOT_CONFIGURED/);
});

test('create defaults to a timestamped directory outside the project and a 5-year expiry', () => {
  const { defaultTrustOutput, defaultRootExpiry } = require('../scripts/updateTrustRoot.cjs');
  const now = new Date(2026, 8, 30, 15, 7);
  assert.equal(defaultTrustOutput(now), path.join(os.homedir(), '.thread-trust', 'trust-260930-1507'));
  assert.equal(defaultRootExpiry(new Date('2026-09-30T06:07:08.123Z')), '2031-09-30T06:07:08Z');
});

test('generated passphrases are 18 random alphanumerics', () => {
  const values = new Set();
  for (let i = 0; i < 64; i++) {
    const value = generatePassphrase().toString('ascii');
    assert.match(value, /^[A-Za-z0-9]{18}$/);
    values.add(value);
  }
  assert.equal(values.size, 64);
  assert.throws(() => generatePassphrase(11), /INVALID_PASSPHRASE_LENGTH/);
});

function initialTrust(t) {
  const f = fixture(t), source = path.join(f.directory, 'trust-1');
  writeInitialTrust(source, f.expires, f.passphrases);
  return { ...f, source, rootBytes: fs.readFileSync(path.join(source, 'root.json')) };
}
const roleKey = (bytes, role) => {
  const signed = JSON.parse(bytes).signed;
  return signed.keys[signed.roles[role].keyids[0]].keyval.public;
};

test('renewal signs root N+1 that clients accept, keeping keys and passphrases', t => {
  const f = initialTrust(t), output = path.join(f.directory, 'trust-2');
  const result = renewTrust({ source: f.source, output, expires: f.expires,
    rootPassphrase: f.passphrases.root });
  assert.equal(result.version, 2);
  const renewed = fs.readFileSync(path.join(output, 'root.json'));
  const store = new TrustedMetadataStore(f.rootBytes);
  store.updateRoot(renewed);
  assert.equal(store.root.signed.version, 2);
  for (const role of ROLES) {
    assert.equal(roleKey(renewed, role), roleKey(f.rootBytes, role));
    assert.deepEqual(fs.readFileSync(path.join(output, `${role}.pem`)),
      fs.readFileSync(path.join(f.source, `${role}.pem`)));
  }
  assert.deepEqual(fs.readFileSync(path.join(output, PASSPHRASE_FILE)),
    fs.readFileSync(path.join(f.source, PASSPHRASE_FILE)));
  assert.throws(() => renewTrust({ source: f.source, output: path.join(f.directory, 'bad'),
    expires: f.expires, rootPassphrase: Buffer.from('wrong-root-passphrase') }));
  assert.equal(fs.existsSync(path.join(f.directory, 'bad')), false);
});

test('renewal can rotate release keys and the root key under the old root authorization', t => {
  const f = initialTrust(t), output = path.join(f.directory, 'trust-2');
  const newRootPassphrase = Buffer.from('synthetic-new-root-passphrase');
  renewTrust({ source: f.source, output, expires: f.expires, rootPassphrase: f.passphrases.root,
    newRootPassphrase, rotateReleaseKeys: true });
  const renewed = fs.readFileSync(path.join(output, 'root.json'));
  for (const role of ROLES) assert.notEqual(roleKey(renewed, role), roleKey(f.rootBytes, role));
  new TrustedMetadataStore(f.rootBytes).updateRoot(renewed);
  const stored = loadReleasePassphrases(path.join(output, PASSPHRASE_FILE));
  for (const role of RELEASE_ROLES) {
    assert.match(stored[role].toString(), /^[A-Za-z0-9]{18}$/);
    const key = loadEncryptedKey(path.join(output, `${role}.pem`), stored[role]);
    assert.equal(crypto.createPublicKey(key).export({ format: 'der', type: 'spki' })
      .subarray(-32).toString('hex'), roleKey(renewed, role));
  }
  assert.equal(loadEncryptedKey(path.join(output, 'root.pem'), newRootPassphrase).asymmetricKeyType,
    'ed25519');
  // The rotated root can renew again with only its own key.
  renewTrust({ source: output, output: path.join(f.directory, 'trust-3'), expires: f.expires,
    rootPassphrase: newRootPassphrase });
});

test('an already expired root can still be renewed with its key', t => {
  const f = fixture(t), source = path.join(f.directory, 'expired');
  const pub = key => crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32);
  const root = new models.Root({ version: 1, specVersion: '1.0.31', consistentSnapshot: false,
    expires: new Date(Date.now() - 86400000).toISOString() });
  for (const role of ROLES) {
    const id = crypto.createHash('sha256').update(pub(f.keys[role])).digest('hex');
    root.addKey(new models.Key({ keyID: id, keyType: 'ed25519', scheme: 'ed25519',
      keyVal: { public: pub(f.keys[role]).toString('hex') } }), role);
  }
  const metadata = new models.Metadata(root);
  metadata.sign(data => new models.Signature({ keyID: root.roles.root.keyIDs[0],
    sig: crypto.sign(null, data, f.keys.root).toString('hex') }));
  const expiredBytes = Buffer.from(JSON.stringify(metadata.toJSON()));
  assert.throws(() => verifyRootBytes(expiredBytes), /INVALID_ROOT_POLICY/);
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'root.json'), expiredBytes);
  const stored = { schema: 1 };
  for (const role of ROLES) {
    fs.writeFileSync(path.join(source, `${role}.pem`), f.keys[role].export({ format: 'pem',
      type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: f.passphrases[role] }));
    if (role !== 'root') stored[role] = f.passphrases[role].toString();
  }
  fs.writeFileSync(path.join(source, PASSPHRASE_FILE), JSON.stringify(stored));
  const output = path.join(f.directory, 'renewed');
  assert.equal(renewTrust({ source, output, expires: f.expires,
    rootPassphrase: f.passphrases.root }).version, 2);
  new TrustedMetadataStore(expiredBytes).updateRoot(fs.readFileSync(path.join(output, 'root.json')));
});
