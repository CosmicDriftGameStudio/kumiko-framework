---
"@cosmicdrift/kumiko-framework": minor
---

`collectTableMetas(features)` (new export from `/db`): canonical `ENTITY_METAS` source for `kumiko schema generate` that covers the same table sources as the test-stack auto-push — entities, unmanaged tables, `r.projection`, `r.multiStreamProjection` (with table) and `r.rawTable`. Previously the canonical schema.ts template only collected entities + unmanaged tables, so projection-only tables (e.g. billing-foundation `read_subscriptions`, jobs `read_job_runs`) never landed in app migrations and the first prod write crashed (#255). Also exports `extractTableInfo`/`asEntityTableMeta` from `/bun-db`.
