# Samples

Getestete Beispiele fuer Framework-Features. Drei Buckets:

- **`recipes/`** — 1 Konzept = 1 Feature-Definition + 1 Test. Bricht ein
  Framework-Change was, wird der Recipe-Test rot. Server-only, kein UI.
- **`apps/`** — Full-Stack Demos mit dev-server + Browser-Client. Zeigen
  UI-Layer + Auth-Wiring + WorkspaceShell.
- **`showcases/`** — Komplette App-Domains. Mehrere Features pro Sample,
  zur Zeit ohne dev-server (geplant).

## Recipes — Ich will X machen → Sample

| Ich will... | Sample | Test-Typ |
|-------------|--------|----------|
| Entity + Standard-Handler + Soft Delete + Optimistic Locking | [recipes/basic-entity](recipes/basic-entity/) | Integration |
| Eigene Handler mit Business-Logik | [recipes/custom-handlers](recipes/custom-handlers/) | Integration |
| Parent-Child Relations + Cascade/Restrict | [recipes/relations](recipes/relations/) | Integration |
| Felder per Rolle verstecken/schuetzen | [recipes/field-access](recipes/field-access/) | Integration |
| Hooks (Validation, preSave, postSave) | [recipes/lifecycle-hooks](recipes/lifecycle-hooks/) | Integration |
| Stammdaten seeden (r.referenceData) | [recipes/reference-data](recipes/reference-data/) | Integration |
| Volltextsuche (searchable, searchWeight) | [recipes/search](recipes/search/) | Integration |
| Echtzeit-Updates via SSE | [recipes/realtime-sse](recipes/realtime-sse/) | Integration |
| Cross-Feature-Reaktionen (ctx.appendEvent + r.multiStreamProjection) | [recipes/cross-feature-events](recipes/cross-feature-events/) | Integration |
| Event Sourcing Vollbild (defineEvent + Upcaster + Projections + asOf + archive) | [recipes/event-sourcing](recipes/event-sourcing/) | Integration |
| Request-Deduplizierung (Idempotency) | [recipes/idempotency](recipes/idempotency/) | Integration |
| Multi-Tenant Datentrennung | [recipes/tenant-isolation](recipes/tenant-isolation/) | Integration |
| Mehrsprachigkeit (i18n) | [recipes/i18n](recipes/i18n/) | Unit |
| Saubere Fehlerbehandlung (Kumiko-Error-Klassen, Reasons, Helper) | [recipes/error-contract](recipes/error-contract/) | Integration |
| Default-deny Access Rules + FK-Indices via Relations | [recipes/access-control](recipes/access-control/) | Integration |
| Features tragen Identity-Facts in den JWT ein (r.authClaims) | [recipes/auth-claims](recipes/auth-claims/) | Integration |
| Row-level Ownership (Entity + Field, Read + Write, Straddle-safe) | [recipes/ownership](recipes/ownership/) | Integration |
| Jobs auf Deploy-Lane pinnen (runIn: "api" \| "worker"), event-triggered Fan-out | [recipes/lane-routing](recipes/lane-routing/) | Integration |
| Screens + Navigation registrieren (r.screen + r.nav) mit entityList/entityEdit/custom, cross-feature Nav-Parents, typed FieldCondition<T> | [recipes/screens-nav](recipes/screens-nav/) | Unit |
| Playwright-E2E-Specs aus der Registry generieren (generateE2ESpec + generateZodFixture, 4 Test-Kinds, Feldtyp→Interaktion-Mapping; JSON-serialisierbar für externen Worker) | [recipes/e2e-generator](recipes/e2e-generator/) | Unit |

## Apps — UI + dev-server

