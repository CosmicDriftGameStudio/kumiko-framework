---
status: in-progress
verified: 2026-06-13
issue: kumiko-framework#347
next: Part 1 (backing-table-Mechanismus) implementieren, dann Layer 3 + Tests + Release
---

# migrate-generator: Ride-along-Spalten unsichtbar → prod-500

**Issue:** kumiko-framework#347. **Vorgeschichte:** publicstatus#116 musste in prod
eine Hand-Migration `0007_fix-secrets-table-columns.sql` nachschieben, weil
`read_tenant_secrets` die Spalten `envelope`/`metadata`/`last_rotated_at` + den
uniqueIndex nicht hatte — der Migrations-Generator hatte sie nie emittiert.
Memory-Anker: [[unsafepushtables_masks_migration_gap]].

## Root Cause

`collectTableMetas` (Quelle für `kumiko schema generate`) baut die DDL pro Entity
über `buildEntityTableMeta(name, entity)` — **rein aus `entity.fields`**. Spalten
und Indexe, die nur auf einem separaten Drizzle-`table()`-Objekt für dieselbe
physische Tabelle leben ("ride-along columns"), sind dadurch unsichtbar. Tests
maskieren das, weil `setupTestStack`/Integration-Tests das volle Drizzle-Table
direkt via `unsafePushTables` pushen → grüner Test, kaputtes prod.

**Warum nicht "Felder vervollständigen":** Das Field-DSL kann die secrets-Spalten
nicht ausdrücken — `jsonb`-Felder emittieren immer `NOT NULL DEFAULT '{}'::jsonb`,
aber `envelope` ist `NOT NULL` **ohne** Default; kein Field-Type emittiert
`DEFAULT now()` für `last_rotated_at`. Diese Expressiveness-Lücke ist genau der
Grund, warum die reiche Table als separates Objekt existiert. → Table-as-truth.

**Empirisch verifiziert (2026-06-13):** `asEntityTableMeta(tenantSecretsTable)`
liefert bereits die volle Meta (alle Spalten + `read_tenant_secrets_tenant_key_unique`).
Der `table()`-Builder ist also korrekt; es fehlt nur der Pfad, der dieses Objekt
in Generator + Implicit-Projection + Test-Push einspeist.

## Audit (Release-Scope)

| Feature | Befund | Fix |
|---|---|---|
| **secrets** `tenant-secret` | entity [key, kekVersion]; table hat zusätzlich envelope/metadata/last_rotated_at + uniqueIndex. Spalten **nicht** im DSL ausdrückbar. | backing-table-Mechanismus |
| **delivery** `notification-preference` | Spalten matchen die Felder, aber `uniqueIndex(tenant,user,type,channel)` lebt nur auf der Hand-Table — **im DSL ausdrückbar** (alle 4 sind Feld/Basis-Spalten). | `indexes` ans Entity |
| channel-in-app `inAppMessages` | Seitenbefund: scheinbar gar nicht via r.entity/r.unmanagedTable/r.projection registriert → andere Bug-Klasse. | separates Issue (verifizieren) |

Alle übrigen bundled-features deklarieren ihre Indexe via `entity.indexes` und nutzen
`buildEntityTable` → kein Ride-along.

## Design

### Part 1 — Generator/Collection (Table-as-truth)

1. **Registration-Site-API:** `r.entity(entityName, definition, options?: { table?: PgTable })`.
   Der live Drizzle-PgTable gehört NICHT ins plain-data `EntityDefinition` — er wird
   als paralleler `entityTables: Record<string, unknown>` auf der `FeatureDefinition`
   geführt.
2. **`collectTableMetas` Pass 1:** wenn das Feature für ein Entity eine backing-table
   trägt → `asEntityTableMeta(table)` als DDL-Wahrheit; sonst `buildEntityTableMeta`.
   **Superset-Validierung:** jede feld-abgeleitete Spalte MUSS auf der backing-table
   mit gleichem pgType/notNull existieren; Feld ohne Spalte oder Type-Mismatch → throw
   (fängt die inverse Drift).
3. **`registry.buildImplicitProjection`:** nutzt die backing-table statt
   `buildEntityTable(entity)`, wenn vorhanden → Executor (flatData-Writes), rebuild,
   secrets-context-Reads und Test-Push teilen sich **EIN** Table-Objekt für
   `read_tenant_secrets`. Stellt die #255-Invariante wieder her (generate == push aus
   derselben Quelle).
4. **secrets/feature.ts:** `r.entity("tenant-secret", tenantSecretEntity, { table: tenantSecretsTable })`.
5. **delivery:** `indexes`-Deklaration ans `notificationPreferenceEntity` (kein
   backing-table nötig — der Index ist DSL-ausdrückbar).

### Part 2 — Drift Layer 3 (column-diff)

