# E2EE sync session integration

Updated: 2026-09-10 00:04 (KST).

## Implemented

- Account-scoped, no-store GET /v3/vault/status provides routing metadata without creating or migrating a vault. UID comes from the authenticated principal, not query parameters.
- Development vault settings explicitly opens sync with the stored owner or paired-device identity. It verifies pinned membership, device keys and key generation before using the existing signed sync engine.
- v2/pending accounts return WAITING_FOR_MIGRATION without creating replica metadata. Initial verified snapshot and metadata are committed together; failed verification leaves a fresh replica unbound.
- Lock/account switch aborts requests, closes the engine and clears in-memory key copies. The renderer only receives status/cursor/counts.
- Explicit sync retries existing encrypted outbox records; it does not migrate v2 data or change the ordinary todo storage.

## Verification

- Desktop synthetic E2EE regression: 103/103 passed.
- EncryptedSync/VaultWorkspace renderer tests: 3/3 passed.
- Go controllers/v3 and service/vault tests passed, including real MySQL account-status isolation in a newly created disposable tmpfs database.
- Renderer production build passed with existing ESLint warnings; this is not a packaged desktop installer or real two-device validation.
- Real environment files, user databases and production services were not read or changed.

## Remaining

#52/#54 remain WIP: ordinary todo adapter, recurrence/conflict resolution, generation refresh, migration execution UI and main database cutover are not complete. Production migration/release requires #57. A successful sync status does not establish that old plaintext has been purged.
