# Seed-Migration

File-based migrations for Event-Sourcing operations — the drizzle-migrate equivalent for aggregate-state-changes after the initial seed.

## What it shows

- **`seedsDir`-Option** in `runProdApp({ seedsDir: "./seeds" })` — beim Boot werden pending Files in chronologischer Reihenfolge angewendet und in `kumiko_es_operations` markiert.
- **`SeedMigration`-Interface** — default-Export einer seed-File mit `description` + `run(ctx)`. ctx liefert `systemWriteAs` (System-User bypassed Access-Check) + Read-Helpers (`findUserByEmail`, `findMembershipsOfUser`, `findTenants`).
- **Idempotency** — Marker landet nach Erfolg in der Tracking-Tabelle, zweiter Boot skipped applied Seeds.
- **Tx-Atomicity** — Jede Migration läuft in eigener Transaction; Failure rollt zurück + bricht Boot ab (kein Partial-Apply).
- **Chronologische File-IDs** — Filename `<date>-<slug>.ts` (z.B. `2026-05-20-fix-admin-roles.ts`) ist die ID. Drizzle-Style.

### Phase 1.5 hinzugefügt

- **`tenantIdOverride`** in `ctx.systemWriteAs(qn, payload, tenantId)` — Pflicht wenn das Aggregate in einem Tenant-Stream lebt (sonst `version_conflict`).
- **Dry-Run-Validator** — Runner parsed seed-files vor Run + checked alle handler-QNs gegen registry. camelCase-typos & andere QN-Drift werden BEFORE the write erkannt.
- **`scripts/smoke.ts`** — copy-paste-Template für lokalen Pre-Push-Smoke. Bun-runnable, validiert Module-Load + QN-Resolution + Access offline. **Pflicht-Pattern vor Push.**
- **Docker-COPY-Pflicht** dokumentiert in `framework/src/es-ops/README.md`.

## Lokaler Smoke vor Push (Pflicht)

```bash
# Im App-Root:
bun samples/recipes/seed-migration/scripts/smoke.ts --seeds-dir ./seeds
```

Erwarteter Output:
```
seed: 2026-05-20-fix-admin-roles.ts
  ✓ loads: "ergänze TenantAdmin-Rolle"
  ✓ "tenant:write:update-member-roles" registered + accessible

✓ all 1 seed-file(s) pass smoke.
```

Bei typo / drift fail-t mit klarer message + exit-code 1 — CI nutzt es als prä-build-step. App-Author muss in `smoke.ts` den `features`-Array gegen die eigene App-Feature-Set tauschen (siehe TODO im File).

## When to reach for it

Du hast einen idempotent-Seeder der bei initialer Erstellung „Insert wenn nicht existiert" macht (z.B. `auth.admin.memberships`), und dann ändern sich die Soll-Daten — neue Rolle, anderer Tier, korrigierte Bezeichnung. Idempotent-Seeder skippen die existing Rows → DB driftet vom Code-Stand ab.

Seed-Migrations sind der saubere Fix: ein File schreibt das gewünschte Update einmalig in den Event-Store, Projection läuft automatisch.

## Don't reach for it when

- **Initial Seeding** (erste Daten beim leeren Stack). Dafür gibt es `r.config({seeds})` + `options.seeds`-Array — idempotent-by-design durch deterministische Aggregate-IDs.
- **Schema-Migrations**. Dafür gibt es `kumiko schema generate` (neu) bzw.
  `kumiko migrate generate` (Legacy-Apps mit `drizzle/`). Seed-migrations sind
  Data-Layer, nicht Schema-Layer.
- **Read-only Operationen / Reports**. Dafür gibt es App-spezifische Routes / Queries.

## How it works

1. Bei `runProdApp`-Boot scannt das Framework `seedsDir` nach `*.ts`-Files.
2. SELECT `id` FROM `kumiko_es_operations` WHERE `operation_type='seed-migration'` → applied-Set.
3. Pending = files-on-disk **minus** applied-set, sortiert chronologisch.
4. Pro pending: Tx auf, `migration.run(ctx)` (kann beliebige Handler via `systemWriteAs` rufen), Marker einfügen, Tx commit.
5. Failure → Tx rollback, kein Marker, Boot bricht ab. Operator fixt + Retry.

## CLI

```bash
# Scaffold neue Migration mit Datum-Prefix
bunx kumiko ops seed:new fix-admin-roles
# → seeds/2026-05-20-fix-admin-roles.ts

# Was applied, was pending
bunx kumiko ops seed:status

# (Phase 1.5) Direct apply ohne Boot
bunx kumiko ops seed:apply [--dry-run]
```

## Skippable im Notfall

Wenn eine kaputte Migration den Boot blockiert: setze `skippable: true` im seed-File und beim nächsten Boot `KUMIKO_SKIP_ES_OPS_<sanitized-id>=1` env-var. Marker wird nicht geschrieben → beim nächsten Boot ohne Flag würde der Seed wieder laufen. NICHT als Standard-Workflow — Recovery-only.

## See also

- **Plan-Doc:** `kumiko-platform/docs/plans/features/es-ops.md` — Phase-2+ Operations (projection-rebuild, event-replay, stream-migration, ...)
- **Driver-Use-Case:** publicstatus `seeds/2026-05-20-fix-admin-roles.ts` (Branch `feat/es-ops-driver-admin-roles`)