`detectKumikoDrift` (`migrations/kumiko-drift.ts:13`, bisher unimplementiert):
pro Snapshot-Table, die existiert, die **live-DB-Spalten** gegen die snapshot-
ColumnMeta prüfen. Fehlende Spalte → `missingColumns`-Report → `SchemaDriftError`
beim Boot statt runtime-500. Neue schema-inspection `columnsOf(db, tableName)`.

**Kopplung an Part 1 (subtil):** der prod-Bug war thin-snapshot + thin-DB +
rich-code-Erwartung → Layer 3 hätte ihn NICHT gefangen (snapshot == DB). Layer 3
fängt die Klasse erst, **nachdem** Part 1 den Snapshot reich macht. Der Layer-3-Test
muss daher eine genuin unvollständige DB gegen einen reichen Snapshot fahren und
beweisen, dass der Boot mit `SchemaDriftError` failt (nicht mit 500).

### Part 3 — Tests

- `collectTableMetas([secretsFeature])` → `read_tenant_secrets`-Meta enthält
  envelope/metadata/last_rotated_at + uniqueIndex, **und** ist identisch zur Quelle,
  die der Test-Push zieht (load-bearing: generate und push dürfen nicht driften).
- Superset-Validierung wirft bei Feld-ohne-Spalte / Type-Mismatch.
- delivery: generiertes Meta enthält `read_notification_preferences_unique`.
- Layer 3: reicher Snapshot vs. unvollständige DB → `SchemaDriftError`.

## Build-Sequenz

| Phase | Inhalt | Validierung |
|---|---|---|
| 1 | r.entity-backing-table + collectTableMetas + registry + secrets/delivery-Wiring | `bun run check` (framework), bestehende secrets/delivery-Integration grün |
| 2 | Drift Layer 3 column-diff + columnsOf | neue Unit/Integration-Tests |
| 3 | Part-3-Tests (alle echt, kein Fake) | grün |
| 4 | Changeset (minor) → Release (**RELEASE-FALLE:** Bot-PR close/reopen) → npm | Release-PR grün, npm live |
| 5 | Consumer-Bumps (publicstatus/studio) — bei Bump die alte Hand-Migration ps#116 0007 gegen den neuen Generator-Output abgleichen | integration grün |

## Risiken / Anker

- **Release-Falle** [[changesets_bot_pr_needs_reopen]]: Bot-PR triggert keine CI.
- **Manifest/Snapshot-Regen aus Worktree** bootet MAIN-Checkout-Code (bun resolved
  `@cosmicdrift` auf MAIN, nicht Worktree) → relative-import-temp-gen-script-Workaround.
- **publicstatus prod hat bereits** die Hand-Migration 0007 — der neue Generator darf
  KEINE divergierende Migration für dieselben Spalten erzeugen, sonst Checksum/Drift.
  Bei Consumer-Bump prüfen: regeneriert er konsistent oder no-op?
- **Superset-Validierung** darf bestehende Apps nicht beim Boot brechen — sie greift
  nur für Entities MIT backing-table (opt-in), also nur secrets initial.

## DoD

- [x] r.entity-backing-table-Mechanismus + Superset-Validierung; secrets verdrahtet
- [x] collectTableMetas + buildImplicitProjection nutzen backing-table (eine Quelle)
- [x] delivery: uniqueIndex via backing-table (statt entity.indexes — eine Quelle, kein redundanter tenant_id_idx); Generator emittiert ihn
- [x] Drift Layer 3 column-diff; fehlende Spalte → SchemaDriftError beim Boot
- [x] Tests: generate==push-Quelle, Superset-throw, delivery-index, Layer-3-Boot-Fail — alle echt, grün
- [ ] framework released (changeset, npm), Consumer-Bumps grün, ps#116-Migration konsistent
- [ ] Frontmatter `status: shipped` + evidence (PR#s) + STATUS.md regen

## Verifikation (2026-06-13, vor Release)

- framework Unit 1349/0; FeatureDefinition-Consumer (dev-server/dispatcher-live/headless/bundled-features) 886 pass (1 fail+1 error = pre-existing renderer-Export-Drift `useExtensionFormSubmit`/`DataTableRowActionMode`, NICHT in diesem Diff — byte-identisch zu origin/main).
- secrets+delivery Integration 57/0; Drift Layer 3 Integration 10/0; implicit-projection-equivalence + rebuild + stack 28/0; boot-seed-contract 3/0.
- framework tsc -b clean; biome clean (13 Files); schema-check-Gate ✓ no drift; generate.ts idempotent (kein Diff — baut aus Feldern, unberührt).
- **Pre-existing main-Drift:** root `tsc -b` + ein custom-fields/web-Test sind auf origin/main rot (renderer-Export-Rename, fremde in-flight-Arbeit). Nicht #347; ggf. CI-Vorsicht ([[ci_merge_preview_main_drift]]).
