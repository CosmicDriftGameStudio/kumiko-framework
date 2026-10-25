# es-ops

ES operations for Kumiko apps. Phase 1+1.5 delivers `seed-migrations` as a file-based diff-and-apply mechanism for aggregate state updates that idempotent seeders cannot cover.

> **Phase 1 vs 1.5:** Phase 1 had the foundation code; Phase 1.5 completed the first real driver use case (publicstatus admin roles) and added: `tenantIdOverride` for tenant-scope aggregates, a dry-run validator for handler QNs, deployment documentation, and a local smoke pattern.

## Quick API

```ts
import { runProdApp } from "@cosmicdrift/kumiko-server-runtime";

await runProdApp({
  features: [...],
  envSchema,             // composeEnvSchema({ core: frameworkCoreEnvSchema, features })
  seedsDir: "./seeds",   // ← only setup requirement
  // ...
});
```

> **Phase 1 scope:** `runProdApp` only. `runDevApp` integration follows in Phase 1.5 (requires a separate dispatcher bootstrap that is stack-typed). For local tests: run `bunx kumiko ops seed:status` against the dev DB to see pending seeds, then run `runProdApp` locally with the DEV connection to apply them.

```ts
// seeds/2026-05-20-fix-admin-roles.ts
import type { SeedMigration } from "@cosmicdrift/kumiko-framework/es-ops";

export default {
  description: "add TenantAdmin role for admin@example.com",
  run: async (ctx) => {
    const admin = await ctx.findUserByEmail("admin@example.com");
    if (!admin) return;
    for (const m of await ctx.findMembershipsOfUser(admin.id)) {
      if (m.roles.includes("TenantAdmin")) continue;
      await ctx.systemWriteAs(
        "tenant:write:update-member-roles",
        { userId: admin.id, tenantId: m.tenantId, roles: [...m.roles, "TenantAdmin"] },
        m.streamTenantId, // ← tenantIdOverride from the JOIN on kumiko_events.v1
      );
    }
  },
} satisfies SeedMigration;
```

### When do I need `tenantIdOverride`?

Rule of thumb: **if the target aggregate was created via a tenant user, you need the override.**

| Aggregate type | Stream tenant | `tenantIdOverride` |
|---|---|---|
| config-values (system scope) | SYSTEM_TENANT | omit |
| system text-content | SYSTEM_TENANT | omit |
| tenant-membership | Payload tenant (after `backfillTenantStreamTenants`: `streamTenantId = tenantId`); older streams may still use the tenant of the creating admin | ✅ `m.streamTenantId` (NOT `m.tenantId` until the backfill has run) |
| App entity (orders, tasks, …) | Tenant stream | ✅ Tenant ID from the lookup |

**Why not `m.tenantId`?** `read_tenant_memberships.tenant_id` is the payload tenant (logical membership target), while `kumiko_events.tenant_id` in the v1 row is the stream tenant (where the aggregate physically lives). Before the `backfillTenantStreamTenants` backfill, the two differed for memberships created by an admin from another tenant (`seedTenantMembership` now forces the stream tenant to the payload tenant). The `findMembershipsOfUser` helper returns both separately so seeds can choose the correct one.

Without `tenantIdOverride`, the executor looks for the stream against SYSTEM_TENANT → `version_conflict`. Memory: `feedback_event_store_tenant_consistency.md`.

## Deployment Requirements

Important, frequently overlooked:

### Docker / Bun bundle

Seeds are loaded at runtime via `await import(absolutePath)`. Bun's bundler strips dynamic-import targets → the seeds/-tree must be copied into the image as a raw TS tree:

```dockerfile
# After the dist-server/-COPY:
COPY --from=build --chown=app:app /app/seeds ./seeds
```

Also: in the `bun build` stage, do NOT run `--minify` over the seed files (they are not an input: the bundler bundles `bin/main.ts`, not the seeds directory).

### Idempotency requirement

The seed body does **NOT** run atomically with the marker (see “What is NOT guaranteed” below). If a seed throws midway, the events already committed remain, but the marker does not → retry on the next boot. **Seeds must be idempotent.**

Standard pattern:
```ts
const memberships = await ctx.findMembershipsOfUser(adminId);
for (const m of memberships) {
  if (m.roles.includes("TenantAdmin")) continue; // ← check-then-write
  await ctx.systemWriteAs(...);
}
```

