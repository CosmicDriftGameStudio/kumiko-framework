---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
---

runProdApp, runDevApp and runWorkerApp forward validateBootOptions to validateBoot (fw#3080)

All three run-app entrypoints called `validateBoot(features)` without options, so only `createApp` could pass a `navAllowlist` or `warnOnUniqueAccessRoles` through. An app could declare the option, test it against `validateBoot` directly and see green — while the process it actually boots never received it. The three option types now carry an optional `validateBootOptions`, passed straight through in the same shape `createApp` already uses. `ValidateBootOptions` is exported from `@cosmicdrift/kumiko-framework/engine` so consumers can type the value. Omitting it leaves boot behaviour unchanged.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: runProdApp, runDevApp and runWorkerApp forward validateBootOptions to validateBoot (fw#3080)
-->
