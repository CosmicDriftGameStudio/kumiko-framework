---
"@cosmicdrift/kumiko-bundled-features": minor
---

bookCapUsage/markCapSoftWarned/readRollingCapUsage — in-process calendar-cap booking bound to the caller's own tenant (fw#2854).

New helpers in `book-cap-usage.ts`: `bookCapUsage(ctx, options)` and `markCapSoftWarned(ctx, options)` run the calendar-counter create-or-update / soft-warn-flip logic in-process against `ctx.db`/`ctx.user`; `readRollingCapUsage(db, tenantId, options)` sums a rolling window without throwing and works as the `usage` callback for an existing rolling stream. `enforceCapAndMaybeNotify` and `withCapEnforcement` now call `bookCapUsage`/`markCapSoftWarned` in-process instead of dispatching the `SystemAdmin`-only `increment`/`mark-soft-warned` write-handlers through `ctx.write` — a plain `TenantAdmin` caller (no `SystemAdmin` role, no `escapeHatch`, no `ctx.writeAs` identity-switch) can now use calendar cap-enforcement end to end. `withRollingCapEnforcement` still books through the `SystemAdmin`-only `increment-rolling` write-handler via `ctx.write` — the framework's event-ownership rule rejects `unsafeAppendEvent` calls for a foreign feature made in-process, so rolling callers still need a `SystemAdmin` identity.

<!-- kumiko-changes
feature: cap-counter
type: improvement
title: bookCapUsage/markCapSoftWarned/readRollingCapUsage — in-process calendar-cap booking bound to the caller's own tenant (fw#2854).
migration: |
  No action required for the call signatures — `enforceCapAndMaybeNotify`/`withCapEnforcement`/`withRollingCapEnforcement` keep their existing signatures and result shapes. An app that previously worked around the `SystemAdmin`-only calendar dispatch with its own `escapeHatch` + `ctx.writeAs(SystemAdmin, ...)` wrapper can remove that workaround for `withCapEnforcement`; `withRollingCapEnforcement` callers still need a `SystemAdmin` identity (role or `ctx.writeAs`).
-->
