---
"@cosmicdrift/kumiko-server-runtime": patch
---

Boot hardening in server-runtime: shared database wait deadline, stricter master-key and file-storage validation, fatal handlers stay installed during fatal shutdown.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Boot validation and shutdown hardening
detail: The KMS and app database waits share one deadline so a boot never outlasts the liveness window. An app-supplied master key provider is checked at boot, also in a dry run. Additional fileStorage providers get the same production and S3 checks as the default one, and their env keys are validated. appOverrides without auth or delivery feature abort instead of being dropped. A fatal shutdown keeps its listeners installed, and inline script hashing handles a ">" inside quoted attributes.
-->
