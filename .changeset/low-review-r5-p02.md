---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

The `deprecation:entity-handler-cross-tenant` boot warning now names the codemod path that runs from a consumer repo. The `reason` strings on the `passwordHash`, PAT `tokenHash` and PAT `prefix` fields no longer carry an issue-number suffix.

<!-- kumiko-changes
feature: framework
type: fix
title: Cross-tenant deprecation warning names a runnable codemod path
-->
