# Signed session key refresh

Updated: 2026-09-10 01:01 (KST).

## Change

- MembershipHistory retains verified transition records alongside states.
- Initial sync and subsequent membership refresh unwrap sequential device-recipient envelopes using existing openTransition validation.
- Current membership must still authorize the exact device keys. Vault, genesis, epoch and generation must match; previously known keys cannot change.
- The encrypted identity keyring is updated in one transaction after all required transitions pass. A concurrent identity change or cancellation prevents replacement. Intermediate decoded key buffers are cleared.
- A running engine resolves keys from the updated ring, preserving historical decryption keys.

## Verification

Synthetic desktop E2EE regression: 110/110 passed. Added coverage: multiple offline rotations, live-session refresh, wrong epoch, revoked device, cancellation during unwrap, concurrent local update and signed replacement of a known historical key.

No environment files, user DBs, server deployments or real key rotations were used. No renderer changes or installer build in this milestone.

## Boundaries

This receives already-authorized transitions; it does not initiate rotation or renew the user's recovery kit. Prepared outbox bytes with an uncertain ACK are deliberately preserved, not automatically rewritten under new keys. Resolving rejected old-generation prepared writes is still required. Ordinary todo integration, complete recovery UI and physical multi-device checks remain WIP under #52/#55. Production cutover remains #57.
