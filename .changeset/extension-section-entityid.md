---
"@cosmicdrift/kumiko-renderer": patch
---

Set-Value-UI: Extension-Section bekommt im Edit-Mode die echte entity-id

`RenderEdit` mountete extension-sections (Custom-Fields-Set-Value-UI) mit
`entityId={vm.id}` (= `values["id"]`). Der Update-Form lässt `id` aber
bewusst aus den Form-values (id ist keine deklarierte Field), also war
`vm.id` im Edit immer `undefined` → die Section blieb fälschlich im
create-mode ("Save the entity first") obwohl die Entity längst existiert.
Bug seit der Extension-Section-Einführung. Fix: `EntityEditUpdateForm`
reicht die route-`entityId` explizit über die neue `RenderEdit`-prop durch;
Create-/ActionForm-/ConfigEdit-Pfade fallen unverändert auf `vm.id` zurück.
