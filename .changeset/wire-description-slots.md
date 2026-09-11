---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix several `description` slots declared in `packages/types/src/screen.ts` that were never reaching the rendered DOM:

- `EditWriteFormSection.description` (projectionDetail write-form sections) never reached `WriteFormSection`'s `Section` primitive as a `subtitle`.
- `RenderEdit` suppressed the screen-level subtitle (from `EntityEditScreenDefinition`/`ProjectionDetailScreenDefinition.description`) whenever `hideSectionTitles` was set — i.e. on every tabs-mode `projectionDetail` screen — even though hiding section titles has nothing to do with hiding the screen's own explanation.
- `ConfigEditScreenDefinition.description` was dropped by `config-edit-shim.ts`'s `synthesizeConfigEditScreen`, unlike the equivalent `action-form-shim.ts`/`projection-detail-shim.ts` passthroughs.
- `SecretsEditScreenDefinition.description` was never read by `SecretsEditBody`.
- `DashboardScreenDefinition.description` was never read by `WebDashboardBody`.

`entityList`/`projectionList` `.description` and `CustomScreenDefinition.description` are left as-is: the screen title itself was deliberately moved out of `DataTable`'s toolbar into the shell breadcrumb (a nav label, not a description slot), and `CustomScreenBody` renders the author's component with no framework chrome — closing either would mean inventing a new render region, out of scope for this fix.
