---
"@cosmicdrift/kumiko-guards": patch
---

Guard review fixes: the secret-literal check tracks block comments across lines, matches the secret name only left of the fallback, supports `kumiko-lint-ignore secret-literal`, and no longer prints the literal; `loadSecurityBaseline` returns an invalid result instead of throwing on a bad repo name; plus smaller message, scope and URL-literal fixes in the loadAllEvents, escape-hatch and process-env guards.

<!-- kumiko-changes
feature: guards
type: fix
title: secret-literal guard no longer leaks literals and handles block comments
-->
