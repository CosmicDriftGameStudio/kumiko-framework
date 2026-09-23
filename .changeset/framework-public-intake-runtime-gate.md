---
"@cosmicdrift/kumiko-framework": minor
---

Writes under an anonymous root need access.personalData: "public-intake" at runtime, across feature boundaries (fw#3165)

The boot check from fw#2885 only sees personal-data keys in an anonymous write handler's own input schema, for entities of its own feature. Every public dispatch (write, batch command, query, stream) now computes a WriteOrigin (root handler, anonymous root, public-intake declared) once. Every nested call inherits it: ctx.write, ctx.writeAs, ctx.query, ctx.queryAs, nested writes and afterCommit hooks. When the root is anonymous and does not declare public-intake, a write that touches a personal-data field (pii / userOwned / recordOwned) of any registered entity fails with AccessDeniedError, details.reason "public_intake_required". The error details name the root handler, the table and the fields, never the values. The check runs in TenantDb.insertOne/updateMany, in db.global().insertOne/updateMany and in the event-sourced create/update executor, after preSave and before the event append. It also covers rebound TenantDbs (acknowledgeCrossTenant, hook re-gating). Authenticated sessions are not affected. Not gated: ctx.db.unsafeRaw (covered by escapeHatch plus audit); ctx.appendEvent on a feature's own events (foreign events are already rejected); tables outside the registered entities; jobs and event subscribers queued from an anonymous root; and TenantDbs that handler code builds directly with createTenantDb. The last two are tracked in fw#3185, which also lists the bundled auth-email-password and user-data-rights flows that go through unsafeRaw or createTenantDb.

<!-- kumiko-changes
feature: framework
type: breaking
title: Writes under an anonymous root need access.personalData: "public-intake" at runtime, across feature boundaries (fw#3165)
migration: |
  A write handler that anonymous callers can reach (roles include "anonymous") and that writes a personal-data field (pii / userOwned / recordOwned) of any entity must declare access: { roles: [..., "anonymous"], personalData: "public-intake" }. This applies whether the handler writes the field itself or through ctx.db, the CRUD executor, ctx.write, ctx.writeAs/queryAs or a postSave/afterCommit hook, and it applies across features. Without the declaration the write now fails with AccessDeniedError (details.reason "public_intake_required"). A failing afterCommit hook is only logged, and its write does not happen. Known consumer handlers, measured on 23.09.2026: offlot-app waitlist:submit, vehicle-enquiry:submit and try-first:set-contact; publicstatus email-subscriber:subscribe; show-pony rsvp:submit. Add the declaration if the anonymous intake is intended (the handler's rateLimit is then the only protection). Otherwise stop writing the field from the anonymous path.
-->
