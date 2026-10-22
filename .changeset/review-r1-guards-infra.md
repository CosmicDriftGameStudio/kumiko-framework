---
"@cosmicdrift/kumiko-guards": patch
---

Guards infrastructure hardening: pre-push scans the pushed shas, the guard run slot dir must be private, the manifest walk stops at the git root.

<!-- kumiko-changes
feature: guards
type: fix
title: Harden guards infrastructure (pre-push scan range, slot dir, root walk)
detail: The pre-push secret scan covers every pushed ref instead of HEAD. The guard slot directory is created 0700 and ignored when not private; slot max age is 2 h. findLocalRepo no longer picks up a kumiko.json above the git root. Runtime-isolation keeps web/dev/ files as client.
-->
