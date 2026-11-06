---
"@cosmicdrift/kumiko-bundled-features": patch
---

The tenant-lifecycle test for an entity override that holds a tenant no longer fails when the scheduled sweep finishes the destruction while the job queue drains.

<!-- kumiko-changes
feature: tenant-lifecycle
type: fix
title: Held-tenant destruction test tolerates the scheduled sweep finishing first
detail: After the retention job releases a destroyHeld tenant, the scheduled sweep may already have moved it on to destroyed. The test now accepts destroying or destroyed and only asserts the retention override while the status is still destroying, reading the overrides first so the check stays meaningful.
-->
