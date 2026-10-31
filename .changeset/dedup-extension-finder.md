---
"@cosmicdrift/kumiko-bundled-features": patch
---

The signup-handover and tenant-destruction-hold provider lookups share one internal helper. Behavior is unchanged.

<!-- kumiko-changes
feature: tenant-lifecycle
type: improvement
title: Shared lookup for single-provider extension points
detail: findSignupHandoverProvider and findTenantDestructionHoldProvider now go through one internal helper that returns the first registered usage whose options match the provider shape. Usages with other options are still skipped, and the result is undefined when none matches.
-->
