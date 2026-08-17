---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

`projectionDetail` screens can now declare header action buttons via a new optional `actions: readonly RowAction[]` field, reusing `RowAction` from `entityList`/`projectionList` — the screen's single displayed record stands in for the "row", so `pick`/`map` payload extraction, `visible`, `confirm`/`confirmLabel` and `style` keep their existing meaning. `rowClick` has no target on a detail screen (there is no row to click) and is rejected at boot with the screen QN and action id in the error. The existing rowActions/toolbarActions boot checks (navigate-target exists in some feature, writeHandler QN is registered, `params` only on targets that read it) now also cover `projectionDetail.actions`.

When `screen.detailFor` names an entity, and some mounted feature (searched cross-feature via the app's full feature list, not just the projectionDetail's own feature) declares an `entityEdit` screen for that entity that the current user's roles can access, a default "Edit" action (`id: "edit"`) is prepended to the header actions automatically, navigating to that screen with the displayed record's id. A screen that declares its own action with `id: "edit"` in `actions` suppresses the default — the declared one wins, with no separate opt-out flag.

`RenderEdit` (renderer) gains a new optional `actions?: readonly RenderEditAction[]` prop, rendered in the same header action-bar region as the existing copy-link/delete/cancel/save controls (before them, in array order) — no new action-bar region was added. Each action's `confirm`/`confirmLabel`/`style: "danger"` drive the same confirm-dialog behavior as `RowActionWriteHandler`. A declared navigate action without an explicit `entityId`, targeting an `entityEdit` screen for the `detailFor` entity, auto-fills the shown record's id so the target opens that record instead of a blank create-form — the same convention entityList/projectionList row actions already follow. When a header action's `onPress` throws, the error surfaces in the form's existing error banner region, not inside the action button row.
