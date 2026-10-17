---
"@cosmicdrift/kumiko-guards": minor
---

New guard api-object-form flags positional registrar calls

<!-- kumiko-changes
feature: guards
type: improvement
title: kumiko-guards gains the api-object-form guard
detail: The guard fails on a positional r.writeHandler, r.queryHandler, r.entity, r.requires or r.hook call and on registerEntityCrud, and names the object form to use. It runs with the default kumiko-guards checks. The direct-entity-writes guard now also reads entity registrations written in the object form, including a backingTable override.
-->
