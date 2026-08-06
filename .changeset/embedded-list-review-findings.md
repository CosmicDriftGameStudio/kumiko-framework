---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Embedded-list widget follow-ups from #1838 review (fw#1839):

- Keyboard focus after Tab/Enter-to-add-row now lands on the actual focusable control (date/timestamp/money/select/reference cells), not the non-focusable wrapper `div`; Enter on the last cell now also appends+focuses a new row, mirroring Tab.
- Embedded-list money cells and the totals row use the entity's `defaultCurrency` instead of a hardcoded `"EUR"`.
- Reference sub-fields inside an embedded field get the same boot-time target-entity/labelField/list-query-handler checks as top-level reference fields.
- New declarative `totalsMatch` on `EmbeddedFieldDef` validates (client and server, via the same Zod schema) that the sum of a list subfield equals a sibling top-level money field, with boot-time checks that both fields exist and are money-typed.
- New `"timestamp"` embedded-list cell type, end to end (types, schema validation, view-model, renderer primitives, `TimestampInput` in the web renderer).
- Derived embedded-list cells (`field.derived`) are now re-validated server-side against a local mirror of the client's `computeDerivedCellValue`; an absent derived cell is never flagged as a mismatch against 0.
