---
"@cosmicdrift/kumiko-framework": patch
---

Update schema accepts null on optional fields, so a preSave hook or client can clear a stored optional value without presave_hook_invalid_output or a validation error

<!-- kumiko-changes
feature: framework
type: fix
title: Update schema accepts null on optional fields, so a preSave hook or client can clear a stored optional value
-->
