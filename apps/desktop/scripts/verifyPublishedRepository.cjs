// Read-only post-publication check: served /tuf/ bytes must equal a locally preflighted repository.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function check(ok, code) { if (!ok) throw Error(code); }
function publicFiles(repository) {
  const files = [];
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(repository, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      check(entry.isDirectory() || entry.isFile(), 'INVALID_PUBLIC_ARTIFACT');
      if (entry.isDirectory()) walk(name);
      else files.push(name);
    }
  };
  walk('metadata');
  walk('targets');
  return files.sort();
}
function baseUrl(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  check(url.protocol === 'https:' || (url.protocol === 'http:' && local), 'HTTPS_REQUIRED');
  check(!url.search && !url.hash && !url.username && !url.password, 'INVALID_REPOSITORY_URL');
  return url.href.endsWith('/') ? url.href : `${url.href}/`;
}
async function servedDigest(url, limit) {
  const response = await fetch(url, { redirect: 'error', cache: 'no-store' });
  check(response.ok, `SERVED_FILE_MISSING:${response.status}`);
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    check(size <= limit, 'SERVED_FILE_SIZE_MISMATCH');
    hash.update(chunk);
  }
  return { size, sha256: hash.digest('hex') };
}
function localDigest(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let size = 0;
    fs.createReadStream(file).on('data', chunk => { size += chunk.length; hash.update(chunk); })
      .on('error', reject).on('end', () => resolve({ size, sha256: hash.digest('hex') }));
  });
}

async function verifyPublishedRepository(url, repository) {
  const base = baseUrl(url);
  check(fs.existsSync(path.join(repository, 'READY')), 'REPOSITORY_NOT_READY');
  const files = publicFiles(repository);
  check(files.includes('metadata/root.json') && files.includes('targets/releases.json'),
    'INVALID_PUBLIC_REPOSITORY');
  for (const name of files) {
    const expected = await localDigest(path.join(repository, ...name.split('/')));
    const served = await servedDigest(new URL(name.split('/').map(encodeURIComponent).join('/'), base),
      expected.size);
    check(served.size === expected.size && served.sha256 === expected.sha256,
      `SERVED_FILE_MISMATCH:${name}`);
  }
  return { url: base, files: files.length };
}

if (require.main === module) {
  (async () => {
    if (process.argv.length !== 4) throw Error('USAGE_VERIFY_PUBLISHED_URL_AND_REPOSITORY');
    console.log(JSON.stringify(await verifyPublishedRepository(process.argv[2],
      path.resolve(process.argv[3]))));
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { verifyPublishedRepository };
