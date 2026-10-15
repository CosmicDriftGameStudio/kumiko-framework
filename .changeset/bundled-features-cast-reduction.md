---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-cli": patch
---

Fewer unchecked casts in bundled features, dev-server, server-runtime, testing and cli

<!-- kumiko-changes
feature: framework
type: improvement
title: Fewer unchecked casts in bundled features, dev-server, server-runtime, testing and cli
detail: Casts are replaced by shared type guards, typed query rows and direct Bun typings. Behavior stays the same, except that a tier-resolver registration without a build() factory now fails with a clear error at boot, the kumiko CLI prints the thrown value of non-Error failures instead of "undefined".
-->
