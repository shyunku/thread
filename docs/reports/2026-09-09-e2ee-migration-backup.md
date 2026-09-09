# E2EE migration and backup checkpoint

Updated: 2026-09-09 14:32 (KST).

## Delivered

- #54: schema 9, signed server prepare/status/source/pre-upload-cancel endpoints,
  v2 write freeze under the shared account lock, immutable source-page copies,
  source-count/size checks, idempotent retries and rollback-safe cancellation.
- #54: desktop journal connected to those endpoints, durable source plan and
  encrypted chunked source cache, unknown-ACK recovery, cancellation status
  confirmation and late-response cancellation.
- #55: encrypted data archive export and whole-file verified import into a
  separate recovery-only database, preserving original files and pending edits.

## Evidence

- Desktop E2EE/local-store/sync/recovery/privacy regression: **61 passed**.
- New backup/session tests rerun after cleanup/buffer hardening: **10 passed**.
- API `go test ./...`: passed.
- Empty synthetic MySQL schema 1–9 integration: passed, including v2 write versus
  freeze concurrency, expired original snapshot independence, retry/cancel,
  source preservation and injected copy failure rollback.
- No real environment file, private DB, phone installation or production
  migration/activation/purge was used.

The first synthetic DB run caught a MySQL-specific count error: casting a BLOB
directly to JSON produces an opaque JSON BLOB rather than parsing its text.
Converting the payload to utf8mb4 before the JSON cast fixed source counts.
The next run on a fresh empty database passed. Null/empty change arrays count
as zero. Original page bytes are copied without JSON reconstruction.

## Not complete

#54 and #55 remain WIP. Encrypted upload, readback attestation, final CAS commit,
late-device pending conversion, full recovery/rotation UI, old-generation
retention and ordinary app integration remain implementation work.
The full E2EE application has not been enabled or released.

Contracts: [migration prepare](../protocol/e2ee-migration-prepare.md),
[encrypted archive](../protocol/encrypted-data-backup.md).
Other remaining tasks and user/release gates remain as recorded in the
[prior checkpoint](2026-09-09-e2ee-implementation-progress.md).
