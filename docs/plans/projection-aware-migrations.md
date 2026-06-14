---
status: in-progress
verified: 2026-06-14
issue: kumiko-framework#356
next: PR #356 (Generator-Split + Beweis) reviewen/mergen/releasen; Phase 2 (safe fail-loud) + Phase 3 (rebuild-job) als Folge-Issues; studio#58-envelope-Frage vor Consumer-Bump klären
---

# Projection-aware migrations: managed = wegwerfbares Derivat, unmanaged = echte Daten

**Issue:** kumiko-framework#356. **Präzisor:** [[migrate-generator-ride-along-columns]]
(#347) bringt den Generator dazu, die volle `read_tenant_secrets`-DDL zu emittieren —
inkl. `envelope NOT NULL` **ohne** Default + uniqueIndex. Genau diese additive DDL
**stirbt an Bestands-Rows** einer befüllten Projektion, obwohl dieselbe Migration
einen Rebuild queued, der die Rows eine Zeile später eh verwirft. #356 macht die
DDL überlebbar. Memory-Anker: [[unsafepushtables_masks_migration_gap]].

**Motivierende Blocker:**
- **kumiko-studio#58** — envelope-Spalten an befülltem `read_tenant_secrets`; BLOCKED,
  weil `envelope NOT NULL` ohne Default am Bestand scheitert.
- **publicstatus#116** — lief nur, weil die prod-Tabelle (1 verwaiste Row) quasi leer war.

## Der eigentliche Befund (Kategorienfehler)

Der Generator wendet die additive-ALTER-Strategie **uniform** auf alle Tabellen an.
Das ist der Fehler. Wir haben **Event Sourcing** — der Event-Stream (`kumiko_events`)
ist die einzige Source of Truth. Daraus folgt eine harte Zweiteilung, die kumiko
**bereits kodiert** in `EntityTableMeta.source`:

| `source` | Herkunft | Natur | richtige Migrations-Strategie |
|---|---|---|---|
| **`managed`** | `r.entity(...)` | **Derivat** des Event-Streams (jede `r.entity()` hat eine implizite Projektion) — jederzeit aus Events rekonstruierbar, **wegwerfbar** | Schema aus Definition; in-place wenn gefahrlos möglich, sonst **DROP+CREATE + Rebuild** |
| **`unmanaged`** | `defineUnmanagedTable(...)` | **echte, nicht-abgeleitete Daten** ("App trägt Verantwortung") | **additive ALTER** + `-- DESTRUCTIVE`-Kommentare (heutiges Verhalten) |

Das `NO-MAGIC-ON-DATA`-Prinzip (`migrate-runner.ts:4-15`) ist **korrekt für `unmanaged`**
und ein **Kategorienfehler für `managed`**. Bei Derivaten verteidigen wir Daten an der
DDL-Grenze, die das System unmittelbar danach durch Replay ersetzt.

## Prior Art — Marten (.NET, ES auf Postgres)

Marten validiert exakt diese Sicht (Recherche 2026-06-14, martendb.io):
- **Schema aus Code**, keine Hand-Migrations für Read-Models. DDL-Diff automatisch:
  *additiv wenn möglich* (`ADD COLUMN`), **DROP+Replace nur wenn additiv nicht geht**.
- Form-Änderung einer Projektion → **expliziter Rebuild** (Async Daemon: teardown + Replay).
- Zero-Downtime via **`ProjectionVersion`**: neue Version baut side-by-side im Hintergrund
  aus dem Stream, dann Swap, alte Tabelle weg.
- **Philosophie:** Projektions-Tabellen sind *wegwerfbare Derivate* des Event-Streams —
  *deshalb* ist DDL-aus-Code dort ok, im Gegensatz zu echten Daten-Tabellen.

**Unser Vorteil gegenüber Marten:** Wir machen das DROP+CREATE **nicht** zur Laufzeit
(DDL-aus-Code), sondern emittieren es in **committed, reviewbares, checksumm-getracktes
SQL**. Marten-Semantik *plus* Review-/Drift-Erkennung.

## Design

### Verifizierte Grundlage
`Snapshot.tables: readonly EntityTableMeta[]` (`migrate-generator.ts:28`) speichert die
**volle Meta inkl. `source`** und liegt im committed `snapshot.json`. Heißt: der
managed/unmanaged-Split ist eine **reine Generate-Zeit-Entscheidung** — **keine**
Registry-Awareness nötig (löst den "is-Projektion-nur-beim-Apply"-Knoten), **kein**
DDL-aus-Code zur Laufzeit, Apply bleibt dumm (führt SQL aus).

### Teil A — Generator nach `source` splitten

`renderMigrationSql` (`migrate-generator.ts:250`) verzweigt pro changed Table auf `source`:

- **`unmanaged`** → unverändert: `renderAddColumn` / `renderColumnChange` + `-- DESTRUCTIVE`-Kommentare.
- **`managed`** →
  - Änderung **in-place gefahrlos** (nullable ADD mit/ohne Default, neuer Index,
    Typ-Erweiterung) → additive ALTER, **kein** Rebuild (billig, kein Replay).
  - Änderung **in-place unsicher** (`NOT NULL` ohne Default, UNIQUE auf möglichen Dups,
    Typ-Verengung, Spalten-Rename, Spalten-Drop) → **`DROP TABLE` + `CREATE TABLE`
    (neue Form aus der Meta)** + Rebuild-Marker. Löst add-NOT-NULL / unique / type /
    **rename** / drop **einheitlich** (Rename ist sonst strukturell unmöglich — der
    additive Generator kann nur drop-alt + add-neu, nie `RENAME COLUMN`).

`TableDiff` (`migrate-generator.ts:38`) bekommt ein Feld `source` durchgereicht
(`diffOneTable` hat beide Metas). `newTables` tragen die Meta (inkl. `source`) bereits.

`rebuildTablesFromDiff` (`rebuild-marker.ts:41`) bleibt das Marker-Kriterium, erweitert:
jede **managed** Tabelle, die DROP+CREATE'd wird, kommt in den Marker (sicher, weil
managed ⟹ rebuildbar). unmanaged nie.

