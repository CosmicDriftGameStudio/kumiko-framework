---
"@cosmicdrift/kumiko-bundled-features": minor
---

data-retention cleanup now implements the `anonymize` strategy (per-field anonymize functions applied via the event-store executor, idempotent — a re-run appends zero events) and completes `blockDelete`: rows stay untouched during the keepFor legal hold, after expiry the anonymize functions run (row stays, person link goes). `RunRetentionCleanupResult.anonymizeDeferred` is replaced by `anonymized: number`; entities with an anonymize/blockDelete policy but no anonymize-annotated fields are reported in `skipped` with reason `missing_anonymize_fields`.
