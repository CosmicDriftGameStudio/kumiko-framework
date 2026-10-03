---
"@cosmicdrift/kumiko-dev-server": patch
---

The framework repo's own install and CI now resolve `ip-address` to 10.7.3, which fixes GHSA-rpw4-54j3-4h4q, GHSA-2vr4-cq9g-pvrc, GHSA-j6r3-76f7-8jcv and GHSA-h3mg-xc3c-68pw. The override does not ship to consumers: apps get `ip-address` through `bundled-features > imapflow > socks` and need their own lockfile refresh to reach 10.7.3. `braces` GHSA-vfj7-8cjw-p6xm has no patched release yet, so it gets a short-lived security exception. braces is only reached through build tooling. The integration test for ephemeral dev-server job queues now checks only its own boot's Redis keys, so dev-server boots running in parallel test processes no longer fail it.

<!-- kumiko-changes
feature: dev-server
type: fix
title: ip-address raised to 10.7.3, braces advisory excepted, ephemeral queue cleanup test isolated from parallel boots
-->
