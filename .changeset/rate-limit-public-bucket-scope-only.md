---
"@cosmicdrift/kumiko-framework": patch
---

429 bodies (`details.bucket` and the message) now carry only the bucket scope tag (`l1`, `http`, `l2`, `user`, `ip+handler`, `payload+handler`, ...) instead of IP, user/tenant id, auth target or payload digest. Fail-closed logging prints only the error message, since Redis errors can carry the bucket key. Redis keys are unchanged.

<!-- kumiko-changes
feature: framework
type: fix
title: 429 bodies carry only the rate-limit scope
-->
