---
"@cosmicdrift/kumiko-guards": patch
---

The Error-Reasons guard treats the `reason` of `subjectForgetAfterDeleteHook({ ... })` as prose, like the escape-hatch and createTenantDb reasons, so a sentence literal there no longer fails the guard.

<!-- kumiko-changes
feature: guards
type: fix
title: Error-Reasons guard accepts a prose reason in subjectForgetAfterDeleteHook
detail: The reason is the forget-subject audit reason and part of the hook's systemIdentity escape-hatch reason, not an error-reason code. Apps no longer need a constant to get past the guard.
-->
