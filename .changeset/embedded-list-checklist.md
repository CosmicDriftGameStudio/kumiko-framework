---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": minor
---

Embedded lists work as phone inspection checklists: photos per row, limit checks, conditional fields and touch-friendly cards.

<!-- kumiko-changes
feature: framework
type: improvement
title: Embedded list as inspection checklist
detail: Every entity field and every embedded sub-field takes `visibleWhen` and `requiredWhen` (FieldCondition). The executor enforces `requiredWhen` on create and update; it returns `validation_error` with paths like `checkpoints.0.finding`, and on update it only checks fields whose value or condition field changed. A field is required only while it is visible, and hidden values are kept. Embedded sub-fields can be `images` (with `capture`) or `files` (`maxSize`, `accept`, `maxCount`). Uploads send `subField` next to `fieldName`, and `file_refs.fieldName` stays the embedded field, so binding, tenant check, disposal, read access, GDPR forget and retention work as for top-level file fields. The new derived op `inRange` (`from: [value, min, max]`, `inside`, `outside`) writes into a select sub-field. Any derived cell can carry a row-level `when`, and server and client compute through the same `withDerivedCells`. Select sub-fields take `optionTones`; segments show the tone of the selected option, and narrow screens render cards with 44px controls and the read-only label as the card title. Boot validates the condition fields and rejects `required: true` combined with `visibleWhen`/`requiredWhen`. Saving now enforces `access.write` on embedded sub-fields per row (`ownership_denied`, path `field.subField`); before, only the read side honored sub-field access. Saving also checks each newly placed file id against the `accept`/`maxSize` of the sub-field it lands in (`file_violates_bind_target`). Boot also rejects a numeric derived op whose target is not numeric, which can break an app that derived into a text or select cell. Recipe: `samples/recipes/inspection-checklist`.
-->
