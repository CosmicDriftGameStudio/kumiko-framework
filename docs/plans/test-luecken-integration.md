---
status: parked
verified: 2026-06-07
evidence: framework#235 #237 #238 #240 #241 #244 #246 (Phase 1)
next: Phase 2+3 bewusst zurückgestellt (diminishing returns)
---

# Test-Lücken schließen — Integration & Unit

> **Status:** Phase 1 weitgehend abgeschlossen (2026-06-06) — 5 Test-PRs + 2 Fix-PRs gemergt. Siehe Status-Abschnitt.
> **Scope:** kumiko-framework — `packages/{framework,bundled-features,renderer,renderer-web,headless}`
> **Priorisierung:** nach **tatsächlicher Verhaltens-Coverage**, nicht nach dir-lokalem Test-File-Count.

## Status (2026-06-06)

**Erledigt — Phase 1 + zwei dabei gefundene Bugs (7 PRs gemergt):**

| PR | Inhalt |
|----|--------|
| #235 | foundation-shared (+`requireNonEmpty`-trim-Bugfix), framework/logging (`createFallbackLogger`), framework/random (words-Invarianten + Doku-Fix) |
| #237 | file-provider Contract (`createInMemoryFileProvider`) + inmemory/s3-Wrapper |
| #238 | renderer-web/primitives — money-input (Pure-Logik + happy-dom-Render), DataTable-Logik, date-input |
| #240 | renderer/app — nav (`parsePath`/`formatPath`) + qualified-names |
| #241 | renderer/app — feature-schema (`toAppSchema`/`isAppSchema`) |
| #244 | **Fix:** RenderField reicht App-Locale (`useLocale`) an money/date durch statt `navigator.language` |
| #246 | **Fix:** `computeVisiblePages` zeigt 5 Seiten an Listen-Rändern (Window verschieben statt abschneiden) |

**Noch offen / bewusst zurückgestellt (diminishing returns):**

- `renderer-web/layout` (`nav-tree`/`workspace-shell`): fixture-lastig (WorkspaceDefinition/NavDefinition), mittlerer Wert.
- `renderer/app` `config-edit-shim` / `extension-sections`: triviale Daten-Shims/Guards, Fixture-Typen tief re-exportiert → Aufwand > Wert. `action-form-shim` ist bereits getestet.
- Radix-Primitives (dialog/combobox/dropdown/toast/date-input-Popover): **Tier 3 = Playwright** — happy-dom hat kein Pointer-Capture.
- **Phase 2 + 3 (unten)** in dieser Runde nicht angefasst — Scope war Phase 1 + die dabei gefundenen Bugs.

## Befund vorab — warum die Prio nicht nach File-Count geht

Der erste Entwurf reihte nach „Test-Files im eigenen Ordner". Das ist eine
irreführende Metrik:

- **Dir-lokale 0 Tests ≠ ungetestetes Verhalten.** Integration-Tests booten ganze
  Apps via `setupTestStack` und leben **zentral** (`delivery/__tests__`,
  `pipeline/__tests__`, `samples/recipes/`). Beispiel: `framework/stack` hat 0
  eigene Tests, wird aber von **60+ bundled-features-Integration-Tests** über
  `setupTestStack` exerziert — es *ist* das Test-Rückgrat.
- **Der `integration`-CI-Job ist non-blocking** (autoritativ via Branch-Protection
  geprüft: einziger required Check auf `main` ist `test` = `bun kumiko check`,
  der **keine** Integration-Tests fährt; keine Rulesets). Neue
  `*.integration.test.ts` laufen automatisch mit — `run-integration-tests.ts`
  glob't `{packages,samples}/**/*.integration.test.ts`, kein Allowlist — **gaten
  aber nichts**. „Coverage als Merge-Gate" ist eine **separate Entscheidung**
  (`integration` zum required-Check machen; bewusst non-blocking wegen
  Flaky-Historie des alten postgres-smoke-Jobs).

## Phase 1 — Echte Lücken (untestete Runtime-Logik)

