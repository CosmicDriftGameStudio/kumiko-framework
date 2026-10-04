---
"@cosmicdrift/kumiko-framework": minor
---

`isFailedWriteResult` and `FailedWriteResult` are exported from the pipeline entry

Consumers can narrow a `WriteResult` to its failure branch with `import { isFailedWriteResult } from "@cosmicdrift/kumiko-framework/pipeline"` instead of re-implementing the check.

<!-- kumiko-changes
feature: framework
type: improvement
title: isFailedWriteResult is exported from the pipeline entry
-->
