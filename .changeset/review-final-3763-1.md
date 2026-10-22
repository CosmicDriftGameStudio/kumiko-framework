---
"@cosmicdrift/kumiko-testing": patch
---

Added `consoleCallsFromNamespace` to the testing helpers so "stays silent" tests count every console call of a logger namespace instead of one message text.

<!-- kumiko-changes
feature: testing
type: feature
title: consoleCallsFromNamespace test helper for silent-log assertions
detail: Filters a console spy by logger namespace prefix, so a new or reworded warning from the module under test fails a silent test. The boot-validator, client-ip and settings-hub silent tests use it.
-->
