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
| Playwright-E2E-Specs aus der Registry generieren (generateE2ESpec + renderPlaywrightSpec, 4 Test-Kinds, Feldtyp→Interaktion-Mapping) | [recipes/e2e-generator](recipes/e2e-generator/) | Unit |

## Apps — UI + dev-server

| Sample | Was es zeigt |
|--------|--------------|
| [apps/ui-walkthrough](apps/ui-walkthrough/) | DefaultAppShell + LanguageSwitcher + ThemeToggle + emailPasswordClient + TenantSwitcher + Tasks-Demo. Mit Playwright-E2E. |
| [apps/workspaces](apps/workspaces/) | WorkspaceShell + persona-/role-gated Workspaces + Cross-Feature-Nav-Members + Server-injiziertes AppSchema. |

## Showcases — Komplette Domains

| Sample | Domaene | Status |
|--------|---------|--------|
| [showcases/mietnomade](showcases/mietnomade/) | Hausverwaltung SaaS | Geplant |
| [showcases/beammycar](showcases/beammycar/) | Fahrzeugtransport | Geplant |

## Tests ausfuehren

```bash
yarn kumiko test              # Unit Tests (inkl. recipes/i18n + recipes/screens-nav)
yarn kumiko test integration  # Integration Tests (alle Recipes mit DB)
yarn kumiko test e2e          # Playwright E2Es (apps/ + showcases/)
yarn kumiko test all          # Unit + Integration
```

## Production-Build

`yarn build` im App-Workspace produziert `dist/` (deploybar). Voraussetzung:
`"scripts": { "build": "kumiko-build" }` in der `package.json`. Convention-
driven Discovery: `src/client.tsx`, `src/styles.css`, `public/`, `index.html`
— Details + Container-Deploy-Pattern in der Repo-`CLAUDE.md` unter
"Production Build".

## Neues Recipe erstellen

```
samples/recipes/my-recipe/
  package.json              ← { "name": "@kumiko/sample-my-recipe", "dependencies": { "@kumiko/framework": "workspace:*" } }
  src/
    feature.ts              ← defineFeature + Entity + Handler
    __tests__/
      feature.integration.ts ← Test (oder .test.ts fuer Unit Tests)
```

Regel: Jedes neue Framework-Feature braucht ein Recipe oder eine Anpassung an einem bestehenden.
