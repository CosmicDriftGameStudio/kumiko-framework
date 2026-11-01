---
"@cosmicdrift/kumiko-bundled-features": minor
---

tenant-inactivity warns Admins as well as TenantOwners, activity sources receive the tenant db, and sessions reads its probe secret from the environment.

<!-- kumiko-changes
feature: tenant-inactivity
type: improvement
title: Warning mails reach Admins, activity sources get the tenant db, sessions probe secret from env
detail: The inactivity warning mail goes to every member with the `TenantOwner` or `Admin` role (the roles that may request or cancel the account destruction), once per user. `TenantActivitySource` now receives `{ tenantId, now, db }` with `db: TenantDb`, so a source can read the tenant's own data; existing sources that ignore the extra field keep working. The sessions feature falls back to the `SESSIONS_LAST_ACTIVITY_PROBE_SECRET` environment variable when `lastActivityProbeSecret` is not set, so apps that mount sessions without options can serve the last-activity probe. A value shorter than 32 characters fails the boot with a message that names the variable but not its value; an unset variable keeps the probe off. Client code can import the handler names from `@cosmicdrift/kumiko-bundled-features/tenant-inactivity/constants` (`TenantInactivityHandlers`, `TenantInactivityJobs`) without pulling the server barrel (ioredis, `tls`) into the browser bundle.
-->