### Teil B — Rebuild-Helper als Single-Run-Job

Antwort auf die "leere Projektion"-Kante **und** auf die heutigen Trigger-Lücken
(kein dedizierter manueller Rebuild; Upcaster-Change triggert nichts). Baut auf dem
`jobs`-Bundled-Feature: jede Ausführung schreibt `run-started/completed/failed` →
`read_job_runs` (+ Dauer) + `read_job_run_logs`, plus `jobs:write:trigger` (manuell)
und `jobs:write:retry`.

- Framework registriert (wenn `jobs`-Feature komponiert) eine Job-Definition
  `kumiko:projection-rebuild`, deren Worker `rebuildProjection(payload.projection, {db, registry})` ruft.
- Helper `enqueueProjectionRebuild(projection)` triggert einen **Single-Run** dieses Jobs.
- **Fallback ohne `jobs`-Feature:** synchroner `rebuildProjection` inline (heutiges Verhalten).

Damit:
1. **Empty-Projection-Recovery:** statt fail-loud → getrackten, retrybaren Rebuild-Job
   anlegen. (Anmerkung: der Normalfall ist ohnehin gedeckt — managed ⟹ implizite
   Projektion ⟹ der Apply-Rebuild füllt. Der Job ist die Self-Service-Reparatur.)
2. **Manueller Rebuild** (Lücke Q4): `enqueueProjectionRebuild("name")` als first-class Trigger.
3. **Post-Upcaster-Rebuild** (Lücke Q2): nach Upcaster-Change manuell denselben Job triggern
   (Auto-Trigger via Logik-Versions-Hash bleibt eigenes Feature, nicht hier).

