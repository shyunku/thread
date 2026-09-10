# Update signing policy

Confirmed: 2026-09-10 17:29 (KST).

- Initial root: one independent key, threshold 1. The previously proposed 2-of-3 policy is not selected.
- Root private key stays outside the repository, RMS/API servers and CI. Maintain a separately protected backup. Losing all copies prevents normal root renewal.
- Release signing keys are separate from root. Timestamp/snapshot roles are also separate in the existing synthetic tests.
- The desktop ships public trusted root metadata, verifies metadata and installer bytes locally, and retains rollback history.
- Future root/threshold changes must follow TUF's signed old/new-root authorization chain; changing server configuration alone cannot replace installed trust.
- Root separation does not prevent malicious releases if an attacker controls sufficient release-signing authority. CI release authorization remains a separate operational decision.
- No production keys/certificates are generated or used by this approval. Actual signed release, first-install authenticity and code-signing certificates remain #46/#57 gates.

Verification: synthetic TUF tests confirm threshold 1/root-role isolation, valid root renewal and old-root rollback rejection. The updater integration is still WIP.
