---
status: in-progress
verified: 2026-07-17
next: alle Kandidaten (4-8) abgearbeitet — PR #1089/#1090/#1094 review/merge abwarten, dann Serie abschließen
issue: kumiko-framework#1082
---

# Public-API-Konsolidierung — FeatureRegistrar (`r.*`)

## Kontext

Die `r.*`-FeatureRegistrar-DSL im Kumiko-Framework ist iterativ gewachsen und
enthält an mehreren Stellen zwei Wege zum gleichen Konzept. Zwei unabhängige
Analyse-Docs (siehe Verlauf im internen Plan) haben die Kandidaten gescannt
und priorisiert. Pre-1.0-Status (`docs/reference/stability-policy.md`) macht
Breaking Changes jetzt am billigsten — nach 1.0 braucht jede Änderung ein
Deprecation-Fenster.

## Umgesetzt / verworfen

- **`r.crud` vs. `registerEntityCrud`:** geprüft, **kein Merge**. `r.crud`
  ist die dokumentierte, in 6+ Doku-Seiten eingebettete Teaching-Surface
  (`samples/recipes/basic-entity`) — Löschen hätte die App-Author-API
  verschlechtert. Stattdessen offener Folgepunkt: 23 Sample/App-Stellen
  rufen `registerEntityCrud` direkt statt der kürzeren `r.crud`-Form —
  eigene Migration, getrackt in kumiko-framework#1084.

## Wichtiger Fund — betrifft die gesamte restliche Roadmap

Jede verbleibende Registrar-Methoden-Zusammenlegung (Projektionen, hook/
entityHook, screen/nav, eventMigration — Schritte 4-8) hat eine parallele
Repräsentation im Designer-AST-Codegen-System (`kumiko-framework`:
`packages/feature-ast/src/*` (früher `packages/framework/src/engine/feature-ast/*`) + `pattern-library/*`, Consumer:
`kumiko-enterprise/packages/designer`). Jede Methode dort hat einen eigenen
Pattern-Typ mit Extractor, Renderer und Formular-Schema für den visuellen
Feature-Designer.

