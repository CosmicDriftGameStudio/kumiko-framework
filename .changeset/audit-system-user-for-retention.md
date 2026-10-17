---
"@cosmicdrift/kumiko-bundled-features": patch
---

Audit retention events always use the system user

<!-- kumiko-changes
feature: audit
type: fix
title: Audit retention events always use the system user
detail: Events written by the audit feature no longer fall back to the calling user id and always record the system user.
-->
