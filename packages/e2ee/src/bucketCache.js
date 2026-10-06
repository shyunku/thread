// Decoded rows of one store bucket, kept per open store and refreshed by id from the
// store's write log, so repeated full reads of a large bucket (the outbox while pushing
// many queued edits, the visible objects behind every task list) decode only what
// changed (#98). Stores without a write log (revision/changedSince) are read in full
// every time. Callers must treat the returned rows as read-only.
const caches = new WeakMap();

function readAll(store, bucket, limit) {
  const rows = new Map();
  let after = "";
  for (let n = 0; n < limit; n++) {
    const page = store.entries(bucket, after, 256);
    for (const row of page) rows.set(row.id, row);
    if (page.length < 256) return rows;
    after = page[page.length - 1].id;
  }
  throw Error("BUCKET_PAGE_LIMIT");
}

// [{id, value}] in id order.
function bucketRows(store, bucket, { pages = 4000 } = {}) {
  if (typeof store.revision !== "function" || typeof store.changedSince !== "function") {
    return [...readAll(store, bucket, pages).values()];
  }
  let perStore = caches.get(store);
  if (!perStore) caches.set(store, (perStore = new Map()));
  const revision = store.revision(bucket);
  let cache = perStore.get(bucket);
  if (cache && cache.revision !== revision) {
    const ids = store.changedSince(bucket, cache.revision);
    if (!ids) cache = null;
    else {
      for (const id of ids) {
        const value = store.get(bucket, id);
        if (value === null || value === undefined) cache.rows.delete(id);
        else cache.rows.set(id, { id, value });
      }
      cache.revision = revision;
      cache.ordered = null;
    }
  }
  if (!cache) {
    cache = { revision, rows: readAll(store, bucket, pages), ordered: null };
    perStore.set(bucket, cache);
  }
  if (!cache.ordered) cache.ordered = [...cache.rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return cache.ordered;
}

// Drops a store's decoded rows (plaintext) when it closes, e.g. on lock.
function forgetBucketRows(store) {
  caches.delete(store);
}

module.exports = { bucketRows, forgetBucketRows };
