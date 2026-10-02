---
"@cosmicdrift/kumiko-framework": patch
---

The Key Manager boot resolution now resolves all KEK slots in parallel, rejects a previous KEK without `PLATFORM_KEK_PREVIOUS_VERSION` before any Key Manager call, keeps the original network error as `cause`, and names the slot in the partial-wiring error. The boot log line names the source actually taken.

<!-- kumiko-changes
feature: framework
type: fix
title: Key Manager boot resolves slots in parallel, validates the previous-KEK version up front and keeps the fetch error as cause
-->
