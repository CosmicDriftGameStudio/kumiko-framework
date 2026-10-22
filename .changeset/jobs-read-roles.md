---
"@cosmicdrift/kumiko-bundled-features": minor
---

The jobs feature takes `readRoles` so app roles can read their tenant's job failures and runs.

<!-- kumiko-changes
feature: jobs
type: improvement
title: readRoles for tenant job status
detail: `createJobsFeature({ readRoles: ["PropertyManager"] })` lets those app roles call `jobs:query:failures` and `jobs:query:tenant-runs` for their own tenant. They are added to the default `User`, `Editor` and admin roles, which stay. Before, a member who only holds app roles got access_denied.
migration: Optional. Apps whose members hold only their own roles pass `createJobsFeature({ readRoles: [...] })`.
-->
