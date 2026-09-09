# E2EE migration activation

Updated: 2026-09-09 15:57 (KST).

Extends [prepare](e2ee-migration-prepare.md). Both E2EE feature flags remain
false by default. This contract does not authorize production execution.
Schema 10 appends a verification table without altering prior migration files.

## Wire compatibility

Signed mutations retain the original nine body fields. Schema 1 remains
unchanged: deleted objects have no fields. Schema 2 additionally permits
encrypted retained fields on a tombstone. This preserves deleted canonical
records during migration without exposing their contents or resurrecting them.
Unknown schemas remain rejected.

Desktop and Mobile use the same syncProtocolCore verifier, with their respective
crypto adapters. Old schema-1-only clients cannot consume schema 2; E2EE has not
been enabled for ordinary users and all E2EE peers must use the matching build.
The cryptographic suite is unchanged; mutation schema is not the app version.

## Endpoints

All routes retain the account JWT, bounded CBOR and no-store protections.

| Endpoint | Signature and body |
| --- | --- |
| /v3/migration/push | Original schema-2 mutation, purpose mutation; epoch binds the active migration attempt. |
| /v3/migration/snapshot | Signed read, purpose request, operation migration-snapshot, empty parameters. |
| /v3/migration/snapshot/page | Signed read, operation migration-snapshot-page, snapshotId and after. |
| /v3/migration/verify | Migration control, operation verify; migrationId, snapshotId, freezeSeq, ciphertextManifest, sourcePageCount, sourceObjectCount. |
| /v3/migration/commit | Migration control, operation commit; migrationId, freezeSeq, ciphertextManifest, targetEpoch. |

Only the recorded coordinator may upload or inspect staged data. Normal sync
routes cannot read a migrating vault. Migration reads recheck device, epoch,
membership, generation and coordinator in the data-read transaction.

Uploads require a new object with baseVersion 0 and retain exact signed bytes
and idempotent receipts. Initial tombstones are allowed only in migration
uploads. Once VERIFIED, new uploads are rejected; an exact already-accepted
mutation may still return its receipt. Counters are never silently reset.

## Readback and activation

1. The desktop preflights every source page before its first upload: supported
   canonical row shape, safe numbers, identity uniqueness and size constraints.
   Exact source and identity mapping remain in the encrypted recovery store.
2. Each canonical row, including tombstones/relations, is preserved in encrypted
   slot 0 of one opaque random-ID object. Batches are durably saved before send.
   Resume reuses their exact bytes, not newly signed guesses after an unknown ACK.
3. A staging snapshot is fetched and every original signed mutation and AEAD
   field is verified. Decrypted rows are compared against their cached originals;
   count and complete manifest must also match. Plaintext hashes are not uploaded.
4. The coordinator signs the readback attestation. The server checks source
   page/object count, freeze sequence, current stage sequence, membership head,
   epoch and ciphertext manifest. It stores the original signed attestation in
   vault_migration_verifications and seals the attempt as VERIFIED.
5. Commit rechecks the sealed sequence/head/generation and atomically sets
   sync_users.mode=e2ee, vaults.mode=active and migration phase ACTIVE.
   Any failed write rolls back the whole transition.
6. The client requires a matching status query before its journal becomes ACTIVE.
   Lost commit responses are resolved by status or the idempotent commit request.

The server cannot independently verify plaintext equality; that is the trusted
coordinator's job. Server checks alone must not trigger a protection badge.
Commit never deletes canonical tasks, old snapshots, frozen source copies or
backups. Those plaintext copies still require the separately approved purge.

## Limits and unfinished boundaries

Canonical rows over 700 KiB encoded currently fail preflight with
MIGRATION_OBJECT_TOO_LARGE; no truncation occurs. Ordinary app UI, local DB
cutover, late-device pending conversion and larger-object representation remain
release prerequisites. The coordinator is not auto-started by the app.

Cancellation after upload is deliberately unavailable pending approval of the
staging cleanup implementation. The automatic safety reviewer rejected adding
that deletion logic; it was not applied. Existing pre-upload cancellation
remains available, including failed local preflight when the server is still
FROZEN. An upload/verification failure preserves staging and resumes forward;
it must not be advertised as supporting a post-upload cancel yet.
