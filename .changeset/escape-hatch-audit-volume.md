---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

System crons audit their declared escape hatch once per process; audit events get a retention

A cron job with a declared `escapeHatch` that uses `unsafeRaw()` or `db.global()` writes one `audit:event:escape-hatch-used` per process, handler and tenant instead of one per run. Manual runs by a user, identity switches, `acknowledge-cross-tenant` and `unsafe-all-tenants` keep the 60-second dedup window. Every use, audited or not, counts in the new metric `kumiko_escape_hatch_uses_total{handler,kind}`; `createEscapeHatchReporter` takes optional `processDedup`, `meter` and `now` for this. The audit feature gains a daily job `audit:job:escape-hatch-retention` that removes `escapeHatchUse` events through `pruneEvents`, with the period in the system config key `audit:config:escape-hatch-retention-days` (default 90). A new runbook, `docs/runbooks/kumiko-events-bloat.md`, shows how to measure `kumiko_events` bloat and reclaim the space.

<!-- kumiko-changes
feature: framework
type: improvement
title: System cron escape hatches are audited once per process, with a use counter and audit retention
migration: |
  The first run of `audit:job:escape-hatch-retention` deletes `escapeHatchUse` events older than 90 days. To keep them longer, set the system config key `audit:config:escape-hatch-retention-days` (for example through an app override) before the bump rolls out. The audit feature now also requires the `config` feature, which every app with `tenant` already mounts.
-->
