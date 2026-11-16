---
"@cosmicdrift/kumiko-bundled-features": patch
---

A workflow with an idempotencyKey now starts at most one run per key and tenant.

<!-- kumiko-changes
feature: workflow-runner
type: fix
title: idempotencyKey prevents a second run
detail: `defineWorkflow({ idempotencyKey })` promised to prevent duplicate runs, but a later trigger event with the same key started another run on the same `workflow-run` stream and re-ran every side-effect step. The event trigger now skips a trigger whose run stream already exists in that tenant, whether the first run completed, is suspended or failed.
-->
