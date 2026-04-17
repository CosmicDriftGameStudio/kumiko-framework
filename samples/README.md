# Samples

Getestete Beispiele fuer jedes Framework-Feature.
Jedes Sample = 1 Feature-Definition + 1 Test. Bricht ein Framework-Change was, wird der Test rot.

## Ich will X machen → Sample

| Ich will... | Sample | Test-Typ |
|-------------|--------|----------|
| Entity + CRUD + Soft Delete + Optimistic Locking | [basic-crud](basic-crud/) | Integration |
| Eigene Handler mit Business-Logik | [custom-handlers](custom-handlers/) | Integration |
| Parent-Child Relations + Cascade/Restrict | [relations](relations/) | Integration |
| Felder per Rolle verstecken/schuetzen | [field-access](field-access/) | Integration |
| Hooks (Validation, preSave, postSave) | [lifecycle-hooks](lifecycle-hooks/) | Integration |
| Stammdaten seeden (r.referenceData) | [reference-data](reference-data/) | Integration |
| Volltextsuche (searchable, searchWeight) | [search](search/) | Integration |
| Echtzeit-Updates via SSE | [realtime-sse](realtime-sse/) | Integration |
| Async Pub/Sub (ctx.emit + r.postEvent) | [pub-sub-events](pub-sub-events/) | Integration |
| Request-Deduplizierung (Idempotency) | [idempotency](idempotency/) | Integration |
| Multi-Tenant Datentrennung | [tenant-isolation](tenant-isolation/) | Integration |
| Mehrsprachigkeit (i18n) | [i18n](i18n/) | Unit |
| Saubere Fehlerbehandlung (Kumiko-Error-Klassen, Reasons, Helper) | [error-contract](error-contract/) | Integration |
| Default-deny Access Rules + FK-Indices via Relations | [access-control](access-control/) | Integration |

## Full-App Samples (geplant)

| Sample | Domaene | Status |
|--------|---------|--------|
| [mietnomade](mietnomade/) | Hausverwaltung SaaS | Geplant |
| [beammycar](beammycar/) | Fahrzeugtransport | Geplant |

## Tests ausfuehren

```bash
yarn kumiko test              # Unit Tests (inkl. i18n Sample)
yarn kumiko test integration  # Integration Tests (inkl. alle anderen Samples)
yarn kumiko test all          # Alles
```

## Neues Sample erstellen

```
samples/my-sample/
  package.json              ← { "name": "@kumiko/sample-my-sample", "dependencies": { "@kumiko/framework": "workspace:*" } }
  src/
    feature.ts              ← defineFeature + Entity + Handler
    feature.integration.ts  ← Test (oder .test.ts fuer Unit Tests)
```

Regel: Jedes neue Framework-Feature braucht ein Sample oder eine Anpassung an einem bestehenden.
