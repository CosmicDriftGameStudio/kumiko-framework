---
"@cosmicdrift/kumiko-framework": minor
---

TenantDestroyHookResult: done:false now requires processed

<!-- kumiko-changes
feature: framework
type: breaking
title: TenantDestroyHookResult: done:false now requires processed
migration: |
  Tenant destroy hooks that return { done: false } must also return processed (number of items handled this tick). A tick with processed 0 now counts as a failed stage attempt.
-->