Ein Merge auf Framework-Seite reicht nicht — der Designer würde weiterhin
Code im alten Shape rendern, der gegen den neuen Registrar-Typ nicht mehr
kompiliert. Das ist KEIN theoretisches Risiko: am `exposesApi`/`usesApi`-Fold
(unten) gezeigt, dass ein grün laufender Test-Suite-Lauf diese Klasse von
Bruch nicht sieht, weil der Roundtrip-Test nur Parse↔Render-Symmetrie prüft,
nicht echte Kompilierung gegen den Registrar-Typ (Tracking für den fehlenden
Compile-Check: kumiko-framework#1087).

**Konsequenz:** jeder Schritt in 4-8 ist "Framework-Change + Designer-AST-
Migration", nicht nur "Call-Sites codemodden" wie ursprünglich geplant.
Bevor einer dieser Schritte angegangen wird: erst grob den Migrationsaufwand
im Designer-System abschätzen (Explore-Task), dann entscheiden ob er sich
lohnt.

## `exposesApi`/`usesApi` → `requires`/`provides` — PARKED (nicht gemerged)

Umgesetzt und getestet (Branch `refactor/api-consolidate-registrar` in
kumiko-framework, geparkt, nicht gemerged — kein PR):

- `requires`/`optionalRequires` um `(name, { apis })`-Überladung erweitert,
  ersetzt `r.usesApi(name)` an der Call-Site
- Boot-Validator-Invariante bestätigt vorab: jedes `usesApi` musste bereits
  sein Provider-Feature in `requires`/`optionalRequires` haben — der Fold
  ändert also keine Boot-Order-/Cascade-Semantik
- Self-Exposure-Edge-Case gefunden und gefixt: `usesApi(self)` brauchte nie
  `requires(self)` (Validator hat das explizit übersprungen); der naive
  Fold hätte einen künstlichen Zirkularitäts-Boot-Error erzeugt
- Volle Test-Suite (4960 Tests) grün, `tsc -b` clean, 2 generierte
  `feature-manifest.json`-Kopien resynchronisiert

**Warum trotzdem nicht gemerged:** `UsesApiPattern` im Designer-AST
speichert nur den `apiName`, nicht das Provider-Feature. Der Renderer kann
daraus `requires(provider, { apis })` nicht rekonstruieren, ohne den
Pattern-Typ selbst umzubauen (Provider-Feld ergänzen, Extractor + Renderer +
Formular-Schema in `packages/feature-ast/src/pattern-library/opaque-schemas.ts` anpassen — plus
möglicherweise die Designer-UI in kumiko-enterprise). Für den Gewinn (−1
Methode, `usesApi` war ohnehin schon recht selbsterklärend) lohnt sich diese
Restrukturierung allein nicht.

**Wieder aufnehmen:** nur zusammen mit einer AST-Pattern-Migration, oder
wenn die Designer-Pattern-Library ohnehin aus anderem Grund überarbeitet
wird.

## Offen — blockiert

- **`rawTable` + `unmanagedTable` mergen** — Code kommentiert den Merge
  bereits als geplant (`feature.ts:739-742`), aber an den vollständigen
  Drizzle-Cut gekoppelt. Tracking: kumiko-framework#1082.

## Schritte 4-8 einzeln bepreist (5 parallele Analysen, 2026-07-17)

Aufwand nach Designer-AST-Kopplung sortiert, günstigster zuerst:

- **`screen.nav`-Option additiv (7) — ✅ UMGESETZT, PR kumiko-framework#1089.**
  Rein additiv, Extractor/Renderer sind bereits generische Objekt-Walker
  ohne Feld-Allowlist — Designer-Roundtrip bleibt verlustfrei ohne jede
  AST-Änderung. Framework-Diff: 1 Type-Intersection + ~20 Zeilen Builder-
  Sugar in `feature-ui-extensions.ts`. `r.nav()` bleibt vollständig
  bestehen. **Designer-Kopplung diesmal VOR dem Merge verifiziert** (eigener
  Roundtrip-Test in `render-roundtrip.test.ts`, nicht erst hinterher
  entdeckt wie beim `usesApi`-Fold) — Muster für die restlichen Schritte.
  Volle Test-Suite grün (4967 Tests), `tsc -b` clean.

- **List/Detail-Screen-Type-Union (6) — ❌ SKIPPED, kein echter Gewinn.**
  Zweite, genauere Prüfung der 28 Consumer-Sites (statt nur die Type-Bodies
  zu vergleichen) zeigte: fast alle branchen auf Entity-vs-Query-
  Gebundenheit, nicht auf Feld-Zugriff — Auto-Create-Nav nur bei
  `entityList`, Entity-Existenz-Validierung nur bei `entityList`, eigene
  i18n-Label-Ableitung nur bei `projectionList`, e2e-Generator überspringt
  `projectionList` komplett, `registry-ingest.ts` gruppiert `entityList` mit
  `entityEdit` (beide entity-gebunden) statt mit `projectionList` — die
  reale Trennlinie im Code ist Entity-vs-Query, nicht List-vs-Detail. Ein
  Merge zu `type: "list", source: {entity}|{query}` hätte
  `screen.type === "entityList"` nur zu `screen.source.entity !== undefined`
  umbenannt — jede der ~15 verhaltensrelevanten Stellen hätte denselben
  Branch gebraucht, nur umgeschrieben. Einziger Gewinn wäre die kürzere
  Typ-Deklaration (104 Definitionen) gewesen, keine echte Vereinfachung der
  Applikationslogik, für ~130 Breaking-Stellen. Edit/Detail-Merge war schon
  vorher verworfen (Write- vs. echtes Read-only-Surface, kleinerer Overlap
  als in der ersten Analyse angenommen). User-Entscheidung: beides skippen.

- **`hook`/`entityHook` (5) — ✅ UMGESETZT, PR kumiko-framework#1090.**
  `r.hook(type, target, fn)` akzeptiert jetzt `{ allOf: entityRef }` als
  Target für postSave/preDelete/postDelete/postQuery, ersetzt
  `r.entityHook` vollständig. Anders als beim `usesApi`-Fold diesmal die
  **komplette** Designer-AST-Migration mitgezogen (nicht nur Framework-
  Runtime): `HookPattern.target` erweitert, `EntityHookPattern` retired,
  Extractor/Renderer/Patch-Matcher gemerged, `entityHookSchema` in
  `hookSchema` gefaltet — und die Kopplung diesmal VOR dem Merge mit
  einem eigenen Roundtrip-Test verifiziert statt hinterher entdeckt.
  Echter Edge-Case gefunden und gefixt: Self-Usage (Feature hookt eigene
  Entity) darf nicht in `requires` schreiben, sonst Circular-Dependency-
  Error — dieselbe Ausnahme, die `entityHook` schon hatte. 6 reale
  Call-Sites migriert (custom-fields, sessions, tier-engine ×3). Bonus-Fix:
  `HOOK_TYPE_OPTIONS` im Designer-Dropdown fehlte `postQuery` (pre-existing
  Gap), jetzt ergänzt. Volle Test-Suite grün (4961 Tests), `tsc -b` clean,
  `kumiko-guards-run` clean.

- **`defineEvent` + `eventMigration` (8) — ✅ UMGESETZT, PR kumiko-framework#1094.**
  `r.defineEvent(name, schema, { version, migrations })` akzeptiert jetzt eine
  `migrations`-Array-Option, ersetzt `r.eventMigration` vollständig — 0 reale
  Call-Sites in `bundled-features` (nur `samples/recipes/event-sourcing`
  betroffen, migriert). Die usesApi-Lehre (fehlendes Referenz-Feld) traf hier
  NICHT zu: `eventName` stand bereits überall im Pattern. Erste Einschätzung
  ("Array-Darstellung müsste im Designer neu gebaut werden") war zu hoch
  bepreist — advisor-Review deckte auf, dass `toVersion` immer
  `fromVersion + 1` ist, also **kein neuer Array-Input-Typ** nötig war:
  `migrations` im AST als `Record<fromVersion, SourceLocation>`, gerendert
  über das bestehende `key-value-map`-Formular-Feld (gleiches Muster wie
  `projection.applyBodies`). `EventMigrationPattern` + sein
  Extractor/Renderer/Patch/Formular-Schema retired. Kopplung vor dem Merge
  mit eigenem Roundtrip-Test verifiziert. Echter Edge-Case gefunden und
  bewahrt: Dup-fromVersion- und Gap-in-Chain-Validierung laufen weiterhin
  pro Array-Eintrag durch dieselbe Registrierungs-Logik (kein Sicherheits-
  Regress durch den Fold). `scripts/regenerate-pattern-docs.ts` mitgezogen
  (eigenständige `eventMigration`-Doc-Page retired, Beispiel in `defineEvent`
  gefaltet). Volle Test-Suite: 6636 pass / 6 fail (alle umgebungsbedingt,
  unabhängig von diesem PR).

- **Projektionen (4) — ❌ SKIPPED, kein echter Gewinn.** Genauere Prüfung
  der `apply`-Signaturen zeigte: `SingleStreamApplyFn(event, tx, table)`
  läuft inline in der Write-TX; `MultiStreamApplyFn(event, tx, ctx)` läuft
  async über den Dispatcher-Cursor — zwei unterschiedliche Delivery-Modelle,
  keine Variante desselben Konzepts (anders als beim hook/entityHook-Fold).
  Die Feldmengen sind fast disjunkt (`projection`: `table`/`entity`/
  `extraSources`/`isImplicit`; `multiStreamProjection`: `errorMode`/`runIn`/
  `delivery`), gemeinsam ist nur `name`/`apply` — und selbst `apply` ändert
  seine Form je nach `kind`. Ein `r.projection({kind})`-Merge hätte
  `multiStreamProjection` (Name benennt die Liefergarantie bereits) hinter
  einem Discriminator versteckt — Komplexität verschoben statt gespart —
  für 116 Breaking-Call-Sites. Gleiches Muster wie Schritt 6 (List/Detail).
  `extendEntityProjection` wäre ohnehin Neubau gewesen (0 Pattern-Typ heute,
  1 Call-Site). Der pre-existing `table`-Feld-Verlust-Bug im Designer-AST
  bleibt unabhängig davon offen — eigenes Ticket, nicht Teil dieser Serie.

**Empfehlung bei Fortsetzung:** in obiger Reihenfolge (7 → 6 → 5 → 8 → 4),
jeweils mit demselben Vorgehen wie bei Schritt 3 (Framework-Change +
Test-Beweis, DANN Designer-AST-Kopplung separat verifizieren bevor gemerged
wird — nicht wie beim ersten usesApi-Versuch erst nach der Implementierung
entdecken).

## Offen — neu gefunden beim Bau des Compile-Checks (kumiko-framework#1087)

Der in "Wichtiger Fund" oben referenzierte Compile-Check (#1087) wurde
gebaut (ts-morph gegen die reale `tsconfig`) und deckte sofort einen
**eigenständigen, von der Schritte-4-8-Serie unabhängigen** Bug auf —
betrifft keine der oben gemergten/geparkten Kandidaten, sondern neun
lange etablierte Methoden:

`render.ts` kanonisiert `requires`, `optionalRequires`, `readsConfig`,
`entity`, `relation`, `metric`, `secret`, `claimKey`, `referenceData` als
Objekt-Form-Aufruf (`r.entity({ name: "item", ... })`), `FeatureRegistrar`
verlangt für alle neun aber positionale Argumente
(`entity(name, definition, opts?)` etc.). Gerenderter Code kompiliert
für diese Methoden aktuell **nicht** gegen den echten Typ — bislang hat
das nur nichts geprüft. Verifiziert über das bereits im Repo bestehende
`STATIC_FEATURE`-Fixture in `render-roundtrip.test.ts`, das ausschließlich
etablierte Methoden nutzt.

**Entscheidung: Objekt-Form additiv in `FeatureRegistrar` ergänzen**
(nicht den Renderer auf Positional zurückdrehen) — aus demselben Grund wie
beim `usesApi`-Fold-Learning oben: Designer-/Agent-generierter Code
profitiert von einer uniformen Call-Shape (ein Objekt-Argument, `name` als
Feld) statt heterogener Arität pro Methode, das ist genau die Fehlerklasse
(falsche Argument-Reihenfolge/-Anzahl), die generierter Call-Code am
häufigsten produziert. Tracking: kumiko-framework#1113.

## Bewusst nicht angefasst

- UI-Familie (`screen`/`nav`/`workspace`) unter `r.ui.*` — 369 Call-Sites für
  reine Gruppierung ohne Konzept-Gewinn
- `configKey` — läuft bereits in eigener Worktree-Session (`configkey-migration`)
