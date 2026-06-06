# User-Data-Rights Demo

Sample app showing how a Kumiko app wires **user-data-rights** (DSGVO
Art. 15+17+18+20) into a custom domain — here a tiny todo-list. The
domain feature only registers an `EXT_USER_DATA` hook per entity; export
bundling, forget cleanup, restriction and audit-log come from
`user-data-rights` itself.

The sample doubles as **living documentation** for the pattern: read
the integration test top-to-bottom and you've understood the contract.

## What the demo does

A tiny todo app where each user has private todos. The demo proves that
DSGVO requests work end-to-end:

| Article | Endpoint / Runner | What it does |
|---------|-----------|----------------|
| **Art. 15** | `user-data-rights:query:my-audit-log` | User sees own framework events (auth, deletion-request, restriction). Domain entities like todos appear in the **export bundle** (Art. 20), not the audit-log — only handlers using `ctx.appendEvent` show up here. |
| **Art. 15+20** | `user-data-rights:write:request-export` | ZIP with user-profile + fileRefs + todos + signed download magic-link |
| **Art. 17** | `user-data-rights:write:request-deletion` | Soft-delete with grace period; cron anonymizes user + deletes todos |
| **Art. 18** | `user-data-rights:write:restrict-account` | Auth-middleware blocks logins until lift-restriction |

## Architecture in 3 layers

```
┌──────────────────────────────────────────────────────────────┐
│ src/feature.ts                                               │
│   todos:write:create     (per-user todo)                     │
│   todos:query:list       (own todos)                         │
│   r.useExtension(EXT_USER_DATA, "todo", {                    │
│     export: ctx → { entity:"todo", rows:[...] },             │
│     delete: ctx → DELETE WHERE author_id = userId            │
│   })                                                         │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ src/run-config.ts                                            │
│   APP_FEATURES = [data-retention, compliance-profiles,       │
│                   files-foundation, file-provider-inmemory,  │
│                   files, user-data-rights,                   │
│                   user-data-rights-defaults, todos]          │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ bundled-features (no code in the app)                        │
│   user-data-rights          DSGVO pipeline + handlers        │
│   user-data-rights-defaults Default-Hooks for user + fileRef │
│   compliance-profiles       Region profiles (eu-dsgvo)       │
│   data-retention            Retention policies               │
│   files / file-provider-*   File-Refs + Storage              │
└──────────────────────────────────────────────────────────────┘
```

## Demo story as a test

The most thorough doc is the integration test itself:

```bash
bun test
```

`src/__tests__/user-data-rights-demo.integration.ts` boots the full
dispatcher + DB and walks through:

- User creates 2 todos
- `runUserExport` returns a bundle with user + todo entries (todos appear
  because `todosFeature` registered the `EXT_USER_DATA` hook)
- `request-deletion` flips the user to `DeletionRequested`
- After grace expires, `runForgetCleanup` deletes the todos and
  anonymizes the user — _the framework never had to know about todos
  specifically_

Read the test top-to-bottom — it's written as a living doc.

## Run locally

```bash
bun kumiko dev      # Postgres + Redis
bun install
cd samples/apps/user-data-rights-demo
bun dev             # → http://localhost:4291
```

| Login | Value |
|-------|------|
| URL | `http://localhost:4291` |
| Email | `admin@user-data-rights.local` |
| Password | `changeme` |
| Tenant | "User-Data-Rights Demo" |

In the browser, use the dispatcher to create a few todos, then call
`user-data-rights:write:request-export` — the worker queues a job and
runs the export pipeline. The demo `run-config.ts` mounts
`createUserDataRightsFeature()` without a `sendExportReadyEmail`-callback,
so no email is sent — you can see the resulting export-job + magic-link
token in the DB (`read_export_jobs`, `read_export_download_tokens`) and
download via the magic-link path manually. To wire real email, pass an
inbox callback via the feature options (see source-doc on
`UserDataRightsOptions.sendExportReadyEmail`).

For request-deletion, set the user's `grace_period_end` to the past in
the DB (or wait the configured grace period) and run the
`run-forget-cleanup` cron job.

## Adding your own domain

To add another DSGVO-compliant entity to the demo:

```ts illustration
// In your feature:
r.useExtension(EXT_USER_DATA, "your-entity", {
  export: async (ctx) => {
    // ctx.db, ctx.tenantId, ctx.userId
    const rows = await ctx.db.select(...).where(authorId = ctx.userId);
    return rows.length ? { entity: "your-entity", rows } : null;
  },
  delete: async (ctx, strategy) => {
    if (strategy === "delete") {
      await ctx.db.delete(...).where(authorId = ctx.userId);
    } else {
      // anonymize: keep row, null out PII columns
      await ctx.db.update(...).set({ authorId: null }).where(...);
    }
  },
});
```

That's it — your entity is now part of the export bundle and gets
cleaned by the forget cron. No changes to `user-data-rights` needed.

## Key files

- **`src/feature.ts`** — the todos domain with EXT_USER_DATA hooks. Read
  this to understand what an app-author needs to write.
- **`src/run-config.ts`** — feature composition (which bundled-features
  the demo mounts).
- **`src/__tests__/user-data-rights-demo.integration.ts`** — the played-
  out story (create todos → export → request-deletion → forget cron).

## Related samples

- `samples/apps/cap-billing-demo` — tier-engine + cap-counter + mail-
  foundation for billing-driven feature gates.
