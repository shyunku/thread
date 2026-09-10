# Pre-cutover implementation checkpoint

Updated: 2026-09-10 17:29 (KST).

| Task | Implemented in this checkpoint | Still incomplete |
| --- | --- | --- |
| #46 | User-approved single-root policy; actual TUF renewal/role-isolation regression | Actual updater/signing pipeline and signed distribution |
| #47 | Fixed synchronous CBOR truncation on large local records; existing vectors unchanged | Cross-platform final integration and external review |
| #52 | Explicit bounded three-way outbox content comparison, hide/unmount cancellation | Reapply decisions, ordinary todo adapter, recurrence/conflict completion |
| #56 | Removed unsupported server-state assertion; distinguish pending sync from completion and historical plaintext cleanup | Final ordinary app protection status, full audit/user UX checks |

## Verification

Combined synthetic E2EE/TUF: 120/120 passed. Renderer: 8/8 tests passed. Renderer production build passed with existing ESLint warnings; no installer distribution.

The new long-content test reproduced cbor.encodeCanonical producing an incomplete synchronous result above its default stream buffer threshold. encodeOne now uses canonical encoding with highWaterMark above the accepted 1MiB limit; oversized output is rejected. Tests cover 20KB/700KB payloads, many fields and oversize aggregates. This does not repair any previously truncated records; no actual user vault was inspected or modified.

Outbox comparison includes only the selected draft's fields, original bases and locally verified confirmed object. It is not a live server query. Fields are paginated (20) and each preview capped at 2000 characters; no signed record/key material is returned. React renders text, not HTML. Hide and unmount invalidate late callbacks.

## Outstanding work before actual cutover

The user requested all implementation before actual migration; this checkpoint does not claim that request is finished. #48 ordinary storage switch, #50 final pairing/device UX, #53 actual mobile encrypted read integration, #54 migration coordinator UI/cutover, #55 recovery/rotation UI and the remaining items above still require implementation or verification. Previously successful Windows unlock and Android key-store checks need not be repeated as if untested. Production keys, real account migration, purge and deployment remain unperformed.
