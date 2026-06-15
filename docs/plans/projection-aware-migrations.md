---
status: in-progress
verified: 2026-06-15
issue: kumiko-framework#356
next: Phase 2 (#361) + Aktivierung (studio#61) shipped; Phase 3 (#362 rebuild-job + enqueueProjectionRebuild) shipped; #363 (zero-downtime) Phase 1 SHIPPED (Online-Rebuild via Schema-Swap) + Phase 2 SHIPPED (Live-Tail-Catch-up, single-stream, Branch feat/projection-live-tail-363) — offen #363 Phase 3 (Generator additive-prefer/Guardrail) + Phase 4 (Consumer-Wiring); offen außerdem #356-Release-Consumer-Bumps (studio#58-Migration)
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
- [x] Phase 2: safe fail-loud für managed-ohne-Projektion (kein Hard-Throw) — #361 → `runPendingRebuilds(…, {thisRunTables})` meldet in-diesem-Run via Marker geleerte managed-Tabellen ohne auflösbare Projektion als `unresolvedManaged` (error-Log, non-fatal, gedraint); pre-existing/Legacy bleibt benign `unmapped`. Integration 6/6.
  - **Aktivierung SHIPPED (2026-06-15, kumiko-studio#61):** `kumiko-studio/bin/kumiko.ts` (`rebuildPendingProjections`) reicht jetzt `queueRebuildsFromMarkers`-Rückgabe als `thisRunTables` durch + exitet non-zero bei nicht-leerem `unresolvedManaged`. In Prod scharf; #361 + studio#60 CLOSED.
- [x] Phase 3: Single-Run-Job `jobs:job:projection-rebuild` (im `jobs`-Feature registriert, auto-verfügbar wenn jobs komponiert) + framework-Helper `enqueueProjectionRebuild` (dispatch via jobRunner ODER inline-Fallback ohne jobs) — #362. JobRunner injiziert jetzt die registry in jeden job-ctx (JobContext-Contract). Integration: inline + e2e dispatch beide grün.
- [~] blue-green/`ProjectionVersion` (zero-downtime Rebuild) — #363. **Design-Befund + Phase 1 SHIPPED** (s. Sektion „Phase 4 (#363)" unten): query-time-version-routing abgelehnt (Multi-Pod-Kohärenz + kein Query-Context + 14 Raw-SQL-Bypässe); Reframe = Rebuild *vermeiden* via Expand/Contract statt beschleunigen; Framework liefert Mechanismen+Guardrails, nicht End-to-End-Magie; 4-Phasen-Roadmap. **Phase 1 (Online-Rebuild via Schema-Swap) geshippt** — beide Rebuild-Pfade replayen ins `kumiko_rebuild`-Schema + atomarer `SET SCHEMA`-Swap, Live-Tabelle nicht mehr replay-lang gelockt. Phasen 2–4 offen.

PR Phase 1: #360 (CI grün 2026-06-14).

---

# Phase 4 (#363): Zero-Downtime Rebuild — Design & Scope-Befund (2026-06-15)

**Status: Design-Referenz, kein Code.** Recherche + Architektur-Entscheidung festgehalten,
Implementierung bewusst aufgeschoben. Die Issue-Prosa („versioned side-by-side, alte
Version bedient Reads während die neue baut", Marten-`ProjectionVersion`) beschreibt ein
**Ziel**, nicht den gangbaren Weg — die Recherche hat die naheliegende Realisierung
(query-time-version-routing) als zu teuer/fragil verworfen und einen framework-nativen
Pfad freigelegt. Diese Sektion ist die Entscheidungsgrundlage für ein späteres Implementierungs-Go.

## Befund: es gibt keinen Read-Indirektions-Seam

Der physische Tabellenname (`read_<name>`) wird zur **Query-Zeit statisch aus dem
Table-Objekt** aufgelöst und ist ein **eingefrorenes Literal** — keine Indirektion:

- **Einziger typisierter Chokepoint:** `extractTableInfo` (`bun-db/query.ts:223-254`) liest
  `meta.tableName` aus dem Symbol `kumiko:schema:Meta` am Table-Objekt. **Alle** typisierten
  Reads/Writes (`selectMany/selectOne/insertMany/insertOne/updateMany/countWhere/deleteMany`)
  laufen hier durch.
- **Kein Context zur Query-Zeit:** Die Query-Funktionen bekommen nur `(db, table, where)`.
  Registry lebt im `HandlerContext`/`AppContext`, **nicht** in der Query-Signatur. Ein
  Versions-Lookup pro Query bräuchte entweder globalen Mutable-State **oder** einen
  DB-Roundtrip — beides scheidet aus (s.u.).
- **14 Raw-SQL-Bypässe** mit literalem `read_*`-Namen, die jede typisierte Indirektion
  umgehen: **4 System** (`seed-context.ts:26/45/55` read_users/tenant_memberships/tenants,
  `user-data-rights-defaults/.../user-hook.ts:14` read_users), **10 App-Projections**
  (`config/.../resolver.ts:21/38`, `secrets/.../read.ts:12`, `sessions/.../cleanup.ts:10/12`,
  `feature-toggles/.../toggle-state.ts:16`, `custom-fields/.../{quota,user-data-rights,field-access}.ts`,
  `delivery/.../preferences.ts:20`). Alle framework-eigen — also fixbar, aber zusätzlicher Surface.

**Live-Pfad und Rebuild konvergieren** (relevant, weil eine Indirektion beide treffen müsste):
beide schlagen `registry.getAllMultiStreamProjections().get(name)` nach und rufen
`msp.apply[type](event, tx, ctx)` (Live: EventDispatcher `event-dispatcher.ts:464-501` →
`server.ts:386-438`; Rebuild: `msp-rebuild.ts`). Beide sind **in-process testbar**
(`setupTestStack` + `eventDispatcher.runOnce()`, bewiesen in
`pipeline/__tests__/msp-rebuild.integration.test.ts:194-225`). → Live-Tail-Catch-up ist testbar.

## Abgelehnt: query-time-version-routing

Die wörtliche „side-by-side"-Umsetzung bräuchte, dass Reads zur Laufzeit eine **aktive
Version** auflösen. Dagegen sprechen zwei harte Gründe:

1. **Multi-Pod-Kohärenz:** In Prod laufen mehrere Pods. Ein Versions-Flip müsste für
   **alle Pods atomar** sichtbar sein. Ein Prozess-globaler Mutable-State propagiert nicht;
   ein DB-Pointer pro Query ist ein Roundtrip auf dem heißen Read-Pfad.
2. **Kein Query-Context + Raw-SQL-Bypass:** s.o. — der Seam müsste in `extractTableInfo`
   **plus** 14 Raw-Stellen nachgezogen werden. Hoher Blast-Radius gegen das gesamte
   Static-Naming-Design.

→ **Nicht weiterverfolgen.** (Falls je doch nötig: eigenes Architektur-Issue, kein #363-Scope.)

## Reframe: den Rebuild *vermeiden*, nicht beschleunigen

#363s Schmerz ist „managed Change → DROP+CREATE → O(Events)-Replay" (`migrate-generator.ts:304-309`,
Klassifikator `managedChangeRequiresRecreate:212-219`: droppedColumns, ADD `NOT NULL` ohne
Default, neuer UNIQUE, Typ-Änderung, `SET NOT NULL`). Der höchste Hebel ist **nicht**, den
Replay schnell zu machen — sondern ihn gar nicht auszulösen, wo der Change additiv
re-formulierbar ist (Expand/Contract: additives `ALTER` + Online-Backfill, jeder einzelne
Deploy non-destruktiv — wie gh-ost / Rails strong_migrations). Nur der irreduzible Rest
(Apply-Logik-Change, echt non-additive Shape) braucht überhaupt Shadow-Build + Rebuild.

## Scope-Realität (wichtig, war im ursprünglichen Optionsmenü falsch)

**Das Framework kann End-to-End-Zero-Downtime nicht allein liefern.** Ein materieller Teil
ist **App-Author-Disziplin** (destruktive Changes als Expand/Contract über zwei Releases
sequenzieren) + **Consumer/Deploy-Wiring** (wie #361 → studio). Auch der Shadow-Schema-Swap
(früher als „Kern" gedacht) gibt nur „kein leeres Read-Fenster" für Single-Version-Reads,
**nicht** Multi-Pod-Zero-Downtime: nach dem Swap können während eines Rolling-Deploys noch
laufende alte Pods die neue Shape nicht lesen. Framework liefert also **Mechanismen +
Guardrails**, nicht Magie.

## Phasen-Zerlegung (ehrlich als 1..N benannt)

| Phase | Inhalt | Liefert | Testbar |
|---|---|---|---|
| 1 ✅ **SHIPPED** (#363 P1, schema-swap) | **Online-Rebuild-Mechanik:** Shadow-Build im privaten `kumiko_rebuild`-Schema (kanonischer Tabellenname, `search_path`-geroutet) → Replay → atomarer `DROP public.read_foo; ALTER … SET SCHEMA public` in kurzer `ACCESS EXCLUSIVE`-Tx. **Kein** Suffix-Rename (s. „Haupt-Falle gelöst"). | „kein leeres Fenster" für Single-Version-Reads; de-riskt den Rest; unabhängig shippbar | Real-DB, Probe-Read-während-Replay + kanonische Index-Namen + Guard-Units |
| 2 ✅ **SHIPPED** (#363 P2, single-stream) | **Live-Tail-Catch-up:** cursor-paged Drain (`selectEventsForProjectionRebuildBatch`, READ COMMITTED → jeder Batch sieht frisch-committete Events) bis kurzer Batch = Tail, dann `ACCESS EXCLUSIVE`-Fence (`fenceLiveTable`, `lock_timeout`-bounded) + Final-Drain + Swap. **Befund:** Phase-1-Grenze war NICHT ein langes Lock (Replay läuft lock-frei, Lock nur am Swap) — sondern dass single-stream Projections **synchron inline** in der Append-Tx auf die Live-Tabelle schreiben (`projections-runner.ts:54`, `append-event-core.ts:130`), und solche Writes im Replay-Fenster beim Swap verloren gingen. Catch-up schließt das für Single-Pod. **MSP unverändert:** kein inline-apply, `FOR UPDATE` fenced den Dispatcher, Cursor holt den Tail nach dem Swap → kein Write-Loss-Bug. **Cutover-Semantik empirisch (PG18):** ein durch den Fence geblockter Writer re-resolved nach Lock-Freigabe per Namen auf die geswappte Tabelle und committed; append+apply teilen eine Tx → Event und Projection-Row committen/rollen gemeinsam, kein Orphan möglich. | Shadow bleibt unter konkurrierendem Writer aktuell; **kein** Multi-Pod-ZD (alte Pods lesen neue Shape nicht) | In-process: discriminating-Test (Mid-Replay-Write überlebt Swap, via `onBeforeFence`-Seam) + READ-COMMITTED-Anker + Cutover-Primitiv (`fenceLiveTable`+`swapShadowIntoLive`) |
| 3 | **Der echte Tier-2-Kern:** Generator bevorzugt additives `ALTER` + Online-Backfill statt DROP+CREATE; Guardrail, die einen un-gesplitteten destruktiven Change flaggt/ablehnt. | Expand/Contract-Tooling | Unit + Integration |
| 4 | **Consumer/Deploy-Wiring** (studio, wie #361). | App-seitige Aktivierung | integration grün |

## Die Unbekannte, die Phase 3 sizet (vor Commit verifizieren)

Kann `migrate-generator` einen **Multi-Step-Split** (additiv→destruktiv über zwei Releases)
überhaupt ausdrücken — oder ist Expand/Contract ~90% App-Author-Disziplin + eine Guardrail?
Diese eine Tatsache entscheidet, ob Phase 3 **echter Generator-Code** oder **primär
Guard+Docs** ist (und damit den Aufwand). Der heutige Generator ist single-snapshot-diff
(`Snapshot.tables`, `migrate-generator.ts:28`) — ein deploy-übergreifendes additiv→destruktiv-
Sequencing ist darin **nicht** repräsentiert; erste Vermutung daher: Guardrail + Doku-Pattern,
nicht großer Generator-Umbau. **Erst-Schritt jeder Implementierung: das verifizieren.**

## Die Haupt-Falle — gelöst durch Schema-Swap statt Suffix-Rename (Phase 1)

Der ursprünglich geplante Weg (`read_foo__rebuild` + `ALTER … RENAME TO read_foo`) hatte
**zwei** Probleme: (a) `apply(event, tx)` schreibt über das kanonische Table-Objekt — eine
captured Referenz auf `read_foo`, die man nicht auf `read_foo__rebuild` umbiegen kann (das
ist dieselbe Write-Indirektions-Wall, die schon das Query-Time-Version-Routing kippte); und
(b) nach dem RENAME behielten Indizes/PK/Constraints ihre `read_foo__rebuild_*`-Namen, sodass
jedes Folge-`generate` korrigierendes DDL emittiert hätte.

**Beide lösen sich durch den Shadow im eigenen Schema:** die Shadow-Tabelle trägt den
**kanonischen** Namen `read_foo` in `kumiko_rebuild`, `SET LOCAL search_path` lenkt die
Namensauflösung dorthin (Apply bleibt unangefasst), und Indizes entstehen mit kanonischen
Namen — `SET SCHEMA public` verschiebt sie intakt. Kein Rename, keine Namens-Kollision.
Verifiziert via Test „kanonische Index-Namen nach Swap" (statt nur Row-Count).

## Sub-Frage Distributed-Lock — erledigt durch bestehenden Row-Lock (Phase 1)

`rebuildProjection`/`rebuildMultiStreamProjection` serialisieren konkurrierende Rebuilds
derselben Projektion bereits über den Row-Lock auf der State-/Consumer-Row
(`markProjectionRebuilding` = `INSERT … ON CONFLICT DO UPDATE`, bis Commit gehalten;
`selectConsumerForUpdate` = `FOR UPDATE`) — PG-Row-Locks wirken cross-Connection, also
cross-Pod. Das geteilte `kumiko_rebuild`-Schema kollidiert auch zwischen verschiedenen
Projektionen nicht (distinkte Tabellennamen). Kein zusätzlicher Advisory-Lock nötig.
