---
"@cosmicdrift/kumiko-guards": patch
---

kumiko-pre-push refuses a standalone push without a package.json test script with a clear message

Previously the standalone branch ran bun run test unconditionally, so a repo without a test script only saw bun's Script not found error. The hook still fails closed (exit 1) but now names the missing script and the PRE_PUSH_SKIP escape.

<!-- kumiko-changes
feature: guards
type: fix
title: kumiko-pre-push refuses a standalone push without a package.json test script with a clear message
-->
