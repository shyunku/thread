# E2EE migration prepare protocol

Updated: 2026-09-09 15:57 (KST).

This is a **development/rehearsal contract**, not a production migration
procedure. Upload, readback attestation and CAS activation are now implemented:
see [activation contract](e2ee-migration-activation.md). Ordinary app integration,
late-device pending conversion and release approval remain outstanding.
Do not enable this for real accounts.

## Gates and storage

Both `E2EE_API_ENABLED=true` and `E2EE_MIGRATION_ENABLED=true` are required to
register these endpoints. Both default to false. Schema migration 9 only adds
`vault_migrations`, `vault_migration_active` and
`vault_migration_source_pages`; it never freezes an account.

The source-page table contains **plaintext copies of the existing v2 snapshot**.
It belongs in the eventual plaintext inventory/purge policy. A frozen account
is not E2EE-active. No production cleanup or activation is implemented here.

## Signed requests

All endpoints are POST, account JWT authenticated, CBOR only, at most 1 MiB,
30-second request context, and `Cache-Control: no-store`.
The signed record body has exactly:

```text
schema=1, vaultId, deviceId, epoch, membershipRevision, keyGeneration,
operation, parameters, requestId, expiresAt
```

The signature purpose is `migration`, distinct from generic signed reads.
Expiry must be in the next five minutes. The caller must be a currently approved
write device allowed to authorize other devices, and the account must own the
vault. Status/source/cancel are restricted to the recorded coordinator.

| Endpoint | Operation | Parameters |
| --- | --- | --- |
| /v3/migration/prepare | prepare | migrationId, sourceEpoch, sourceSnapshotId, freezeSeq (decimal string) |
| /v3/migration/status | status | migrationId |
| /v3/migration/source | source-page | migrationId, page (zero-based integer) |
| /v3/migration/cancel | cancel | migrationId |

## Freeze and retry

Prepare requires a pending vault and a current, unexpired v2 snapshot. It first
locks the same `sync_users` row as v2 writes, then the vault row. The snapshot
epoch/sequence must match the locked account checkpoint. Therefore either a
concurrent v2 write finishes first and prepare rejects its stale checkpoint, or
prepare freezes first and the v2 write gets `UPDATE_REQUIRED`.

The transaction records the coordinator/checkpoint, copies immutable source
pages, reserves a fresh target epoch, sets the account to `e2ee_frozen` and the
vault to `migrating`. Limits: 128 MiB total source, 4 MiB per source page and
1,000,000 source objects. Oversized sources fail before freeze; automatic
truncation is forbidden.

The same migration ID and source parameters return the existing status even
after the original v2 snapshot expires. A new short-lived proof may be signed
for a retry. Status/cancel tolerate an old request epoch so that a lost prepare
response does not prevent discovering the server-assigned target epoch.
They still authenticate the current coordinator key. New prepare requests
must match current vault epoch/revision/generation.

No lease expiry automatically resets the account. Disabling the feature flag
while frozen does not reopen v2; the authenticated cancellation endpoint must
be available to cancel. Recovery after losing the coordinator is a remaining
prerequisite for production use.

## Cancellation boundary

Cancellation is currently **pre-upload only**: phase FROZEN and no staged
encrypted objects. It removes only this attempt's copied source pages and
active-attempt marker, retains the cancelled checkpoint, restores v2 mode and
the prior pending-vault epoch, and never deletes canonical tasks or local data.
Cancelled attempts cannot be reused as a new migration.

## Desktop connection

`MigrationSession` persists the source plan before sending prepare. Reopening
uses the same migration ID after an unknown response. It verifies each source
page SHA256 and stores exact UTF-8 bytes in 256 KiB pieces inside the encrypted
local recovery bucket. Cache writes are transactional. No plaintext source
hash is sent to the server.

Cancellation requires a second matching status query before the local journal
becomes CANCELLED. Local source/recovery copies remain preserved. Closing the
session prevents late network responses from changing the local journal.

MigrationSession handles preparation/source/cancel; MigrationTransfer now
handles upload/readback/commit/status. Neither is connected to the ordinary UI
or automatically switches/deletes the original local v2 database.
