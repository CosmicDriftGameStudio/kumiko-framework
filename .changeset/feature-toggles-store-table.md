---
"@cosmicdrift/kumiko-bundled-features": patch
---

feature-toggles: register `store_global_feature_state` via `r.storeTable()` (exported as `globalFeatureStateTableMeta`). Previously the table was only a plain Drizzle export with no store-table meta, so `collectTableMetas(FEATURES)` never saw it — `kumiko schema generate` reported no changes for any app mounting `createFeatureTogglesFeature()`, and the table was missing in any DB that wasn't manually provisioned (e.g. via `unsafePushTables` in tests). `setupTestStack` now auto-provisions the table like every other `r.storeTable()` feature.
