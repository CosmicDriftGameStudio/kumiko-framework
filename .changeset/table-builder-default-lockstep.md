---
"@cosmicdrift/kumiko-framework": patch
---

`buildEntityTable` is now lock-step with `buildEntityTableMeta`: declared field defaults for `select`/`number`/`bigInt` survive the builder path (previously dropped — the meta on the table object, and thus `collectTableMetas`/test-stack DDL, disagreed with generated migrations), and `moneyAmount` carries `bigintJsMode: "bigint"` so money cents round-trip without precision loss past 2^53. New lock-step test guards both paths against future drift.
