---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Writing PII to an erased data subject answers 409 `subject_erased`, rebinding a hook's unsafeRaw grant no longer inherits db.global() writes, jobs wait for boot gates before consuming

A write that has to encrypt a personal field for a subject whose key was erased (crypto-shredding) now fails with a `ConflictError` (409, reason `subject_erased`, i18n in en and de) instead of a 500, on the executor write path and in `encryptForDirectWrite`. A hook's own `unsafeRaw` grant (`withUnsafeRawGrant`) no longer carries the handler's `globalWrites` grant. The job runner starts its BullMQ worker only after the boot gates passed, so a job queued by a previous run cannot execute against an unmet boot precondition. `buildServer` warns at boot when `r.systemScope()` features exist but no RateLimitResolver is configured. The auth, MFA, PAT, change-email and request-deletion handlers declare only the escape-hatch grants they use.

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: Writing a personal field of an erased data subject answers 409 subject_erased instead of 500
-->

<!-- kumiko-changes
feature: jobs
type: fix
title: The job worker starts consuming only after the boot gates passed
-->
