---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

multiSelect form fields can load their options from a query.

<!-- kumiko-changes
feature: framework
type: improvement
title: multiSelect supports optionsQuery on actionForm and configEdit fields
detail: `createMultiSelectField({ options: [], optionsQuery, optionsQueryPayload })` loads the checkable options from a query handler, with `{ field }` payload refs to sibling fields like a select. Stored values missing from the result stay visible, and a payload change drops values the new rows no longer contain. Boot rejects the same misconfigurations as for select, and entity multiSelect fields reject optionsQuery. The write handler still checks every submitted value against the same source.
-->
