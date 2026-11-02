---
"@cosmicdrift/kumiko-bundled-features": patch
---

The hanging-account recovery test no longer abandons its own recovery sync under CI load.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: hanging-account test recovers without the artificial 150ms deadline
detail: The recovery poll of `watch-supervisor-hanging-account.integration.test.ts` ran with the 150ms deadline meant for the hung fetches, so a slow CI run abandoned the real sync (status degraded, nothing imported). Recovery now uses a supervisor with the default deadline, and the test also asserts a fresh fetch per tick, so a skipped tick fails it.
-->
