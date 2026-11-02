---
"@cosmicdrift/kumiko-testing": patch
---

`setupTestStack` cleans up the ephemeral database, Redis and cache-sync bus when an `extraContext` or job logger factory throws during setup.

<!-- kumiko-changes
feature: testing
type: fix
title: setupTestStack cleans up when a factory throws
detail: The cleanup region of `setupTestStack` starts right after the storage is provisioned, so a throwing `extraContext` factory, `runLogger` factory or job runner creation no longer leaves the test database, Redis namespace and cache-sync connection open. The cleanup only closes what already exists.
-->
