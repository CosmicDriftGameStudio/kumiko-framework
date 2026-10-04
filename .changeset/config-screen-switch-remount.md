---
"@cosmicdrift/kumiko-renderer": patch
---

Settings screens show their stored values after switching screens

Moving from one generated settings screen to another kept the previous screen's form state, so the fields of the new screen rendered empty and a select showed no active option even though a tenant value was set. Each config and secrets screen now mounts its own form.

<!-- kumiko-changes
feature: renderer
type: fix
title: Switching between generated config screens no longer shows empty fields for stored values
-->
