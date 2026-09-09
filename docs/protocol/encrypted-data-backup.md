# Encrypted data backup

Updated: 2026-09-09 14:32 (KST).

`dataBackup.js` is a main-process export and recovery-copy implementation.
It is not yet connected to the normal settings UI. Do not interpret it as
completed device-loss recovery or an automatic restore of a working account.

## Data and key handling

- A new backup code contains 32 random bytes plus the existing THREAD1 checksum.
  Keep the backup file and code separately. Neither is automatically stored by
  this module. This code is for the archive, not an account password.
- Export covers confirmed, visible, outbox, recovery and search buckets in one
  synchronous SQLite read transaction. It pages through records instead of
  collecting the entire vault in memory.
- The archive key uses the existing HKDF-SHA256 implementation with purpose
  `data-backup` and a fresh archive header/ID. Each frame uses libsodium
  XChaCha20-Poly1305, a fresh 24-byte nonce and AAD containing the full header and
  frame index.
- Record contents, pending signed bytes and conflict originals are encrypted.
  Vault ID, genesis fingerprint and archive ID in the header are not secret.
- A final authenticated count frame and EOF check detect truncation, duplication,
  reordering and trailing data. Different archive headers also prevent splicing.
- Bounds: 128 MiB archive, 100,000 records, at most 1 MiB encoded frame. Oversized
  records fail without truncation or publication.

## Publication and restore

Export fsyncs its temporary file, then uses a same-filesystem hard link that
fails if the target exists. Existing files are never overwritten.

Restore requires the expected vault/genesis scope, backup code, a new local
encryption key and a new target filename. It validates all frames inside an
encrypted temporary database transaction and publishes only after the complete
archive verifies. On failure, only its own temporary artifacts are removed.
The input archive and existing databases remain untouched.

Imported entries are namespaced in the **recovery** bucket with
`REVIEW_REQUIRED`. They are not installed into confirmed/visible/outbox.
Old device IDs/counters/keys must never be reused as a live identity merely
because they appeared in a backup. Approved-device recovery, reconciliation
and new outbox generation still require the recovery coordinator/UI.

The synchronous transaction and file I/O are bounded but can block the main
process for a large archive. Worker integration and performance measurement
remain prerequisites for the normal UI. JavaScript cannot guarantee erasure of
all copies of strings; temporary byte buffers and derived keys are wiped where
owned by this module.
