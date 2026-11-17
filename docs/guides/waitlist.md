---
status: reference
verified: 2026-11-17
---

# Waitlist

`createWaitlistFeature(options)` from `@cosmicdrift/kumiko-bundled-features/waitlist` is the one waitlist for every app. It is a system-scope feature: entries live in the system tenant, an anonymous visitor submits, a SystemAdmin invites or rejects.

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `invite` | `{ mode: "own-tenant", role: "TenantAdmin" }` | `own-tenant` creates a tenant per invited entry, `shared-tenant` adds everyone to one existing tenant. |
| `rateLimit` | 5 submits per IP per 10 minutes | Per-IP limit of `submit`. `{ disabled: true, reason }` turns it off, for example behind a CDN that throttles the route. |
| `emailRateLimits` | 3 submits per address per day | Per-address limit across all IPs. `[]` disables it. |
| `notifyRecipient` | none | Resolver for the address of the admin notice mail. It runs on every new entry, may be async, and a throwing resolver only skips the notice. Statements through `ctx.systemDb` run in a savepoint, so a failing one is rolled back without aborting the submit; statements through other `ctx` handles share the submit transaction. The mail goes through the mail channel, so a callback-only setup resolves the address there. |
| `linkOnSignup` | `false` | Marks an `invited` entry `provisioned` and stores `linkedTenantId` and `provisionedAt` when its email becomes the first TenantAdmin member of a tenant. |
| `exportPurge` | `true` | Mounts `waitlist:write:export` and `waitlist:write:purge`. `false` leaves both out. |
| `appName` | none | Shown in the confirmation mail. |

### linkOnSignup

The link runs as a multi-stream consumer on `tenantMembership.created`, so it is asynchronous and at least once. It covers every path that creates the membership: accepting an own-tenant invite and open signup with an invited address. Only the tenant's first TenantAdmin membership counts, and only entries in `invited` change, so a replay is harmless. The consumer overwrites `linkedTenantId` with the tenant the person actually owns. A consumer registered on an existing app starts at the beginning of the event log: the first boot with `linkOnSignup: true` replays every historical membership and also provisions entries that were invited long ago. Apps that mount the feature need a schema migration for the new `provisioned` status and the `provisionedAt` column (`kumiko schema generate`).

### Export and purge

Both handlers are SystemAdmin-only, high risk and not exposed to agents.

- `waitlist:write:export` returns `{ count, entries }` in the response with decrypted fields, and appends an audit event `waitlist:event:exported` that stores only the count.
- `waitlist:write:purge` takes `confirmCount`. A count that differs from the current number of entries fails with 422 `waitlist_confirm_count_mismatch` and deletes nothing. Otherwise every entry is forgotten through the entity executor, and only after all forgets succeeded the per-subject keys are shredded. An audit event `waitlist:event:purged` stores the count.

## Importing a legacy waitlist

An app that ran its own waitlist copies the old rows into the framework entity in an app seed. It maps each row to a `WaitlistImportEntry` and calls `importWaitlistEntry(db, entry)` with a system-tenant `TenantDb`. The entry id derives from `sourceKey` (`waitlistImportId`), so a stable key such as `<app>:<row id>` makes a second run return `"skipped"` instead of writing a duplicate.

The import writes through the entity executor, so events and projection match a live submit. It sends no mail and skips the rate limit and the duplicate-by-email check. An entry above the submit schema's field limits throws. Personal fields are encrypted when the app runs with a PII key service. Fields without a counterpart go into `message`; a format without a name can use the local part of the email. Drop the legacy table in a migration once the seed has run in production.
