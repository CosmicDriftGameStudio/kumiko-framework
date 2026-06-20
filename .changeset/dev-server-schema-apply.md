---
"@cosmicdrift/kumiko-dev-server": minor
---

dev-server: `runSchemaApply` / `runStandaloneSchemaCli` als Export unter `@cosmicdrift/kumiko-dev-server/schema-apply`. Apps delegieren ihr `bin/kumiko.ts` (`kumiko schema apply`) auf ~5 Zeilen statt ~100 Zeilen identisches Boilerplate (DATABASE_URL-Check, Migrations, Projection-Rebuild) pro App zu duplizieren. Der Greenfield-Infra-Bootstrap (event-store + pipeline-state-Tabellen, idempotent vor den App-Migrations) ist eingefaltet, sodass leere DBs (CNPG) und Bestands-DBs über denselben Code laufen — keine per-App-Divergenz mehr.
