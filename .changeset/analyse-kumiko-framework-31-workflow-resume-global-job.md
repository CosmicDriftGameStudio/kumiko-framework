---
"@cosmicdrift/kumiko-bundled-features": patch
---

The workflow resume job runs once per minute over all tenants instead of once per tenant.

<!-- kumiko-changes
feature: workflow-runner
type: fix
title: Workflow resume job runs one global pass
detail: `workflow-runner:job:resume-due-runs` ran per tenant every minute, and each tenant pass read the due rows of every tenant through the system db and dispatched them as its own tenant. It now runs one pass over all tenants, takes the 100 oldest due rows and dispatches `resume-run` as the system user of each row's tenant.
-->
