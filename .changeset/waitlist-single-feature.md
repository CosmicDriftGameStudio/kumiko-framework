---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-cli": minor
---

Waitlist: linkOnSignup, configurable submit rate limit, export and purge, legacy migration

<!-- kumiko-changes
feature: waitlist
type: breaking
title: Waitlist gets linkOnSignup, a configurable submit rate limit, export and purge handlers and a status provisioned
detail: createWaitlistFeature({ linkOnSignup: true }) marks an invited entry provisioned, with linkedTenantId and provisionedAt, when its email becomes the first TenantAdmin member of a tenant; a multi-stream consumer on the membership event does this asynchronously. rateLimit replaces the default of 5 submits per IP per 10 minutes, or { disabled: true, reason } turns it off. waitlist:write:export and waitlist:write:purge are SystemAdmin-only (exportPurge: false leaves them out); purge needs confirmCount to match the current number of entries and shreds the personal-data keys only after every entry was forgotten. The entity gains the status provisioned and the column provisionedAt, so apps that mount the feature generate a schema migration. kumiko ops waitlist-migrate --from offlot|publicstatus [--dry-run] copies a legacy waitlist table into the entity idempotently. Details in docs/guides/waitlist.md.
migration: Apps that mount the waitlist feature run `kumiko schema generate <name>` and commit the migration: read_waitlist_entries gains the nullable column provisioned_at, and the status value provisioned is added. An app with its own waitlist (offlot-app, publicstatus, solon) mounts createWaitlistFeature() and copies the old rows with `kumiko ops waitlist-migrate --from offlot|publicstatus --dry-run` first. offlot-app keeps its legacy rows in the table read_waitlist_entries, the name the framework projection uses: copy or rename that table before the first boot and pass --source-table. The submit limit is keyed per IP and handler; behind a reverse proxy set trustedProxyHops, otherwise all visitors share one bucket of 5 submits per 10 minutes. With linkOnSignup the new consumer starts at the beginning of the event log and also provisions entries invited earlier.
-->
