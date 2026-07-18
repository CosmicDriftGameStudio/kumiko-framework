# es-ops

ES-Operations für Kumiko-Apps. Phase 1+1.5 liefert `seed-migrations` als file-basiertes Diff-and-Apply für Aggregate-State-Updates, die idempotent-Seeder nicht erfassen können.

> **Phase 1 vs 1.5:** Phase 1 hatte den Foundation-Code, Phase 1.5 hat den ersten realen Driver-Use-Case durch (publicstatus admin-roles) und brachte: `tenantIdOverride` für Tenant-scope-Aggregates, Dry-Run-Validator für Handler-QNs, Deploy-Doku, lokales Smoke-Pattern. Pflicht-Lesen: [Retro](../../../../kumiko-platform/docs/plans/features/es-ops-phase1-retro.md).

## Quick API

```ts
import { runProdApp } from "@cosmicdrift/kumiko-server-runtime";

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
      await ctx.systemWriteAs(
        "tenant:write:update-member-roles",
        { userId: admin.id, tenantId: m.tenantId, roles: [...m.roles, "TenantAdmin"] },
        m.streamTenantId, // ← tenantIdOverride aus dem JOIN auf kumiko_events.v1
      );
    }
  },
} satisfies SeedMigration;
```

### Wann brauche ich `tenantIdOverride`?

Faustregel: **wenn das Ziel-Aggregate via Tenant-User erstellt wurde, brauchst Du den Override.**

| Aggregate-Typ | Stream-Tenant | `tenantIdOverride` |
|---|---|---|
| config-values (system-scope) | SYSTEM_TENANT | weglassen |
| system text-content | SYSTEM_TENANT | weglassen |
| tenant-membership | jeweiliger Stream-Tenant aus events.v1 | ✅ `m.streamTenantId` (NICHT `m.tenantId` — die beiden können divergieren!) |
| App-Entity (orders, tasks, …) | Tenant-Stream | ✅ Tenant-Id aus dem Lookup |

**Warum nicht `m.tenantId`?** read_tenant_memberships.tenant_id ist der payload-tenant (logisches Mitgliedschafts-Ziel), kumiko_events.tenant_id der v1-Row ist der stream-tenant (wo das Aggregate physisch lebt). seedTenantMembership mit `by=systemAdmin` lässt die zwei auseinanderlaufen — der Helper `findMembershipsOfUser` liefert beide getrennt, damit Seeds den richtigen wählen können.

Ohne `tenantIdOverride` sucht der Executor den Stream gegen SYSTEM_TENANT → `version_conflict`. Memory: `feedback_event_store_tenant_consistency.md`.

## Deployment-Anforderungen

Wichtig — wird gerne übersehen:

### Docker / Bun-Bundle

Seeds werden zur Runtime via `await import(absolutePath)` geladen. Bun's Bundler strippt dynamic-import-Targets → seeds/-Tree muss **als raw-TS-Tree** ins Image kopiert werden:

```dockerfile
# Nach dem dist-server/-COPY:
COPY --from=build --chown=app:app /app/seeds ./seeds
```

Plus: in der `bun build` Stage NICHT mit `--minify` durch die seed-Files laufen (sie sind keine Eingabe — der Bundler bundlet `bin/main.ts`, nicht das seeds-Verzeichnis).

### Idempotenz-Pflicht

Seed-Body läuft **NICHT** atomic mit dem Marker (siehe „Was NICHT garantiert ist" unten). Wenn ein Seed mid-way thrown wirft, sind die schon committed Events drin, der Marker aber nicht → Retry beim nächsten Boot. **Seeds müssen idempotent sein.**

Standard-Pattern:
```ts
const memberships = await ctx.findMembershipsOfUser(adminId);
for (const m of memberships) {
  if (m.roles.includes("TenantAdmin")) continue; // ← check-then-write
  await ctx.systemWriteAs(...);
}
```

Anti-Pattern (NICHT idempotent):
```ts
for (let i = 0; i < 5; i++) {
  await ctx.systemWriteAs("create-something", { ... }); // ← Re-Run produziert Duplikate
}
```

### Multi-Replica-Boot

`pg_advisory_xact_lock` sequentialisiert parallele Pod-Boots. Lock-Key ist global (`0x65736f70` / „esop"), nicht migration-spezifisch → bei N pending Migrationen läuft N-mal sequentiell, nicht parallel. Für die typische seed-Migration-Workload ist das schnell genug; bei sehr langen Migrationen (>30s) auf einem Multi-Replica-Stack: erst manuell als CLI-Step laufen lassen (`bunx kumiko ops seed:apply`), dann Pod-Rollout.

### Lokaler Smoke vor Push

Pflicht-Pattern: bevor Du seeds in main pushst, einmal lokal gegen Dev-DB den Boot-Loop laufen lassen. Siehe `samples/recipes/seed-migration/scripts/smoke.ts` als copy-paste-Template.

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
