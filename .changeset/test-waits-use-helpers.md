---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-testing": patch
---

Tests use the shared `waitFor` and `sleep` helpers instead of inline timeout promises.

<!-- kumiko-changes
feature: testing
type: fix
title: Tests use waitFor and sleep helpers instead of inline timers
detail: Fixed waits that back a TTL bound, an absence or an ordering gap use sleep with a reason; the combobox debounce test polls with waitFor.
-->
