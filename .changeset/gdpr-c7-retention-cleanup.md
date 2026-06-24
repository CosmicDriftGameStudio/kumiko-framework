---
"@cosmicdrift/kumiko-bundled-features": minor
---

feat(data-retention): autonomous retention-cleanup cron (GDPR C7)

`data-retention` now registers a `retention-cleanup` cron (perTenant fan-out,
daily) that autonomously enforces configured retention policies — previously
rules were resolved but never executed. For each implicit entity projection it
resolves the effective policy (entity-default → compliance-profile-derived
preset → per-tenant override) and applies the strategy to rows past their
`keepFor` cutoff:

- **hardDelete** — batched delete (`deleteManyBatched`, no full-table scans)
- **softDelete** — `isDeleted`/`deletedAt`, only on not-yet-deleted rows
- **blockDelete** — ignored by design (the user-forget flow anonymizes instead)
- **anonymize** — deferred (needs an idempotency marker; no bundled entity uses
  time-driven anonymize, and the forget flow covers userId-keyed anonymize)

The Layer-2 preset is derived from the tenant's compliance profile when
`compliance-profiles` is mounted (soft-dependency, no `r.requires`), so mounting
both features cleans data with no app code.

Two latent silent-no-op bugs surfaced and fixed as the first real consumer of
`retention.reference`:

- The boot-validator allows `createdAt`/`updatedAt` as retention references, but
  the physical columns are `inserted_at`/`modified_at`. The cleanup runner now
  maps these framework-timestamp aliases to the real columns.
- The `dsgvo-*` presets keyed entities `auditLog`/`httpLog` (camelCase) against
  the file's own kebab-case convention; renamed to `audit-log`/`http-log`.

A missing reference column is skipped (not mass-deleted) and reported for
operator visibility.
