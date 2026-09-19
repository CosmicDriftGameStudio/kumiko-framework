---
"@cosmicdrift/kumiko-framework": minor
---

Boot warns for text/longText fields without a personal stance (fw#2918).

`validatePiiAndRetention` so far only warned when an unannotated field name hit one of the PII name heuristics. It now warns for every `text`/`longText` field that declares no stance at all — naming feature, entity, field and all valid stances verbatim — so consumers can work off their own baseline before fw#2810 turns the missing stance into a compile error and a throw. Annotated fields (including `personal: false` with a reason and `personal: "ref"`) stay silent, other field types are untouched.

A clean boot does not mean "ready for fw#2810": `validatePiiAndRetention` only walks `feature.entities[*].fields`, so embedded sub-schemas and call sites that never boot (fixtures, helper modules) produce no warning while still breaking later. The completeness instrument is and stays `guard-text-field-stance` — ready means a guard count of 0. The reverse does not hold either: the guard counts `createTextField()` call sites, the boot validator walks resolved field defs, so a raw field-def object literal warns at boot without ever showing up in the guard's baseline.

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot warns for text/longText fields without a personal stance (fw#2918).
-->
