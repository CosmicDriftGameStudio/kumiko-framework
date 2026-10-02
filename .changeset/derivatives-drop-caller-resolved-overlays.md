---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`derivatives.variant()` now discards a caller-supplied `resolvedOverlays`, so a literal overlay payload can no longer bypass the overlay resolver. The guarded admin seed throws instead of silently picking by id when a user row's `insertedAt` is not an instant.

<!-- kumiko-changes
feature: framework
type: fix
title: variant() ignores caller-supplied resolvedOverlays
-->
