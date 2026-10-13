---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

`primaryAction` on a projectionDetail screen names the header action that renders as the filled primary button; the boot validator rejects an id that is not a header action.

`emptyState` on an entityList or projectionList defines the title, description and an optional action for an empty list, and `description` now also shows on searchable lists; a search or filter without matches shows its own "no entries match" text (`kumiko.list.empty.filtered`).

A writeHandler `redirect` accepts `tab` to open a specific tab of a projectionDetail target.

File and image fields render as a rectangular thumbnail (variant, then original, then placeholder) or the file name instead of an id, in read-only forms and in list cells; `{ format: "image" | "file" }` selects the same display for list columns.

On narrow screens the status badge of a projectionDetail header moves into the page body so a long status stays readable, and the header keeps the edit pencil.

In a flow layout an edit field with `span` takes a full row.

Writes now reject file and image field values whose file id does not exist or does not belong to the writer's tenant, with a validation error on the field.

File and image fields only request ids that are UUIDs and encode the id and variant in the URL path.
