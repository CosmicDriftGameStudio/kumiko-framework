---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Storage-delete and delivery failures log only the error class and code, not adapter text or storage keys.

<!-- kumiko-changes
feature: logging
type: fix
title: failure logs name the error class instead of adapter text
detail: `errorKindOf` moves to `@cosmicdrift/kumiko-framework/logging` (bundled-features keeps re-exporting it). The `storage delete failed` warning no longer logs the storage key or the adapter message, and delivery channel and dispatch failures log the error class instead of a redacted message.
-->
