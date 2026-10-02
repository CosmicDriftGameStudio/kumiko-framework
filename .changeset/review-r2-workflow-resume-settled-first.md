---
"@cosmicdrift/kumiko-bundled-features": patch
---

The workflow-runner's resume-run handler now checks whether a run is already settled before resolving the workflow definition. A second resume tick racing a finished run no longer appends a `run-failed` event after `run-completed` when the definition changed or was removed meanwhile. The `runId` payload is validated as a UUID, and the due-runs SELECT drops its ineffective `FOR UPDATE SKIP LOCKED`.

<!-- kumiko-changes
feature: workflow-runner
type: fix
title: resume-run no longer appends run-failed to an already settled run
-->
