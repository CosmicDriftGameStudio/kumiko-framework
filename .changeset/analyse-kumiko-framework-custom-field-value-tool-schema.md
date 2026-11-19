---
"@cosmicdrift/kumiko-bundled-features": patch
---

The agent tool for `set-custom-field` describes `value`, including that a money amount is an integer in minor units of the definition's currency.

<!-- kumiko-changes
feature: custom-fields
type: fix
title: Agent tools see the money unit of custom fields
detail: `value` of `set-custom-field` is free-form because its shape depends on the field definition, so its JSON Schema carried no hint and a model could send 12.5 for 12.50. It now has a description: a money field takes `{ amount, currency }`, amount as an integer in minor units (12.50 is 1250), currency as the definition's currency. The handler already rejects other amounts and currencies with `custom_field_value_invalid` (details `fieldKey`, `fieldType`, `issues`).
migration: Nothing to do.
-->
