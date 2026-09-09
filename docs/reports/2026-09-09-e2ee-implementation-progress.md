# E2EE implementation progress

Updated: 2026-09-09 14:04 (KST).

## Completion boundary

#49 and #51 meet their server/protocol implementation acceptance criteria and
were marked DONE at 13:38. The account migration and ordinary desktop/mobile
application integration are **not complete**. The normal app remains Sync v2;
`E2EE_API_ENABLED` defaults to false and enabling it does not migrate accounts.

Remaining WIP is not exclusively manual testing. In particular #50, #52–56 still
contain implementation work. No production activation, plaintext deletion,
private database access, phone installation, or real environment-file change
was performed for this checkpoint.

## Implemented and automatically verified

| Area | Result |
| --- | --- |
| #49 | Signed device admission with expiry/idempotency, active atomic key rotation/recovery, authorization and recipient-scoped encrypted key retrieval. |
| #51 | Device-signed reads, ciphertext CAS push, immutable receipts, bounded pull/snapshot, original-record signature verification and manifest checking. |
| #47/#53 | Portable mobile CBOR/HKDF/libsodium protocol adapter, shared membership verifier and cross-direction ciphertext/signature/key-transfer tests. Android native crypto probe build passed; native runtime remains unverified. |
| #52 | Encrypted FIFO offline drafts, successive edits of one object, exact prepared retries, signed sync loop, cancellation, transactional snapshot installation and original-record verification of ACKs hidden behind a snapshot. |
| #56 | API request logs emit method, server-owned route template, status and elapsed time only. Panic recovery omits request dumps and raw panic/error contents. |

Desktop encrypted-store/sync/keys/recovery/privacy suite: **51 passed**.
Mobile codec/key-provider/v2-read suite: **10 passed**.
API `go test ./...`: passed. Dedicated MySQL vault tests previously passed on
fresh synthetic databases in a disposable tmpfs container; the ordinary Go run
does not implicitly repeat that integration test.

The snapshot installer keeps staging encrypted, verifies the whole manifest
before the live transaction, preserves unknown-ACK outbox entries, rejects
rollback/omission of locally pinned objects, and cancels replacement when the
local replica changed during verification. It does not treat a server checksum
as proof against all dishonest-server forks or omissions.

The sync loop does not silently re-sign an ambiguously accepted mutation after
network or authority errors. Exact bytes remain available for retry. Explicit
object conflicts retain the encrypted original for subsequent resolution.

## Remaining implementation, separately from user validation

| Task | Remaining implementation |
| --- | --- |
| #48 | Connect the tested vault controller to the ordinary app lifecycle and renderer data clearing; preserve existing v2 storage. |
| #50 | Production pairing/approval UI and durable coordinator, PC/mobile request-file/QR flows. |
| #52 | Ordinary todo UI adapter, field-level conflict resolution, client repeat/sort/search semantics, generation-change retry integration. |
| #53 | Pairing/keyring lifecycle and authenticated encrypted snapshot/delta/cache connected to the ordinary mobile read screen. |
| #54 | Server freeze/staging/CAS commit/cancel/status, client source conversion/readback coordinator, late-device pending conversion. Existing migration journal is not the migration implementation. |
| #55 | User-facing rotation/recovery coordinator, encrypted data-backup restore, old-generation re-encryption/retention and destructive reset consent. |
| #56 | Dynamic protection state based on real local activation, onboarding/notification privacy and remaining diagnostic call-site audit. |

## User or release gates

Android native crypto runtime, iOS, cross-device pairing, real recovery-kit
custody/restore and ordinary encrypted-app UX need explicit user validation.
#46 actual signed distribution and #57 independent review, performance,
purge/restore rehearsal and production activation approval remain separate.
Skipping user tests is not evidence that they passed.