Anti-pattern (NOT idempotent):
```ts
for (let i = 0; i < 5; i++) {
  await ctx.systemWriteAs("create-something", { ... }); // ← re-run produces duplicates
}
```

### Multi-replica boot

`pg_advisory_xact_lock` serializes parallel pod boots. The lock key is global (`0x65736f70` / “esop”), not migration-specific → with N pending migrations, they run sequentially N times, not in parallel. For the typical seed migration workload, this is fast enough; for very long migrations (>30s) on a multi-replica stack: run them manually first as a CLI step (`bunx kumiko ops seed:apply`), then roll out the pods.

### Local smoke test before pushing

Required pattern: before pushing seeds to main, run the boot loop once locally against the dev DB. See `samples/recipes/seed-migration/scripts/smoke.ts` as a copy-paste template.

## CLI

```bash
bunx kumiko ops seed:new <slug>    # scaffold seeds/<date>-<slug>.ts
bunx kumiko ops seed:status        # what was applied, what is pending
bunx kumiko ops seed:apply [--dry-run]  # apply pending seeds (CLI path in Phase 1.5)
```

## Guarantees

| Guarantee | How |
|---|---|
| **Single-run** | Marker in `kumiko_es_operations` + `pg_advisory_xact_lock` serializes multi-replica boots |
| **Marker atomicity** | Runner transaction + re-check inside the lock → marker reflects “run was actually attempted” |
| **Order** | File name = chronological ID; failure stops all pending migrations |
| **ES-compliant** | `systemWriteAs` calls the existing handler → events land in the store |
| **Recovery** | `skippable: true` + `KUMIKO_SKIP_ES_OPS_<ID>=1` env flag for emergency skips |
| **Boot skip** | `KUMIKO_SKIP_ES_OPS=1` env var skips all pending migrations (debug boots) |

### What is NOT guaranteed

**The seed body is NOT atomic with the marker.** `systemWriteAs` runs through the app dispatcher with its own transaction management (separate from the runner transaction). If a seed successfully calls `systemWriteAs` 5 times and then throws, the 5 events are **committed**, but the marker is **not** written. On the next boot, the runner retries, so seeds must therefore be **idempotent**:

```ts
// Good: skip if already fixed
for (const m of memberships) {
  if (m.roles.includes("TenantAdmin")) continue;
  await ctx.systemWriteAs(...);
}

// Bad: every re-run duplicates
for (const m of memberships) {
  await ctx.systemWriteAs("create-something-new", ...); // double on retry!
}
```

Most real seeds are naturally idempotent (existing lookup → conditional write). Full end-to-end atomicity (write + marker in the same transaction) is planned for Phase 1.5; it requires a refactor so that the dispatcher takes over the outer transaction.

## Architecture

`packages/framework/src/es-ops/` contains:

| File | Purpose |
|---|---|
| `operations-schema.ts` | `kumiko_es_operations` table definition + `createEsOperationsTable` helper |
| `types.ts` | `SeedMigration` + `SeedMigrationContext` public API |
| `runner.ts` | `runPendingSeedMigrations`: diff + transaction + marker |
| `context.ts` | `createSeedMigrationContext`: read helpers + `systemWriteAs` |
| `index.ts` | barrel export |

Table schema:

```sql
CREATE TABLE kumiko_es_operations (
  id              TEXT PRIMARY KEY,
  operation_type  TEXT NOT NULL,                -- "seed-migration" | (Phase 2+)
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms     INTEGER NOT NULL,
  applied_by      TEXT NOT NULL,                -- "boot" | "cli" | "ci-pipeline"
  notes           TEXT
);
```

## Phase 2+

The `operation_type` discriminator allows future operations to use the same table + the same CLI pattern:

- `projection-rebuild`: TRUNCATE read_* + replay from events
- `event-replay`: resend notifications without a DB write
- `event-backfill`: missing events for pre-ES data
- `stream-migration`: aggregate stream tenant move (sysadmin bug)
- `aggregate-rebuild`: snapshot refresh

Implementation: **on demand**, once a concrete use case needs one of them.

## Driver Use Case

publicstatus' admin member initially had `roles: ["Admin"]`. A role-naming drift sprint added “TenantAdmin”, but the idempotent seeder skipped existing memberships → DB drift. Phase 1 addresses exactly this class of bugs.

See sample: `samples/recipes/seed-migration/`.
