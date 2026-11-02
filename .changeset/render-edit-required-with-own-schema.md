---
"@cosmicdrift/kumiko-renderer": patch
---

`RenderEdit` checks required fields even when the caller passes its own `schema`.

<!-- kumiko-changes
feature: renderer
type: fix
title: RenderEdit validates required fields in addition to a custom schema
detail: Required fields were only checked client-side when the form schema came from `buildFormSchema` (default entity screens). A caller `schema` replaced it, so an empty required field was submitted and failed on the server without a field error. `RenderEdit` now always runs the field-derived required checks and merges their issues with those of the caller `schema`, for `controller.submit()` and `customSubmit`; hidden fields stay exempt. The `valid` flag of `onChange` now includes the required fields as well. Forms such as actionForms that relied on the handler to reject an empty required field now block on the client.
-->
