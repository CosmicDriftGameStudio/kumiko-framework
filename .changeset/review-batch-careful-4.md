---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

PR-review fix batch (careful-tier findings, batch 4):

- `enrichWithReferences` (eagerload) computes each ref entity's PII/encrypted-field sets and KMS handle once per reference field instead of once per referenced row.
- `event-store-executor-write`'s `runPreSave` now strips `id`/`version` from a preSave hook's return value before it's persisted — a hook that echoes them back could otherwise override the framework-minted `aggregateId`.
- `subscription-tier-sync`'s webhook route no longer turns an already-committed write into `isSuccess: false` when the follow-up tier sync fails — Stripe/PayPal would otherwise retry an event whose primary effect already landed. The sync failure is now logged instead.
- `revoke-all-for-user` hard-fails (instead of silently defaulting to `eventVersion: 1`) when `SESSION_REVOKED_EVENT_QN` isn't registered; the surrounding write transaction rolls the session-revoke back too.
- `schema-builder`'s defaulted-select preprocessing now also maps `null` to the field default, matching the no-default branch's own "" → null normalization.
- `watch-supervisor` no longer routes a projection-write failure (marking an account "watching") through the sync-error/backoff path — the watch itself is healthy.
- `styleguide`'s inbox-messages query handler validates `cursor`/`limit` instead of accepting unbounded/negative values.
- `backfill-changelogs --days` now rejects a non-numeric value instead of producing `Invalid time value`.
- `seed-items` (showcase) probes via `{ limit: 1, totalCount: true }` instead of comparing `rows.length` against a page size that a future max-limit clamp could invalidate.
- `gen-feature-screenshots`: sample screenshots keep their own preview label separate from the URL path segment, the SAMPLES_OUT default no longer escapes an explicit `SCREENSHOT_DIR`, and the summary log line now counts sample PNGs too.
- `PII_USER_REFERENCE_NAME_HINTS` gained `createdby`/`updatedby`/`assigneeuserid`/`memberid` — the boot-validator's GDPR-hook-coverage guard previously missed those common FK-naming shapes.
- `engine`'s public barrel now re-exports `userCanCreateFieldRow`/`normalizeAccessEntry` (already public in `ownership.ts`, just missing from the index).
- Small dedup/doc fixes: `screenAccessAllows` (renderer/render-field), `fillClasses` (renderer-web layout shells), `fieldIconFor` (renderer-web primitives), `entity-table-meta`'s deprecated-alias error message, `schema-cli`'s `storeTable()` hint, the `guard-types-class-free` mutable-state regex (no longer flags readonly object/array literals), and an `InfiniteSentinel` LocaleProvider-requirement doc note.
