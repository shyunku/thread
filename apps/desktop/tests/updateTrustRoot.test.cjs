const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROLES, loadEncryptedKey } = require('../scripts/updateSigningSecrets.cjs');
const { createRootBytes, verifyRootBytes, writeInitialTrust, assertPackagedTrust } =
  require('../scripts/updateTrustRoot.cjs');

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
  for (const role of ROLES) {
    const file = path.join(output, `${role}.key.pem`);
    const encrypted = fs.readFileSync(file, 'utf8');
    assert.match(encrypted, /BEGIN ENCRYPTED PRIVATE KEY/);
    assert.equal(loadEncryptedKey(file, f.passphrases[role]).asymmetricKeyType, 'ed25519');
    assert.throws(() => loadEncryptedKey(file, Buffer.from('wrong-passphrase')));
  }
  assert.throws(() => writeInitialTrust(output, f.expires, f.passphrases), /OUTPUT_MUST_BE_NEW/);
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

test('create defaults to a timestamped directory outside the project and a 3-year expiry', () => {
  const { defaultTrustOutput, defaultRootExpiry } = require('../scripts/updateTrustRoot.cjs');
  const now = new Date(2026, 8, 30, 15, 7);
  assert.equal(defaultTrustOutput(now), path.join(os.homedir(), '.thread-trust', 'trust-260930-1507'));
  assert.equal(defaultRootExpiry(new Date('2026-09-30T06:07:08.123Z')), '2029-09-30T06:07:08Z');
});
