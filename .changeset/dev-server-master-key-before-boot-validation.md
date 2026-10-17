---
"@cosmicdrift/kumiko-dev-server": patch
---

runDevApp resolves the masterKey provider before boot validation

<!-- kumiko-changes
feature: dev-server
type: fix
title: runDevApp resolves the masterKey provider before boot validation
detail: runDevApp validated encrypted fields before building the boot cipher, so an app that supplies masterKey and has no KUMIKO_SECRETS_MASTER_KEY_V1 in the environment booted in production but failed locally with no usable master key. The provider now reaches validateBoot like in runProdApp and runWorkerApp.
-->
