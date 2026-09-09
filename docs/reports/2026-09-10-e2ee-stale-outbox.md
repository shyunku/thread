# Stale signed outbox preservation

Updated: 2026-09-10 01:17 (KST).

## Behavior

The API checks an existing exact request receipt before checking current membership/generation. The desktop therefore retries the original signed bytes first, even after membership changes.

When that retry returns SYNC_CHECKPOINT_CONFLICT and verified membership is newer than the original request (same epoch), the desktop preserves the original in encrypted recovery and marks the outbox item for review with STALE_SIGNED_REQUEST. This is not proof of non-acceptance and does not authorize automatic re-encryption, deletion or a new mutation ID.

Independent queued edits continue. Dependent edits wait for resolution; visible local overlays remain. Repeated conflict preservation does not overwrite the original recovery entry. Network failures and checkpoint errors without newer verified membership leave the original retryable state unchanged.

## Verification

Desktop synthetic E2EE suite: 114/114 passed. Added stale-rejection/independent-progress, unchanged-membership rejection, uncertain network outcome and old accepted request behind a snapshot scenarios. Recovery bytes/reason survive DB reopen.

No production services, user data, actual environment files or keys were changed. No renderer or installer build was needed for these main-process-only changes.

## Remaining

#52 remains WIP. Review/reapply UI, definitive reconciliation of rejected requests, ordinary todo adapter and full conflict resolution are not complete. This change preserves and classifies pending work; it does not automatically recover every pending edit.