### Apply-Pfad (unverändert in der Mechanik)
`runMigrations` bleibt **registry-frei und pur** (`migrate-runner.ts`). Das DROP+CREATE
steht im committed SQL → der Runner führt es nur aus. Der App-Orchestrator
(`kumiko-studio/bin/kumiko.ts` → `rebuildPendingProjections`) füllt danach via Replay,
wie heute. Kein Eingriff in die Runner-Reinheit, kein Apply-Zeit-Truncate-Hack.

## Invarianten & Kanten

- **managed ⟹ rebuildbar:** jede `r.entity()` erzeugt eine implizite Projektion
  (`pushEntityProjectionTables` "one per r.entity()"). Den heutigen *silent-skip* für
  unmapped Tabellen (`pending-rebuilds.ts:108-109`) **für managed auf fail-loud** heben:
  managed Tabelle ohne auflösbare Projektion = fehlendes Feature in der Komposition →
  laut scheitern statt stille leere Tabelle.
- **Scope-Grenze (Events müssen das Feld tragen):** Rebuild rekonstruiert nur, was im
  Stream steht. Trägt `secret.created` das `envelope`-Feld **nicht** (offene studio#58-Frage),
  scheitert der Replay-INSERT an `NOT NULL` → das ist eine **Daten-Migration/Backfill**,
  **kein** Schema-Fall, den #356 löst. **#356 löst den ride-along-Fall** (Spalte fehlt,
  Events haben sie längst). Vor "studio#58 entblockt" diese Frage verifizieren.
- **Replay-Kosten:** DROP+CREATE erzwingt O(Events)-Replay je managed-Schema-Change.
  Bei großen Streams Wartungsfenster. Gegenmittel = Martens `ProjectionVersion` /
  blue-green-async → **eigenes Folge-Issue**, nicht hier.
- **Migration-Immutability:** das pending (nie erfolgreich applizierte) studio#58-File
  wird mit #356 als DROP+CREATE **regeneriert** — kein Immutability-Bruch, da es nie
  applied wurde. Bereits applizierte Files nie anfassen.

## Build-Sequenz

| Phase | Inhalt | Validierung |
|---|---|---|
| 1 | Teil A: `source` durch `TableDiff` reichen; `renderMigrationSql` managed/unmanaged-Split; in-place-safe vs DROP+CREATE-Klassifikation; `rebuildTablesFromDiff` für managed-DROP+CREATE | Unit (Generator) |
| 2 | managed-ohne-Projektion → fail-loud (`runPendingRebuilds`) | Unit + Integration |
| 3 | Teil B: `kumiko:projection-rebuild`-Job-Definition + `enqueueProjectionRebuild` + Inline-Fallback ohne jobs-Feature | Integration (mit + ohne jobs) |
| 4 | Integration end-to-end: befüllte managed-Projektion + add-NOT-NULL/rename → DROP+CREATE appliziert + Replay füllt; unmanaged add-NOT-NULL bleibt additiv+DESTRUCTIVE | echt, kein Fake |
| 5 | Changeset (minor, **nicht** breaking: bisher fehlschlagende managed-Migrations laufen jetzt). **RELEASE-FALLE:** Bot-PR close/reopen | Release-PR grün, npm live |
| 6 | Consumer-Bumps (studio/publicstatus): studio#58-Migration regenerieren; **vorher** secret.created-envelope-Frage klären | integration grün |

## Entscheidungen (2026-06-14)

- **(a) GEWÄHLT:** managed-Strategie = **additiv-wenn-gefahrlos, sonst DROP+CREATE**
  (Marten-Stil, spart Replays). Klassifikator "in-place unsicher" = droppedColumns,
  ADD `NOT NULL` ohne Default, neuer UNIQUE-Index, `SET NOT NULL`, Typ-Änderung.
- **(b) GEWÄHLT:** blue-green/`ProjectionVersion` = **eigenes Folge-Issue** (nicht hier).

## Risiken / Anker

