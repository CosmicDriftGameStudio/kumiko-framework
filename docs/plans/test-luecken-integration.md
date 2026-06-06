# Test-Lücken schließen — Integration & Unit

> **Status:** Revised 2026-06-03 (gegen HEAD `addd6794` verifiziert)
> **Scope:** kumiko-framework — `packages/{framework,bundled-features,renderer,renderer-web,headless}`
> **Priorisierung:** nach **tatsächlicher Verhaltens-Coverage**, nicht nach dir-lokalem Test-File-Count.

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

- [ ] **`renderer-web/primitives`** — 8 Files, **2.404 LOC, 0 Tests** (dialog, combobox, toast, money-input, …). Unit-Tests für State/Logik. ⚠️ jsdom-Decke: CSS/pointer-events/z-index sind hier **nicht** abdeckbar → Playwright (separater E2E-Scope).
- [ ] **`renderer-web/layout`** — 16 Files, **2.173 LOC, nur 2 Tests** (sidebar, nav, header).
- [ ] **`renderer/app`** — 9 Files, **1.568 LOC, nur 1 Test** (create-app, nav, client-plugin, action-form-shim).
- [ ] **`framework/logging`** — `createLogger()` + trace-field-merge, nur 1 Test. Boot-kritisch.
- [ ] **`framework/random`** — `generate.ts`/`words.ts` (tenant-keys/webhook-slugs/api-names), nur 1 Test.
- [ ] **`bundled-features/foundation-shared`** — `config-helpers` (`requireDefined`/`requireNonEmpty`), **0 Tests**, konsumiert von mail-/file-/ai-foundation.
- [ ] **`bundled-features/file-provider-{inmemory,s3}`** — je nur Smoke (1 Test). Provider-Contract-Test (`writeStream`/`readStream`/`getSignedUrl`).

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
