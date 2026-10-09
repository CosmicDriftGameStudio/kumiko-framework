---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Tenant destroy stages resume partial progress in the next sweep tick instead of burning failed attempts

A tenant with tens of thousands of files used to exhaust the stage's three attempts and leave the DSGVO destroy stuck. Destroy hooks (`destroyTenant`, EXT_TENANT_DATA `destroy`) may now return `{ done: false, processed }` and receive `deadlineAt` in their ctx; the runner records a `tenant-destruction-stage-progressed` event in the tenant stream and continues the stage next tick without counting a failed attempt. Hooks returning nothing stay valid. The `fileRef` row purge and the storage prefix wipe work in chunks against that deadline.

<!-- kumiko-changes
feature: tenant-lifecycle
type: improvement
title: Tenant destroy stages resume partial progress next tick; hooks may return { done: false } and get deadlineAt; file hooks work in chunks
-->