> Im ersten Entwurf nicht enthalten. Das ist der Code mit echtem Risiko: viel
> Logik, kaum/keine Coverage — direkt *oder* transitiv.

- [x] **`renderer-web/primitives`** (#238) — money-input (Pure-Logik `currencyDecimals`/`parseLocaleNumber` + happy-dom-Render), DataTable-Logik (`computeVisiblePages`/`defaultCellRender`/`isComponentRendererRef`), date-input (`parseIso`/`toIso`). Radix-Komponenten (dialog/combobox/dropdown/toast) → Tier 3 Playwright.
- [ ] **`renderer-web/layout`** — 16 Files, **2.173 LOC, nur 2 Tests**. Offen: `nav-tree`/`workspace-shell` Pure-Logik (schema-fixture-lastig); `target-url` ist bereits getestet.
- [x] **`renderer/app`** (#240, #241) — nav (`parsePath`/`formatPath`), qualified-names (`lastSegment`/`qualify*`), feature-schema (`toAppSchema`/`isAppSchema`). Zurückgestellt: `config-edit-shim`/`extension-sections` (triviale Shims, Fixture-Aufwand > Wert); `action-form-shim` war schon getestet.
- [x] **`framework/logging`** (#235) — `createFallbackLogger`. `mergeTraceFields` war bereits via `pino-trace-bridge.test.ts` abgedeckt; `createLogger`-NDJSON bewusst nicht getestet (pino-async-flaky, Repo-Konvention).
- [x] **`framework/random`** (#235) — `words.ts`-Invarianten + Doku-Fix (150→191/173, 4-8→3-10). `generate.ts` war bereits umfassend getestet.
- [x] **`bundled-features/foundation-shared`** (#235) — `config-helpers` `requireDefined`/`requireNonEmpty` + dabei gefundener trim-Bugfix.
- [x] **`bundled-features/file-provider-{inmemory,s3}`** (#237) — `createInMemoryFileProvider`-Contract + beide Wrapper (build/Tenant-Isolation/Error-Pfade). Echter S3-Roundtrip (MinIO) = separater Integration-Follow-up.

## Phase 2 — Dünne Coverage gezielt ausbauen

- [ ] **`framework/engine`** — Integration: create-app + Registry-Resolve + Schema-Builder (aktuell **3 int / 67 unit**; engine wird zwar von *jedem* Integration-Boot transitiv exerziert, aber kein fokussierter Schema-Builder-Test).
- [ ] **`framework/api`** — Integration: SSE-Broker + SSE-Route, CSRF, Route-Registrierung (3 int / 10 unit).
- [ ] **`framework/secrets`** — Integration: Envelope-Encryption, DEK-Cache, Rotation mit echtem DB-Context (0 int / 5 unit).
- [ ] **`framework/migrations`** — Integration: Drift-Erkennung, Projection-Index-Migration (1 int / 1 unit).
- [ ] **`framework/observability`** — Integration: Prometheus-Meter, Tracing-Span-Export (1 int / 7 unit).
- [ ] **`framework/{auth,redis,compliance,errors,seeding,time,env}`** — Integration ergänzen (überwiegend 0 int): JWT-Lebenszyklus + Auth-Middleware, Redis Pub/Sub + Locking, Profile-Auflösung pro Tenant, Error-Serialisierung übers HTTP, Entity-Seed über DB-Pipeline, TzContext im Pipeline-Kontext, DryRun + Env-Parsing mit Config-Feature.
- [ ] **`framework/utils`** — Integration ausbauen: Serialisierung, IDs, Case-Konvertierung (derzeit 6 unit).
- [ ] **`renderer/src/{components,context,hooks,sse}`** — Unit-Tests (renderer-Package hat nur **4 Tests gesamt**): render-edit/-field/-list, dispatcher-context, use-form/-list-url-state/-query, live-events.
- [ ] **`bundled-features` Phase-D-Items** — je 1 Test → 2. Szenario: `rate-limiting` (Multi-Tenant), `legal-pages` (Markdown + Tenant-Context), `files` (FileRef + S3), `audit` (Filter/Export), `mail-transport-{inmemory,smtp}` (beide mit delivery-channel), `user-data-rights-defaults` (Hooks + Default-Profiles).
- [ ] **`headless/{dispatcher,nav}`** — je 1 Test, 2. Fall (error-case + timeout / resolve mit params).

## Phase 3 — Vertrags-Pinning (niedrige Prio — Verhalten bereits transitiv abgedeckt)

> Diese Module haben 0 dir-lokale Tests, ihr Verhalten ist aber durch
> Integration-Tests **anderswo** exerziert (Belege je Item). Dedizierte Tests
> bringen Regression-Lokalisierung / Vertrags-Pinning, **keine Erstabdeckung** —
> daher niedrige Prio, **nicht** „critical".

- [ ] **`bundled-features/step-dispatcher`** — mail- + webhook-runner abgedeckt durch `samples/recipes/webhook-step/.../webhook.integration.test.ts` (alle Step-Phasen commit→dispatch→success/failure) + `delivery.integration.test.ts`. Optional: fokussierter Step-Phasen-Test im Modul.
- [ ] **`bundled-features/channel-{email,in-app,push}`** — abgedeckt durch `delivery/__tests__/delivery.integration.test.ts` (Flows 9/10/11: email-renderer, push-token-dispatch) + `delivery-events.integration.test.ts` (in-app Inbox-Lifecycle, mark-read, SSE, Preferences). Optional: je 1 Channel-Contract-Test.
- [ ] **`framework/stack`** — *ist* `setupTestStack`, von 60+ Integration-Tests exerziert. Optional: Unit-Tests für `table-helpers.ts` / `redis.ts`.

### Gestrichen ggü. Erstentwurf

- ~~`framework/ui-types`~~ — `app-schema.ts` ist **100% TypeScript-Typdeklarationen**
  (`FeatureSchema`/`WorkspaceSchema`/`AppSchema`), null Runtime-Logik (exportiert nur
  ein `parseRefTarget`-Re-Export aus engine). Kein Test-Kandidat; Schema-Generierung
  wird ohnehin durch `engine/__tests__/build-app-schema.test.ts` abgedeckt.
- ~~Phase-D `text-content` (hat **3** Tests), `renderer-simple` (hat **2**)~~ —
  Behauptung „1 Test" war falsch; nicht backfill-bedürftig.

---

## Test-Konventionen (für alle neuen Tests)

- **Integration:** `setupTestStack` via `test-setup/integration.preload.ts` (setzt
  Service-Env via `??=` — kein `--env-file` nötig) + echte Postgres. HTTP über
  `stack.http → app.request()` (**NIE** `createTestDispatcher` — 79 bundled-feature-
  Integration-Tests nutzen `setupTestStack`, 0 den Dispatcher).
- **Unit:** Pure Function-Tests ohne DB, `bun:test` mit `describe`/`test`/`expect`.
- **Benennung:** `*.test.ts` (Unit), `*.integration.test.ts` (Integration).
- **Exemplar je nach Ziel-Package** (Pfad-Auflösung unterscheidet sich!):
  - **bundled-features** (Phase 1/2/3): `packages/bundled-features/src/tenant/__tests__/tenant.integration.test.ts` — importiert `setupTestStack` via `@cosmicdrift/kumiko-framework/stack`.
  - **framework**: `packages/framework/src/pipeline/__tests__/` — importiert via `../../stack` (package-relativ; **nicht** 1:1 nach bundled-features kopieren, sonst resolved der Import nicht).
  - **Unit**: `packages/framework/src/errors/__tests__/`.
- **`setupTestStack` legt nicht automatisch alle Tabellen an:** Non-Projection-/
  Non-Event-Entities brauchen `unsafeCreateEntityTable`/`unsafePushTables` +
  `createEventsTable` im `beforeAll` (siehe `tenant.integration.test.ts`).
- **Lauf:** `bun run test:integration` (alle, dir-by-dir, concurrency=1) oder
  `bun test --config=bunfig.integration.toml <file>` (einzeln).
