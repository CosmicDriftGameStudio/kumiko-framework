---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

DX-4. Neue Registrar-API `r.unmanagedTable(meta, { reason })`. Features
mit unmanaged-tables (delivery-attempts, job-run-logs) deklarieren die
jetzt selbst innerhalb ihrer `defineFeature`-Callbacks — Apps müssen sie
nicht mehr in `kumiko/schema.ts` manuell pushen.

`composed.unmanagedTables` aggregiert die metas cross-feature, sodass
`kumiko schema generate` sie automatisch findet.

`r.rawTable` (PgTable-basiert, legacy) bleibt unverändert; `r.unmanagedTable`
ist die EntityTableMeta-Variante (framework-native, post-drizzle).
