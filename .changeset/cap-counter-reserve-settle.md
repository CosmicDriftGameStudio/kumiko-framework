---
"@cosmicdrift/kumiko-bundled-features": minor
---

cap-counter: reserveCalendarCapUsage reserves capacity before an expensive call and settles the actual usage afterwards, from handlers and jobs

<!-- kumiko-changes
feature: cap-counter
type: improvement
title: Reserve and settle cap usage outside the dispatcher
detail: |
  reserveCalendarCapUsage(ctx, { capName, periodStartIso, limit, profile, amount, notify? }) runs the same sweep, soft-hit notification and guarded hard-cap reservation as withCapEnforcement and returns a handle. settle(actualAmount) replaces the reserved amount by the actual one in one transaction (and books the full actual amount if the reservation was swept or released meanwhile); release() gives it back. Parallel callers cannot exceed the hard cap. It works with a HandlerContext (also r.systemScope() handlers) and a JobContext. Pattern: `const r = await reserveCalendarCapUsage(ctx, {...}); try { ...; await r.settle(actual) } catch (e) { await r.release(); throw e }`. bookCapUsage, markCapSoftWarned, releaseCapUsage and the enforceCap family accept a JobContext as well.
migration: |
  withCapEnforcement and bookCapUsage now work on r.systemScope() handlers; before, they failed on the fail-closed ctx.db. Reservation rows carry the tenant of ctx.user explicitly, and a context whose tenant-mode db belongs to another tenant than ctx.user is rejected with access_denied. enforceCap now filters the counter by ctx.user.tenantId, so a system-mode db no longer reads another tenant's counter.
-->
