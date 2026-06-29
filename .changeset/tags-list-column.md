---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

tags + renderer: inline tag chips on list rows, via a reusable component column

- **renderer**: an `entityList` column can now be a *virtual labeled column* — a presentational column drawn entirely by a `columnRenderer` component from the row, not tied to an entity field. Declare `{ field, label, renderer: { react: { __component } } }`; the new `label` also overrides any column's header (i18n key or literal). Any feature can now build component columns — tag chips, status badges, avatars — not just string formatters.
- **tags**: new `TagsCell` column renderer (registered via `tagsClient().columnRenderers`) shows an entity's tags as colored chips inline in any list row. Drop `{ field: "tags", label: "Tags", renderer: { react: { __component: TAGS_COLUMN_RENDERER_NAME } } }` into any `entityList` — no host-schema change.
- **tags**: `TagFilter` now shows the active selection as colored chips with a clear button, instead of just a count, so the active filter is visible.
