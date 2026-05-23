---
"@cosmicdrift/kumiko-bundled-features": minor
---

custom-fields: per-field retention sweep (T1.5d).

New `runCustomFieldsRetention(opts)` walks one host entity's rows and strips/nulls customField values whose host-row `modified_at` is older than the per-field `retention.keepFor` policy. Strategy `delete` removes the key; `anonymize` sets it to `null`.

`serializedField` gains optional `retention: { keepFor: string; strategy: "delete" | "anonymize" }`.

Designed to run alongside (or inside) the data-retention bundle's daily cron. No auto-registration — the consumer chooses the schedule and which host entities to sweep.
