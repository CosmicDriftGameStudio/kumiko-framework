---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

ctx.notify rejects a broadcast to another tenant

<!-- kumiko-changes
feature: framework
type: breaking
title: ctx.notify rejects a broadcast to another tenant
detail: A notify with to: { tenant } now throws an AccessDeniedError (reason notify_foreign_tenant_broadcast) unless the tenant is the caller's own, before any delivery work. In a write handler it fails synchronously instead of landing in the afterCommit log. Notifications fired from seed hooks during self-signup no longer use the app pool inside the signup transaction, which deadlocked at pool max N with N parallel signups; they deliver after commit. ctx.scheduleAfterCommit is now absent in query bridges and post-commit contexts, where hooks pushed to it never ran; callers that check for it (cache-sync announce, set-tenant-tier onAssigned, form-draft discard, seed hooks) now run inline there instead of being dropped.
migration: |
  to: { tenant } must be the tenant of the caller (user.tenantId of the handler or job context), otherwise notify throws; in a write handler the throw is synchronous. Seed-hook notifications in the signup transaction run after commit and return { kind: "deferred" } (immediate: true runs synchronously on the outside-transaction pool, which cannot see rows the signup transaction has not committed yet, so a tenant broadcast there finds no new member). No known consumer broadcasts to a foreign tenant.
-->
