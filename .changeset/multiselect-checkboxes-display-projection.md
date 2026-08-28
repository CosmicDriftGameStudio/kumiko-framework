---
"@cosmicdrift/kumiko-framework": patch
---

Fix `projectField()` in the client-schema projection to forward `display`, `columns`, and `maxRows` for `multiSelect` fields.

Previously, apps that render from the injected `window.__KUMIKO_SCHEMA__` (i.e. `createKumikoApp` without an explicit `schema`) never received `display: "checkboxes"` on multi-select fields, so `render-field.tsx`'s checkboxes-vs-combobox check always fell back to the combobox `Input`. `MultiSelectCheckboxes` was unreachable in that setup even though the renderer and view-model layers already supported it correctly. Fields declared with `createMultiSelectField({ display: "checkboxes", columns, maxRows })` now render as the intended checkbox grid.
