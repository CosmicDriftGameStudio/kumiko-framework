# es-ops

ES-Operations für Kumiko-Apps. Phase 1 liefert `seed-migrations` als file-basiertes Diff-and-Apply für Aggregate-State-Updates, die idempotent-Seeder nicht erfassen können.

## Quick API

```ts
import { runProdApp } from "@cosmicdrift/kumiko-dev-server";

await runProdApp({
  features: [...],
  seedsDir: "./seeds",   // ← einzige Setup-Pflicht
  // ...
});
```

> **Phase 1 Scope:** `runProdApp`-only. `runDevApp`-Integration folgt in Phase 1.5 (braucht separaten Dispatcher-Bootstrap, der stack-typed ist). Für lokale Tests: laufe `bunx kumiko ops seed:status` gegen die Dev-DB um pending seeds zu sehen, dann `runProdApp` lokal mit DEV-Connection für Apply.

```ts
// seeds/2026-05-20-fix-admin-roles.ts
import type { SeedMigration } from "@cosmicdrift/kumiko-framework/es-ops";

export default {
  description: "ergänze TenantAdmin-Rolle für admin@example.com",
  run: async (ctx) => {
    const admin = await ctx.findUserByEmail("admin@example.com");
    if (!admin) return;
    for (const m of await ctx.findMembershipsOfUser(admin.id)) {
      if (m.roles.includes("TenantAdmin")) continue;
      await ctx.systemWriteAs("tenant:write:updateMemberRoles", {
        userId: admin.id,
        tenantId: m.tenantId,
        roles: [...m.roles, "TenantAdmin"],
      });
    }
  },
} satisfies SeedMigration;
```

## CLI

```bash
bunx kumiko ops seed:new <slug>    # scaffold seeds/<date>-<slug>.ts
bunx kumiko ops seed:status        # was applied, was pending
bunx kumiko ops seed:apply [--dry-run]  # pending applien (CLI-Pfad in Phase 1.5)
```

## Garantien

| Garantie | Wie |
|---|---|
| **Single-Run** | Marker in `kumiko_es_operations` + `pg_advisory_xact_lock` sequentialisiert Multi-Replica-Boots |
| **Marker-Atomicity** | Runner-Tx + Re-Check inside lock → Marker reflektiert "Run wurde wirklich attempted" |
| **Order** | File-name = chronologische ID; Failure stoppt alle pending |
| **ES-konform** | `systemWriteAs` ruft existing Handler → Events landen im Store |
| **Recovery** | `skippable: true` + `KUMIKO_SKIP_ES_OPS_<ID>=1` env-flag für Notfall-Skip |
| **Boot-skip** | `KUMIKO_SKIP_ES_OPS=1` env-var skipped alle pending (Debug-Boots) |

### Was NICHT garantiert ist

**Seed-Body ist NICHT atomic vs. den Marker.** `systemWriteAs` läuft durch den App-Dispatcher mit dessen eigener Tx-Verwaltung (separat von der Runner-Tx). Wenn ein Seed `systemWriteAs` 5× erfolgreich aufruft und dann throws, sind die 5 Events **committed**, der Marker aber **nicht** geschrieben. Beim nächsten Boot retried der Runner — Seeds müssen daher **idempotent** sein:

```ts
// Gut: skip wenn schon korrigiert
for (const m of memberships) {
  if (m.roles.includes("TenantAdmin")) continue;
  await ctx.systemWriteAs(...);
}

// Schlecht: jeder Re-Run dupliziert
for (const m of memberships) {
  await ctx.systemWriteAs("create-something-new", ...); // double on retry!
}
```

Die meisten realen Seeds sind natürlich idempotent (existing-Lookup → conditional-write). Volle End-to-End-Atomicity (write + marker im gleichen Tx) ist als Phase 1.5 vorgesehen — braucht Refactor wie der Dispatcher die outer-Tx übernimmt.

## Architektur

`packages/framework/src/es-ops/` enthält:

| File | Zweck |
|---|---|
| `operations-schema.ts` | `kumiko_es_operations` table-definition + `createEsOperationsTable` helper |
| `types.ts` | `SeedMigration` + `SeedMigrationContext` Public-API |
| `runner.ts` | `runPendingSeedMigrations` — Diff + Tx + Marker |
| `context.ts` | `createSeedMigrationContext` — Read-Helpers + `systemWriteAs` |
| `index.ts` | barrel-export |

Tabellen-Schema:

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

`operation_type`-Discriminator lässt zukünftige Operations dieselbe Tabelle + dasselbe CLI-Pattern nutzen:

- `projection-rebuild` — TRUNCATE read_* + Replay aus Events
- `event-replay` — Notification re-send ohne DB-Write
- `event-backfill` — Missing-Events für Pre-ES-Daten
- `stream-migration` — Aggregate-Stream-Tenant-Move (Sysadmin-Bug)
- `aggregate-rebuild` — Snapshot-Refresh

Implementation: **on demand** (siehe `kumiko-platform/docs/plans/features/es-ops.md`).

## Driver-Use-Case

publicstatus' admin-Member hatte initial `roles: ["Admin"]`. Sprint Role-Naming-Drift ergänzte „TenantAdmin", aber der idempotent-Seeder skipped existing Memberships → DB-Drift. Phase 1 löst genau diese Klasse von Bugs.

Siehe Sample: `samples/recipes/seed-migration/`.
