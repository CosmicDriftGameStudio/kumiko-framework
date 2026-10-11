---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

actionForm screens now honour the `excludedFields` of the write handler they call. `buildAppSchema` projects them onto the screen as `writeExcludedFields` (a flat list, since an actionForm has one handler and no create/update mode). The form shows those fields read-only, does not require them and never sends them, so a handler that excludes a field no longer needs a hand-written `readOnly` lock on its screen.

`custom-fields:write:update-tenant-field` accepts a payload without `serializedField.type` and keeps the stored type. A different type is still refused with 422 `field_type_immutable`. The handler declares `excludedFields: ["type"]`.

<!-- kumiko-changes
feature: framework
type: improvement
title: actionForm screens honour the called handler's excludedFields
detail: buildAppSchema projects the handler's excludedFields onto actionForm screens as writeExcludedFields (a flat list, unlike entityEdit's per-verb object). The form shows these fields read-only, not required and never in the payload.
migration: Drop a hand-written readOnly lock on an actionForm field once the handler it calls declares excludedFields for it.
-->

<!-- kumiko-changes
feature: custom-fields
type: improvement
title: update-tenant-field keeps the stored type when serializedField.type is omitted
detail: custom-fields: update-tenant-field accepts serializedField without type and keeps the stored type; a different type is still refused with 422 field_type_immutable. The handler declares excludedFields ["type"].
-->
