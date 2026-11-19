---
"@cosmicdrift/kumiko-framework": patch
---

The zod schema of a money field describes `amount` as an integer in minor units, so the JSON Schema that agent tools get from create, update and event payload schemas names the unit.

<!-- kumiko-changes
feature: framework
type: fix
title: Agent tools see that money amounts are minor units
detail: The JSON Schema built from a money field now carries a description on `amount` ("Integer amount in minor units of the currency ... 12.50 is 1250"), on top-level money fields and on money cells of embedded lists, in insert, update and webhook payload schemas. Before, a model read the bare integer as whole units and stored 125 GBP for "12,500 GBP". A field's own `description` stays on the field in the agent manifest; the unit sits on the nested `amount` property.
migration: Nothing to do. Apps that added the minor-unit hint to every money field description can drop it.
-->
