---
"@cosmicdrift/kumiko-bundled-features": patch
---

The custom-fields form section edits money fields: it shows the stored amount formatted in its currency and writes `{ amount, currency }` in minor units.

<!-- kumiko-changes
feature: custom-fields
type: fix
title: Money custom fields can be edited in the form
detail: A custom field of type money rendered as a text input showing "[object Object]", and saving sent the typed string, which set-custom-field rejected, so the form could never write a money value. It now uses the money input, keeps the currency of the stored value (else the definition's `currency`, else EUR) and sends the amount in minor units, the same as built-in money fields.
migration: Custom-field money values are not covered by the minor-unit release note "Stored events and rows of two-decimal currencies need no change". Values written before the money minor-unit release through set-custom-field (API, agent tool, import) followed the old major-unit convention (`12.5` meant 12.50) and are stored raw, with no flattenMoney scaling, in the host table's `custom_fields` jsonb and in `custom-field-set` events. They now read 100 times too small for two-decimal currencies. Check them before upgrading and rewrite affected values once through set-custom-field.
affects: custom-fields, CustomFieldsFormSection
-->
