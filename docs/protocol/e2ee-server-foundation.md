# E2EE server foundation

Historical checkpoint: 2026-09-09 09:55 (KST), schema 6. For the current schema 8, signed protocol, CAS and test results, see the [2026-09-09 implementation checkpoint](../reports/2026-09-09-e2ee-checkpoint.md). Public E2EE routes remain disabled. The pending items below describe the earlier checkpoint, not the current implementation.

## Storage contract

Schema migration 6 adds vault metadata only. Migrations 1–5 remain unchanged. The normal migration runner will create the new empty tables on the next server startup; this does not enable E2EE or copy/delete existing plaintext.

- One vault per authenticated account; initial mode is pending, never active by default.
- Vault/device IDs use case-sensitive ASCII up to 128 bytes; account IDs retain case-sensitive UTF-8 up to 255 characters.
- Membership revision and device counters are unsigned 64-bit values. JSON endpoints must use decimal strings when exposing these values; the current JS membership prototype still needs alignment before public endpoints are enabled.
- Genesis occupies revision 0; subsequent signed events retain their complete canonical bytes and previous digest. Each vault/revision and event digest is unique.
- Device approval/revocation references the same vault's immutable membership revision. A signing key cannot be registered twice within a vault. Role is read/write; authorization permission is separate.
- Recipient/key-generation envelopes are immutable by primary key, scoped to an existing device and event; bounded to 1 MiB. No private keys or plaintext task fields belong in these tables.
- SQL constraints are not signature verification or CAS authorization. Transactional compare-and-swap, device proof, key rotation and recovery remain required before writable endpoints.

## Authentication boundary

The unmounted v3 middleware accepts only an HS256 access token with expiry, authorized=true, nonempty uid and explicit admin=false. It rejects the reserved administrator subject even if the role claim is false. Account identity comes from the token, not a request accountId. Responses are no-store.

This authenticates account lookup only. JWT possession alone must never approve/revoke devices, recover a vault or write ciphertext. No v3 route is mounted yet; no administrator bypass is provided.

## Verification boundary

Unit tests cover invalid/missing roles, reserved admin subject, expiry, wrong algorithm, untrusted accountId, and additive schema structure. The existing disposable MySQL migration harness also tests account/revision uniqueness, same-vault event provenance and envelope recipient constraints. It must run on an empty thread_migration_test_* database, never an application database.

MySQL 8.0 execution passed on 2026-09-09 10:04 KST in an isolated tmpfs database: additive/repeated/concurrent migrations, original fixture preservation, dirty-history rejection and vault relational constraints. The disposable container is removed after verification. Protocol-level signed requests, approval/revoke/recovery/CAS tests and mobile interoperability remain unfinished (#47/#49).
