---
"@cosmicdrift/kumiko-bundled-features": patch
---

The tenant destruction sweep locks per tenant.

<!-- kumiko-changes
feature: tenant-lifecycle
type: fix
title: The tenant destruction sweep locks per tenant
detail: Overlapping sweeps no longer push a tenant into `destroyFailed`. Each sweep takes a session advisory lock per tenant and skips tenants another sweep holds for that tick; failed stage attempts and abandoned stages are now logged with tenant and stage.
-->
