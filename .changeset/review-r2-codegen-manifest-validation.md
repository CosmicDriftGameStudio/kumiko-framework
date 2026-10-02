---
"@cosmicdrift/kumiko-dev-server": patch
---

`kumiko-build` codegen now validates `feature-manifest.json`. A valid manifest that lists no write handlers removes the generated `WriteHandlerQn` and typed-dispatcher block instead of keeping a stale one. A broken manifest keeps the block and warns with its own "feature-manifest.json invalid" message.

<!-- kumiko-changes
feature: dev-server
type: fix
title: Codegen validates feature-manifest.json and only keeps the stale handler block when it is missing or invalid
-->
