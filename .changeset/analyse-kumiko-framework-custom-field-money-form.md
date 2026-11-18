---
"@cosmicdrift/kumiko-bundled-features": patch
---

The custom-fields form section edits money fields: it shows the stored amount formatted in its currency and writes `{ amount, currency }` in minor units in the definition's currency.

<!-- kumiko-changes
feature: custom-fields
type: fix
title: Money custom fields can be edited in the form
detail: A custom field of type money rendered as a text input showing "[object Object]", and saving sent the typed string, which set-custom-field rejected, so the form could never write a money value. It now uses the money input in the definition's `currency` (without one: the stored value's currency, else EUR), which is the only currency set-custom-field accepts, and sends the amount in minor units, the same as built-in money fields. A value stored in another currency than the definition's (written before the definition's currency changed) is shown as stored, e.g. "Stored: £12.50", above an empty input; a new amount is saved in the definition's currency, and typing then emptying the input clears the old value.
migration: Custom-field money values are not covered by the minor-unit release note "Stored events and rows of two-decimal currencies need no change". Values written before the money minor-unit release through set-custom-field (API, agent tool, import) followed the old major-unit convention (`12.5` meant 12.50) and are stored raw, with no flattenMoney scaling, in the host table's `custom_fields` jsonb and in `custom-field-set` events. They now read 100 times too small for two-decimal currencies. Check them before upgrading and rewrite affected values once through set-custom-field.
-->
