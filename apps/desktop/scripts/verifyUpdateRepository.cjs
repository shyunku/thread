// Read-only publication preflight. Never uploads artifacts or reads private keys.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { Readable } = require('node:stream');
const tufRequire = createRequire(require.resolve('tuf-js'));
const { TrustedMetadataStore } = tufRequire('./store');
const { verifyRootBytes } = require('./updateTrustRoot.cjs');

function check(ok, code) { if (!ok) throw Error(code); }
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

async function verifyUpdateRepository(repository, appRootFile) {
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
  }
  const ready = JSON.parse(readRegular(path.join(repository, 'READY'), 1024));
  check(ready.schema === 1 && ready.releases === catalog.releases.length &&
    ready.version === store.targets.signed.version, 'REPOSITORY_NOT_READY');
  return { rootSha256: root.sha256, metadataVersion: ready.version, releases: ready.releases };
}

if (require.main === module) {
  (async () => {
    if (process.argv.length !== 4) throw Error('USAGE_VERIFY_REPOSITORY_AND_APP_ROOT');
    const repository = path.resolve(process.argv[2]);
    const appRootFile = path.resolve(process.argv[3]);
    console.log(JSON.stringify(await verifyUpdateRepository(repository, appRootFile)));
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { verifyUpdateRepository };
