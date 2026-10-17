---
"@cosmicdrift/kumiko-bundled-features": patch
---

update-tenant-field exposes the type field

<!-- kumiko-changes
feature: custom-fields
type: fix
title: update-tenant-field no longer hides `type` from the handler schema
detail: The `type` field is part of the documented payload; the 422 check against changing the stored type remains the protection.
-->
