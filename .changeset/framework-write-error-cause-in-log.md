---
"@cosmicdrift/kumiko-framework": patch
---

Write handlers that fail with a 5xx now log their original `cause` under `[api] handler failed`. Previously `reraiseAsKumikoError` rebuilt the error from the JSON-serializable `WriteErrorInfo`, which never carried a `cause`, so ops saw the wrapped message but not the underlying failure.

<!-- kumiko-changes
feature: framework
type: fix
title: Write-path 5xx logs now include the original cause chain
-->
