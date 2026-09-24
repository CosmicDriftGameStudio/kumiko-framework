---
"@cosmicdrift/kumiko-framework": minor
---

The public-intake gate now also covers jobs, event-triggered jobs, anonymous query roots and TenantDbs built from ctx.db.unsafeRaw (fw#3185)

<!-- kumiko-changes
feature: framework
type: breaking
title: The public-intake gate now also covers jobs, event-triggered jobs, anonymous query roots and TenantDbs built from ctx.db.unsafeRaw (fw#3185)
migration: |
  An anonymous handler (roles include "anonymous") without personalData: "public-intake" now fails when personal data (pii / userOwned / recordOwned) is written through any of these paths: a job it enqueues (write or query root), a job triggered by its handler event or by an r.defineEvent it appends, a job chained from such a job, a job ctx.write/writeAs into another handler, or a TenantDb built with createTenantDb on a ctx.db.unsafeRaw / ctx.systemDb.unsafeRaw runner (including savepoints on it). The error is AccessDeniedError with details.reason "public_intake_required"; for jobs details.job names the job and the job run fails. Declare access: { roles: [..., "anonymous"], personalData: "public-intake" } on the root write handler if the anonymous intake is intended, otherwise stop writing the field from that path. A query root cannot declare public-intake: move the enqueue from an anonymous query handler into a write handler that declares it. Raw SQL through unsafeRaw stays escapeHatch plus audit. Jobs without a stamped origin (cron, boot, jobs dispatched outside a request, jobs queued before this release) run as before; a job whose _writeOrigin is present but invalid fails before its handler runs.
-->
