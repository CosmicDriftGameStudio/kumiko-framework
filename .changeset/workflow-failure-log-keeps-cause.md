---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

Workflow failure logs show the original error

<!-- kumiko-changes
feature: workflow-runner
type: fix
title: Workflow run-failed and retry logs carry the original cause
detail: The ops log used to print the generic `workflow step N failed` wrapper. It now prints the underlying error, while the persisted event still carries the error class only.
-->
