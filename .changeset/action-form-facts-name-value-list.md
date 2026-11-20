---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-types": minor
---

The key figures of an action form preview and success box now line up as a name-value list with the values in one column, and a figure marked `emphasize` (such as a total) is bold with a rule above it. A preview table can carry footer rows (`list.footer`, such as a sum row and the total claim) inside the table, and the preview panel is now a normal titled section instead of a beige hint banner.

<!-- kumiko-changes
feature: renderer
type: breaking
title: Action form facts render as a name-value list
detail: Single-line `facts` of an actionForm preview or success box render through the new core primitive `KeyValueList` (label left, value right-aligned) instead of one text line "Label: Value". `ActionFormSuccessFact` gains `emphasize`. A fact row keeps its `...-fact-<n>` test id; its text is no longer "Label: Value". `ActionFormPreviewList` gains `footer` (rows of label plus column-to-result-field cells, optional `emphasize`), rendered through the new `DataTable` prop `footerRows` in the table's tfoot. The preview panel renders as a `Section` (white surface, title, table) instead of `Banner variant="hint"`; error and loading states stay banners. Boot rule `action-form-preview/footer-column-unknown` rejects a footer cell for a column the list lacks.
migration: A custom primitive set adds `KeyValueList: ComponentType<KeyValueListProps>` (rows with key, label, value, optional emphasize and testId) and renders `DataTable` `footerRows`. Tests that read the old "Label: Value" text read the label and value cells instead; tests that expect the preview in a hint banner expect a section.
affects: renderer, ActionFormSuccessFact, KeyValueList, CorePrimitives, ActionFormPreviewFooterRow, DataTable footerRows
-->
