---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

Every framework escape-hatch use now emits a `security:escape-hatch-used` signal (fw#2861): `ctx.db.unsafeRaw`/`ctx.dbOutsideTransaction.unsafeRaw`, `ctx.systemDb.unsafeRaw`, `ctx.systemDb.acknowledgeCrossTenant` (incl. `outsideTransaction`), `db.global()` write methods, and a granted non-self identity switch via `queryAs`/`writeAs`/`queryAsMember`. Each use reports `{ handler, kind, reason, tenantId, actor, target? }` through the new `AppContext._escapeHatchAuditSink` when the `audit` feature is mounted (persisted as an `audit:event:escape-hatch-used` event), or a structured `log.warn(...)` otherwise — deduplicated per dispatcher within a 60s window for identical (handler, kind, reason, tenant, actor, target) tuples. `createTenantDb`/`createUncheckedSystemDb` used without an explicit reporter warn-log as `"<unattributed>"`.

New optional params: `TenantDbGrants.report`, `createUncheckedSystemDb`'s 3rd param, `createGatedIdentitySwitch`'s 5th param. New exports: `EscapeHatchKind`, `EscapeHatchTarget`, `EscapeHatchUseEvent`, `EscapeHatchAuditSink`, `EscapeHatchReporter` (types package), `createEscapeHatchReporter`, `createEscapeHatchReportWindow`, `fallbackEscapeHatchReporter`, `reportEscapeHatchUse`, `ESCAPE_HATCH_USED_SIGNAL` (framework/pipeline), `createEscapeHatchAuditSink`, `ESCAPE_HATCH_USED_EVENT` (bundled-features/audit). `server-runtime` wires `_escapeHatchAuditSink` at boot whenever the `audit` feature is mounted.
