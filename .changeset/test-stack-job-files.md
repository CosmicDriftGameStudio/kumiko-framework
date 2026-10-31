---
"@cosmicdrift/kumiko-testing": patch
---

Jobs in setupTestStack reach a mounted file-provider plugin through ctx.services.files, as they do in production.

<!-- kumiko-changes
feature: testing
type: fix
title: Test-stack jobs get ctx.services.files from mounted file providers
detail: setupTestStack resolved the file-provider plugins only for the request path, so a job saw ctx.services.files undefined unless the stack got an explicit files option. The job context now carries the same resolver the production entrypoint builds (withFileProviderResolver), so a job that hashes or reads stored bytes behaves in tests as it does in production.
-->
