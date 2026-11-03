---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`screenShortId` is exported from the engine barrel, helpdesk tables get indexes for their hot queries, and only a SystemAdmin can run paid system-check probes.

<!-- kumiko-changes
feature: readiness
type: fix
title: Paid system-check probes only run for a SystemAdmin
detail: `readiness:write:run-probes` ignored the role of the caller for `includePaid`, so any TenantAdmin could trigger paid probes. The flag is now only honoured for a SystemAdmin; for a TenantAdmin it is treated as false.
-->

<!-- kumiko-changes
feature: helpdesk
type: improvement
title: Indexes for helpdesk requests and replies
detail: All helpdesk rows live in the system tenant, so the tenant index selected nothing. `read_helpdesk_requests` gets indexes on (tenant_id, status) and (tenant_id, reporter_user_id), `read_helpdesk_replies` on (tenant_id, request_id).
migration: |
  Run `bun kumiko-schema generate` in the app to pick up the new indexes.
-->
