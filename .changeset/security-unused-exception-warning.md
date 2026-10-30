---
"@cosmicdrift/kumiko-guards": patch
---

`kumiko-guards security` now warns about repo-local security exceptions that suppressed no advisory in the run, so withdrawn advisories no longer linger as stale entries (bundled exceptions never warn).

<!-- kumiko-changes
feature: guards
type: improvement
title: Security check warns about unused repo exceptions
detail: kumiko-guards security lists every exception from the repo's dependency-security-exceptions.json that suppressed no advisory in the run, with package, advisory and file. The warning does not block; exceptions bundled with the guards package never warn because they cover consumers that may not have the package. Remove the listed entries once the advisory is fixed or withdrawn.
-->
