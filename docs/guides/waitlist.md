---
status: reference
verified: 2026-10-18
---

# Waitlist

`createWaitlistFeature(options)` from `@cosmicdrift/kumiko-bundled-features/waitlist` is the one waitlist for every app. It is a system-scope feature: entries live in the system tenant, an anonymous visitor submits, a SystemAdmin invites or rejects.

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `invite` | `{ mode: "own-tenant", role: "TenantAdmin" }` | `own-tenant` creates a tenant per invited entry, `shared-tenant` adds everyone to one existing tenant. |
| `rateLimit` | 5 submits per IP per 10 minutes | Per-IP limit of `submit`. `{ disabled: true, reason }` turns it off, for example behind a CDN that throttles the route. |
| `emailRateLimits` | 3 submits per address per day | Per-address limit across all IPs. `[]` disables it. |
| `notifyRecipient` | none | Resolver for the address of the admin notice mail. It runs on every new entry, may be async, and a throwing resolver only skips the notice. The mail goes through the mail channel, so a callback-only setup resolves the address there. |
| `linkOnSignup` | `false` | Marks an `invited` entry `provisioned` and stores `linkedTenantId` and `provisionedAt` when its email becomes the first TenantAdmin member of a tenant. |
| `exportPurge` | `true` | Mounts `waitlist:write:export` and `waitlist:write:purge`. `false` leaves both out. |
| `appName` | none | Shown in the confirmation mail. |

### linkOnSignup

The link runs as a multi-stream consumer on `tenantMembership.created`, so it is asynchronous and at least once. It covers every path that creates the membership: accepting an own-tenant invite and open signup with an invited address. Only the tenant's first TenantAdmin membership counts, and only entries in `invited` change, so a replay is harmless. The consumer overwrites `linkedTenantId` with the tenant the person actually owns. A consumer registered on an existing app starts at the beginning of the event log: the first boot with `linkOnSignup: true` replays every historical membership and also provisions entries that were invited long ago. Apps that mount the feature need a schema migration for the new `provisioned` status and the `provisionedAt` column (`kumiko schema generate`).

### Export and purge

Both handlers are SystemAdmin-only, high risk and not exposed to agents.

- `waitlist:write:export` returns `{ count, entries }` in the response with decrypted fields, and appends an audit event `waitlist:event:exported` that stores only the count.
- `waitlist:write:purge` takes `confirmCount`. A count that differs from the current number of entries fails with 422 `waitlist_confirm_count_mismatch` and deletes nothing. Otherwise every entry is forgotten through the entity executor, and only after all forgets succeeded the per-subject keys are shredded. An audit event `waitlist:event:purged` stores the count.

## Migrating a legacy waitlist

Apps that ran their own waitlist copy it into the framework entity with the CLI:

```bash
kumiko ops waitlist-migrate --from offlot --dry-run
kumiko ops waitlist-migrate --from offlot
kumiko ops waitlist-migrate --from publicstatus --source-table my_subscribers
```

| Flag | Meaning |
| --- | --- |
| `--from offlot\|publicstatus` | Selects the legacy row format. |
| `--dry-run` | Reads and reports, writes nothing. |
| `--source-table <name>` | Legacy table when it is not the default (`read_waitlist_entries` for offlot, `marketing_waitlist` for publicstatus). |
| `--locale <tag>` | Locale for formats without one (publicstatus). Default `en`. |

The command loads `kumiko.config.ts`, needs `DATABASE_URL` and the mounted `waitlist` feature, reads the legacy table through the app database and writes only through the entity handlers. Every legacy row maps to a deterministic entry id, so a second run finds the entries and writes nothing. The summary line reports read, created, already present and unreadable rows. Rows whose personal fields are still ciphertext cannot be read by the CLI, which has no PII key service configured, and make the exit code 1.

Legacy fields without a counterpart (city, stock, country, notes) are folded into `message` as labelled lines. The publicstatus format has no name, so the local part of the email is used.

offlot keeps its legacy rows in `read_waitlist_entries`, the same table name as the framework projection. Copy or rename the old table first and pass `--source-table`, otherwise a projection rebuild replays the old events against the new entity.
