---
"@cosmicdrift/kumiko-renderer": patch
---

`RenderEdit` checks the screen's required fields on the client, with or without its own `schema`.

<!-- kumiko-changes
feature: renderer
type: fix
title: RenderEdit validates required fields, with or without a custom schema
detail: Required fields were only checked client-side when the form schema came from `buildFormSchema` (default entity screens). Every other `RenderEdit` treated the form as valid, and a caller `schema` replaced the field checks, so an empty required field was submitted and failed on the server without a field error. `RenderEdit` now always runs the field-derived required checks and merges their issues with those of a caller `schema`, for `controller.submit()` and `customSubmit`; hidden fields stay exempt. The `valid` flag of `onChange` includes the required fields as well, so forms such as actionForms that relied on the handler to reject an empty required field now block on the client. Select fields with an entity `default` are exempt when creating, because the server fills an empty select from the default.
-->
