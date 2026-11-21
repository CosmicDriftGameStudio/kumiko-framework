---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Storage-delete and delivery failures log only the error class and code, not adapter text or storage keys.

<!-- kumiko-changes
feature: framework
type: fix
title: failure logs name the error class instead of adapter text
detail: New `errorKindOf` in `@cosmicdrift/kumiko-framework/logging`, also re-exported from bundled-features shared. The `storage delete failed` warning no longer logs the storage key or the adapter message, and delivery channel and dispatch failures log the error class instead of a redacted message.
-->
