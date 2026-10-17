---
"@cosmicdrift/kumiko-framework": patch
---

Read steps no longer warn about narrowed tenant filters for in/eq operator objects

<!-- kumiko-changes
feature: framework
type: fix
title: No false narrowing warning for where.tenantId given as { in } or { eq }
detail: The read.findOne and read.findMany steps unwrap operator-form tenant filters ({ in: [...] } and { eq }) before comparing them with the caller's tenant scope, and stay silent for operator forms they do not understand.
-->
