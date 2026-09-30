// Read-only publication preflight. Never uploads artifacts or reads private keys.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const tufRequire = createRequire(require.resolve('tuf-js'));
const { TrustedMetadataStore } = tufRequire('./store');
const { verifyRootBytes } = require('./updateTrustRoot.cjs');

function check(ok, code) { if (!ok) throw Error(code); }

// Windows OS signature is separate from TUF. Requires an embedded, timestamped signature
// by the expected certificate; catalog-signed or unsigned installers are rejected.
function inspectAuthenticode(file) {
  check(process.platform === 'win32', 'AUTHENTICODE_REQUIRES_WINDOWS');
  const script = '$s=Get-AuthenticodeSignature -LiteralPath $env:THREAD_AUTHENTICODE_FILE;' +
    '[pscustomobject]@{status=[string]$s.Status;type=[string]$s.SignatureType;' +
    'thumbprint=[string]$s.SignerCertificate.Thumbprint;timestamped=[bool]$s.TimeStamperCertificate}' +
    '|ConvertTo-Json -Compress';
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...process.env, THREAD_AUTHENTICODE_FILE: path.resolve(file) }, windowsHide: true,
      timeout: 60000, encoding: 'utf8' });
  return JSON.parse(output);
}
function verifyAuthenticode(file, thumbprint) {
  check(/^[0-9A-F]{40}$/.test(thumbprint), 'INVALID_AUTHENTICODE_THUMBPRINT');
  const info = inspectAuthenticode(file);
  check(info.status === 'Valid' && info.type === 'Authenticode', 'AUTHENTICODE_NOT_VALID');
  check(info.thumbprint.toUpperCase() === thumbprint, 'AUTHENTICODE_SIGNER_MISMATCH');
  check(info.timestamped === true, 'AUTHENTICODE_NOT_TIMESTAMPED');
  return info;
}
function readRegular(file, limit) {
  const stat = fs.lstatSync(file);
  check(stat.isFile() && stat.size > 0 && stat.size <= limit, 'INVALID_PUBLIC_ARTIFACT');
  return fs.readFileSync(file);
}
function safeTarget(root, name) {
  check(typeof name === 'string' && !name.includes('\\') && !name.startsWith('/') &&
    name.split('/').every(part => part && part !== '.' && part !== '..'), 'INVALID_TARGET_PATH');
  const target = path.resolve(root, 'targets', ...name.split('/'));
  check(target.startsWith(path.resolve(root, 'targets') + path.sep), 'INVALID_TARGET_PATH');
  const targetRoot = fs.realpathSync(path.resolve(root, 'targets'));
  check(fs.realpathSync(target).startsWith(targetRoot + path.sep), 'INVALID_TARGET_PATH');
  return target;
}

async function verifyUpdateRepository(repository, appRootFile, { authenticode } = {}) {
  const rootBytes = readRegular(path.join(repository, 'metadata/root.json'), 1024 * 1024);
  const root = verifyRootBytes(rootBytes);
  check(rootBytes.equals(readRegular(appRootFile, 1024 * 1024)), 'APP_ROOT_MISMATCH');
  check(rootBytes.equals(readRegular(path.join(repository, `metadata/${root.version}.root.json`),
    1024 * 1024)), 'VERSIONED_ROOT_MISMATCH');
  const store = new TrustedMetadataStore(rootBytes);
  const timestamp = readRegular(path.join(repository, 'metadata/timestamp.json'), 1024 * 1024);
  const snapshot = readRegular(path.join(repository, 'metadata/snapshot.json'), 1024 * 1024);
  const targets = readRegular(path.join(repository, 'metadata/targets.json'), 1024 * 1024);
  store.updateTimestamp(timestamp);
  store.updateSnapshot(snapshot);
  store.updateDelegatedTargets(targets, 'targets', 'root');
  const entries = store.targets.signed.targets;
  check(entries['releases.json'], 'RELEASE_CATALOG_MISSING');
  const catalogBytes = readRegular(safeTarget(repository, 'releases.json'), 128 * 1024);
  await entries['releases.json'].verify(Readable.from([catalogBytes]));
  const catalog = JSON.parse(catalogBytes);
  check(catalog?.schema === 1 && Array.isArray(catalog.releases) &&
    catalog.releases.length > 0 && catalog.releases.length <= 512, 'INVALID_RELEASE_CATALOG');
  const expected = new Set(['releases.json']);
  for (const row of catalog.releases) {
    check(row && ['win', 'mac'].includes(row.platform) &&
      ['ia32', 'x64', 'arm64', 'universal'].includes(row.arch) &&
      /^[0-9A-Za-z.+-]+$/.test(row.version), 'INVALID_RELEASE_CATALOG');
    const name = `${row.platform}/${row.arch}/${row.version}/${row.platform === 'win' ? 'installer.exe' : 'installer.dmg'}`;
    const info = entries[name];
    check(info?.custom?.thread?.schema === 1 && info.custom.thread.platform === row.platform &&
      info.custom.thread.arch === row.arch && info.custom.thread.version === row.version &&
      typeof info.custom.thread.mandatory === 'boolean' && !expected.has(name),
      'INVALID_RELEASE_TARGET');
    expected.add(name);
  }
  check(Object.keys(entries).length === expected.size &&
    Object.keys(entries).every(name => expected.has(name)), 'UNLISTED_TARGET');
  for (const name of expected) {
    const file = safeTarget(repository, name);
    const stat = fs.lstatSync(file);
    check(stat.isFile() && stat.size > 0 && stat.size <= 2 * 1024 ** 3,
      'INVALID_PUBLIC_ARTIFACT');
    await entries[name].verify(fs.createReadStream(file));
    if (authenticode && name.endsWith('/installer.exe')) verifyAuthenticode(file, authenticode);
  }
  const ready = JSON.parse(readRegular(path.join(repository, 'READY'), 1024));
  check(ready.schema === 1 && ready.releases === catalog.releases.length &&
    ready.version === store.targets.signed.version, 'REPOSITORY_NOT_READY');
  const windows = catalog.releases.filter(row => row.platform === 'win').length;
  return { rootSha256: root.sha256, metadataVersion: ready.version, releases: ready.releases,
    windowsReleases: windows, authenticodeVerified: authenticode ? windows : 0 };
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const valid = args.length === 2 || (args.length === 4 && args[2] === '--authenticode');
    if (!valid) throw Error('USAGE_VERIFY_REPOSITORY_AND_APP_ROOT_[--authenticode_THUMBPRINT]');
    const repository = path.resolve(args[0]);
    const appRootFile = path.resolve(args[1]);
    const authenticode = args[3]?.toUpperCase();
    const result = await verifyUpdateRepository(repository, appRootFile, { authenticode });
    // Publication CLI never accepts an OS-unsigned Windows installer.
    check(result.authenticodeVerified === result.windowsReleases, 'AUTHENTICODE_THUMBPRINT_REQUIRED');
    console.log(JSON.stringify(result));
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { verifyUpdateRepository, inspectAuthenticode, verifyAuthenticode };
