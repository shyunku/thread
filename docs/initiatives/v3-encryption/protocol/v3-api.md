# E2EE v3 API implementation

Updated: 2026-09-09 13:38 (KST). Server implementation/automated tests complete for #49 and #51. This is not a production E2EE release or an external security review.

## Deployment boundary

`E2EE_API_ENABLED=true` mounts these routes; the default/template/Compose fallback is false. The switch never activates an account, migrates plaintext or deletes anything. Actual env files were not edited. Production enablement remains #57; coordinator/UI integration is tracked separately in #50/#52–56.

Every route requires a non-admin, authorized, unexpired HS256 account JWT. The UID is taken only from that principal. Device approval, recovery, mutation and ciphertext reads require an additional appropriate signature. Shared account JWTs are not device-bound; revocation blocks the device's signed v3 sync/key access, not all account logins.

## Encoding and endpoints

POST bodies are canonical CBOR, at most 1 MiB. The envelope is exactly `{body,signature}`; signatures cover canonical `[thread-e2ee-v1,purpose,body]`. Replies are JSON; original CBOR records use canonical base64. Errors expose fixed codes, not SQL/request material. Sync calls have a 30-second deadline.

| Route | Authorization / behavior |
| --- | --- |
| GET /v3/vault/status | Account JWT; no-store routing metadata: vaultId, accountMode, vaultMode, epoch, keyGeneration, revision, head. Missing vault returns 404; no initialization or migration. |
| POST /v3/vault | Owner-signed genesis; creates pending only; identical original genesis retry is idempotent, replacement is forbidden. |
| GET /v3/vault?after=N | Account-scoped original genesis and paged membership records; clients require a previously trusted genesis pin. |
| POST /v3/vault/membership | Authorizer-signed add/pending-revoke. New writes include requestId and expiresAt (milliseconds, at most ten minutes ahead). Expired new approvals are rejected; exact committed retry is harmless. |
| POST /v3/vault/recovery | Recovery-authority-signed pending-vault replacement only. |
| POST /v3/vault/transition | Active rotate/recover with atomic generation/authority/device/envelope update. |
| POST /v3/sync/push | Active write device, signed full-object batch; version CAS, monotonically increasing device counter, durable receipt, atomic operations. |
| POST /v3/sync/pull | Short-lived device-signed read proof, operation pull, parameters after/until (decimal strings). |
| POST /v3/sync/snapshot | Signed read proof, operation snapshot, empty parameters. |
| POST /v3/sync/snapshot/page | Signed read proof, operation snapshot-page, parameters snapshotId/after. |
| POST /v3/sync/envelope | Signed read proof, operation envelope, parameter keyGeneration; only the requesting active recipient's record. |

Read proof body has exactly schema=1, vaultId, deviceId, epoch, membershipRevision, keyGeneration, operation, parameters, requestId and expiresAt. Purpose is `request`; maximum future expiry is five minutes. Read replays within that window are allowed. Current device authorization is rechecked inside the database snapshot used to read ciphertext.

Membership revisions/generations/slots are nonnegative safe integers. Counter, cursor, seq and object versions are uint64 decimal strings. Historical six-field membership records can still be verified by clients; new server writes require eight fields including signed expiry/request ID.

## Active rotation and recovery

Status added: 2026-09-10 00:04 (KST). This metadata is not a signed security assertion or proof that legacy plaintext was purged. Clients verify pinned signed membership, their device keys and generation, then verify the snapshot before committing replica state. The ordinary v2 capabilities endpoint remains unchanged.

Transition body: schema=1, vaultId, revision, previous, operation, signer, keyGeneration, recoveryKey, devices, envelopes, recoveryEnvelope. It is a complete surviving-device list (1–32, at least one authorizer) and exactly one sealed ciphertext per survivor. No plaintext key is sent.

- rotate uses `membership-transition` and a current authorizer's key. Surviving IDs keep their original public keys; revoked IDs and previously used signing keys cannot be recycled.
- recover uses `recovery-transition`, signer=null and the current recovery authority. Every new device must be fresh.
- Both advance generation/revision by one and renew the recovery authority. A new recovery kit must be saved/verified in the client before committing. The old recovery code cannot authorize a later recovery.
- Device/event/envelopes/head/authority change in one transaction. Missing recipients, wrong authority, stale head, readonly approval, old-generation writes and cross-account operations fail.
- Clients retain historical keys when delivering a new generation. Old ciphertext re-encryption/retention and user-facing rotation remain #55 integration work. Revocation cannot erase copies a device already possesses.

## Snapshot and resource contract

Pull returns at most 32 changes / 4 MiB raw records. Snapshot pages return at most 32 objects / 4 MiB raw records. Snapshot contents are immutable copies including original signed batch and operation index; count/digest are computed over ordered object provenance. Identical epoch/seq/head requests reuse the existing snapshot. A vault may retain four unexpired snapshots, with a 24-hour TTL; creating a snapshot removes only that vault's expired snapshot copies, never live objects or receipts.

The client verifies each original signature/AAD, the selected operation/version/deletion, sorted page boundaries, whole count/digest and minimum trusted cursor before committing staged data. The manifest digest is a checksum, not proof that a malicious server is honest. Withheld records, global forks, availability and historical plaintext copies remain documented threat-model limitations.

## Automated evidence

API unit tests, full Go suite and dedicated tmpfs MySQL runs passed. Tests include pending/active boundaries, altered records, exact retries, expired approvals/read proofs, wrong operation, wrong account, revoked/readonly devices, generation changes, authority replacement, missing envelopes, concurrent single-winner CAS, atomic failed batches, immutable snapshot provenance, snapshot retry/quota/expiry, and sanitized HTTP errors. Desktop read/transition/pairing tests validate key delivery and snapshot tamper/rollback rejection.

Tests use only generated or fixed synthetic keys and disposable databases. No real backup, account, env file, deployment or plaintext purge was used. #47 native device interoperability/external review and #57 release approval remain separate gates.
