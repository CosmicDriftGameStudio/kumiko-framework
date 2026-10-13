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

`header.statusToneField` on a projectionDetail screen picks the `statusTones` entry from another record field, so a badge text like "Terminated on 31.03.2027" keeps its tone.

A writeHandler `redirect` accepts `tab` to open a specific tab of a projectionDetail target.

File and image fields render as a rectangular thumbnail (variant, then original, then placeholder) or the file name instead of an id, in read-only forms and in list cells; `{ format: "image" | "file" }` selects the same display for list columns.

On narrow screens the status badge of a projectionDetail header moves into the page body so a long status stays readable, and the header keeps the edit pencil.

In a flow layout an edit field with `span` takes a full row.

Writes now reject file and image field values whose file id does not exist or does not belong to the writer's tenant, with a validation error on the field.

File and image fields only request ids that are UUIDs and encode the id and variant in the URL path.

<!-- kumiko-changes
feature: framework
type: breaking
title: Writes with file ids from another tenant are rejected
detail: A create or update that puts a file id into a file or image field now fails with a ValidationError (code invalid_element, path = field name) when the id is not a UUID, does not exist, or belongs to another tenant. That includes files stored under the SYSTEM tenant. On update only the changed fields are checked. The check runs for every write that returns a save result, inside the transaction, before pending file refs are bound. System users created for a tenant pass with that tenant's own files.
migration: Check seeds, imports and handlers that copy file ids across tenants or reference files uploaded as SYSTEM. Upload the file in the target tenant (or copy it there) before writing its id. A custom handler that writes through an executor directly, without returning a save result, is not covered and needs its own check.
-->

<!-- kumiko-changes
feature: renderer
type: breaking
title: Searchable lists show their description as its own row
detail: An entityList or projectionList with search used to hide its description. It now renders as a muted row below the toolbar, the same as on lists without search.
migration: Look at lists that set description together with search. Drop descriptions that were only kept as a hint for developers, or move the text into emptyState if it explains an empty list.
-->
