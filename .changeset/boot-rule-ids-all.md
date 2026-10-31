---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-guards": minor
---

Every boot validation throw now carries a stable rule id. The remaining validators (screens, dashboards, forms, entities, fields, handlers, lists, queries, config keys, ownership, nav, read gate) and the bundled auth-foundation, document-ingest-foundation and tenant-lifecycle boot checks throw typed rule errors, so `agents/boot-rules.md` lists 572 rules. The temporary `boot-raw-throws` guard and its baseline are removed.

<!-- kumiko-changes
feature: framework
type: improvement
title: All boot validation errors have a rule id
detail: The boot validators that still threw plain errors now throw `bootRuleError` with a rule from a typed table, for example `form/affix-unknown-field`, `entity/derived-field-collision`, `list-table/unknown-keys` or `config-key/bounds-min-above-max`. A violation in `BootValidationError.violations` and in `kumiko-schema validate` (text and `--json`) carries that id instead of `unclassified/<check>`, plus a `Fix:` line and `Rule: agents/boot-rules.md#<id>`. `agents/boot-rules.md` lists every rule with summary and fix. Message texts are unchanged, so tests that match on the message keep passing; a test that asserted an `unclassified/...` id now sees the real id. Collection boundaries are unchanged: a validator that stopped at its first violation still does.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: Guard boot-raw-throws removed
detail: The temporary `boot-raw-throws` guard and `.kumiko-boot-raw-throws-baseline.json` are deleted because every boot validator throw in the framework is migrated to a rule id. The guard only scanned the framework repo, so apps need no change.
-->
