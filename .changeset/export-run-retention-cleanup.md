---
"@cosmicdrift/kumiko-bundled-features": patch
---

runRetentionCleanup is exported for app tests

<!-- kumiko-changes
feature: data-retention
type: improvement
title: runRetentionCleanup is exported for app tests
detail: The data-retention entry point now exports runRetentionCleanup with its argument, result and skip types, so an app test can drive a retention run with its own now and file context and check that bytes, file_refs rows and the entity row are gone. The user-data-rights recipe shows the pattern.
-->
