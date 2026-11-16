---
"@cosmicdrift/kumiko-cli": patch
---

kumiko-cli depends on framework, bundled-features and renderer directly.

<!-- kumiko-changes
feature: cli
type: improvement
title: kumiko-cli declares framework, bundled-features and renderer as dependencies
detail: The three packages were optional peer dependencies, but dev-server and server-runtime, which kumiko-cli depends on, install them anyway, and several commands import them statically. They are regular dependencies now and the missing-peer hint is gone. sharp stays an optional peer for `kumiko handbuch build`. kumiko-cli also depends on create-kumiko-app, whose scaffold `kumiko new app` uses.
-->