| Sample | Was es zeigt |
|--------|--------------|
| [apps/ui-walkthrough](apps/ui-walkthrough/) | DefaultAppShell + LanguageSwitcher + ThemeToggle + emailPasswordClient + TenantSwitcher + Tasks-Demo. Mit Playwright-E2E. |
| [apps/workspaces](apps/workspaces/) | WorkspaceShell + persona-/role-gated Workspaces + Cross-Feature-Nav-Members + Server-injiziertes AppSchema. |
| [apps/marketing-demo](apps/marketing-demo/) | Asset-Tracker + Helpdesk auf einer Kumiko-Instanz — Internal-Tools-Showcase mit translated Select-Options, deterministisch geseedet. Liefert die Screenshots für kumiko.so via Playwright-E2E. |

## Showcases — Komplette Domains

| Sample | Domaene | Status |
|--------|---------|--------|
| [showcases/acme-rental](showcases/acme-rental/) | Hausverwaltung SaaS | Geplant |
| [showcases/acme-fleet](showcases/acme-fleet/) | Fahrzeugtransport | Geplant |

## Tests ausfuehren

```bash
yarn kumiko test              # Unit Tests (inkl. recipes/i18n + recipes/screens-nav)
yarn kumiko test integration  # Integration Tests (alle Recipes mit DB)
yarn kumiko test e2e          # Playwright E2Es (apps/ + showcases/)
yarn kumiko test all          # Unit + Integration
```

## Production-Build

`yarn build` im App-Workspace produziert deploybare Artefakte. Voraussetzung:
`"scripts": { "build": "kumiko-build" }` in der `package.json`. Convention-
driven Discovery — `kumiko-build` baut das, was vorhanden ist:

| Convention                      | Output                | Inhalt                                        |
|---------------------------------|----------------------|-----------------------------------------------|
| `src/client.tsx`, `public/`, `index.html`, `src/styles.css` | `dist/`         | Client-Bundle: hashed Assets, Tailwind, Static-Files |
| `bin/main.ts`                   | `dist-server/`        | Server-Bundle: `server.js` + `kumiko.js` + `migration-hooks.js` (optional) + minimales `package.json` mit native externals |

Workspaces ohne `bin/main.ts` bekommen nur den Client, Headless-Apps ohne
Browser nur den Server. Beide werden parallel gebaut wenn vorhanden.

**Server-Bundle**: bündelt Framework + bundled-features + App-Source in eine
~1 MB JS-Datei. 7 native externals (argon2, bullmq, drizzle-kit, drizzle-orm,
ioredis, postgres, temporal-polyfill) bleiben als prod-deps in einem
generierten `dist-server/package.json`. Versionspin aus dem Repo-
`packages/framework/package.json`. Für App-spezifische externals siehe
`buildServerBundle({ extraRuntimeExternals })` in
`@cosmicdrift/kumiko-dev-server/build`.

**Container-Deploy**: `samples/showcases/publicstatus/deploy/` ist die
Reference — Multi-Stage Dockerfile baut beide Bundles, Runtime-Image kennt
nur `dist/`, `dist-server/`, `drizzle/`. Das `dist-server/`-package.json
wird im Runtime-Stage via `bun install --production` gefüllt (~30 MB
node_modules + 100 MB bun-alpine-Base = ~270 MB Image). Migrate-Step im
Pre-Deploy: `bun /app/kumiko.js migrate apply` läuft via gebundelter
kumiko-CLI gegen die DB. Details + GHA-Workflow-Pattern siehe
`samples/showcases/publicstatus/deploy/Dockerfile` und
`.github/workflows/deploy-publicstatus.yml`.

## Neues Recipe erstellen

```
samples/recipes/my-recipe/
  package.json              ← { "name": "@cosmicdrift/kumiko-sample-my-recipe", "dependencies": { "@cosmicdrift/kumiko-framework": "workspace:*" } }
  src/
    feature.ts              ← defineFeature + Entity + Handler
    __tests__/
      feature.integration.ts ← Test (oder .test.ts fuer Unit Tests)
```

Regel: Jedes neue Framework-Feature braucht ein Recipe oder eine Anpassung an einem bestehenden.
