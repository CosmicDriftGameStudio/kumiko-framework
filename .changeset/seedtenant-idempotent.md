---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-dispatcher-live": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

fix(tenant): seedTenant idempotent gegen Event-Store-Projection-Drift.

Verhindert version_conflict beim App-Boot wenn Aggregat existiert aber
Projection-Row fehlt (rebuild-drift, async-lag, manueller DB-Eingriff).