- **Release-Falle** [[changesets_bot_pr_needs_reopen]]: Bot-PR triggert keine CI; auto-merge neu armen.
- **Worktree-Regen bootet MAIN** [[yarn_install_at_root_not_worktree]]: bun resolved `@cosmicdrift`
  auf MAIN-Checkout, nicht Worktree → Snapshot/Manifest-Regen via temp-gen-script-Workaround.
- **Consumer prod-Konsistenz**: studio#58 ist BLOCKED, also pending — sauberes Regenerieren.
  publicstatus#116 lief bereits (quasi-leer); kein divergierendes File für dieselben Spalten.
- **fail-loud-Verschärfung** darf bestehende Apps nicht beim Apply brechen — greift nur für
  **managed** Tabellen, die DROP+CREATE'd werden und keine Projektion auflösen (echter Defekt).

## Re-Scope (2026-06-14, nach Advisor-Review)

Der Advisor hat zwei Risiken aufgedeckt, die Phase 2/3 aus diesem PR lösen:

1. **Phase 2 fail-loud als Hard-Throw bricht heutige Deploys.** Bereits committed
   Marker (vom alten `rebuildTablesFromDiff`, das auch unmanaged markierte) → beim
   Apply unmapped → Throw → sticky-stuck (Migration ist getrackt, läuft nicht neu).
   Plus Komposition-Drift (Feature aus App entfernt). → fail-loud darf **nicht**
   hart werfen; eigenes Folge-Issue (loud-but-non-fatal, oder Throw nur für
   *in-diesem-Run* DROP+CREATE'te Tabellen).
2. **DROP+CREATE ist irreversibel** und gefährlicher als die alte fail-safe-ALTER,
   wenn die Events das Feld nicht tragen → studio#58 hängt an `secret.created`-
   envelope; vor Consumer-Bump verifizieren.

→ **Dieser PR = Phase 1 (Generator-Split) + Integration-Beweis.** Phase 2 + 3 +
blue-green = Folge-Issues. Hält's leichtgewichtig und de-risked den Kern.

## Verifikation (2026-06-14)

- Unit: migrate-generator + rebuild-marker 23/23 (managed DROP+CREATE für
  NOT-NULL/rename, additiv für nullable-add, unmanaged unverändert, managed-only-Marker).
- tsc -b EXIT=0, biome clean.
- Integration (test-pg 15432): **managed-recreate Beweis** — generierter DROP+CREATE
  appliziert auf befüllter 2-Row-Projektion → Tabelle neu (envelope-Spalte) + geleert.
  Rebuild-Refill: pending-rebuilds.integration 3/3. Regression: schema-cli +
  kumiko-drift + pending-rebuilds 27/27, keine Drift.
- FK-Check: keine `REFERENCES read_*` in studio/publicstatus-Migrations → DROP TABLE
  trifft keine FK-Dependents.

## DoD

**PR #356 (dieser Branch):**
- [x] Generator splittet nach `source`; managed-unsafe → DROP+CREATE+Marker, unmanaged → additive ALTER
- [x] `rebuildTablesFromDiff` managed-only inkl. Recreate-Fälle
- [x] Tests echt: managed DROP+CREATE (add-NOT-NULL **und** rename), unmanaged unverändert, managed-only-Marker, populated-table-apply-Beweis
- [x] Changeset (minor)
- [ ] framework released (changeset, npm); Consumer-Bumps grün; **studio#58-envelope-Frage geklärt** vor Bump
- [ ] Frontmatter `status: shipped` + evidence (PR#) + STATUS.md regen

**Folge-Issues (angelegt 2026-06-14):**
- [ ] Phase 2: safe fail-loud für managed-ohne-Projektion (kein Hard-Throw) — #361
- [ ] Phase 3: `kumiko:projection-rebuild`-Single-Run-Job + `enqueueProjectionRebuild` + Inline-Fallback — #362
- [ ] blue-green/`ProjectionVersion` (zero-downtime Rebuild) — #363

PR Phase 1: #360 (CI grün 2026-06-14).
