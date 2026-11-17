---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

The boot-validator tests are split by rule into separate files.

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot-validator tests split by rule
detail: The single 7,400-line `boot-validator.test.ts` is split into one test file per checked area under `engine/boot-validator/__tests__/`, next to the rule modules. Test names drop internal task references, and the env-dependent cases set their variables through `withEnv`. Runtime behaviour does not change.
-->
