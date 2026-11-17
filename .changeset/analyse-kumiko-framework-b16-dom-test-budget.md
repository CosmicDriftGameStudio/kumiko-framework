---
"@cosmicdrift/kumiko-testing": patch
---

`TEST_TIMEOUT_MS.dom` is 5000 ms, and the scaffolded `test:dom` script reads it.

<!-- kumiko-changes
feature: testing
type: fix
title: One DOM test budget of 5 s
detail: DOM tests (`*.test.tsx`) had three budgets: 5 s in the framework's own `test:dom`, 15 s in `TEST_TIMEOUT_MS.dom` and in the local check pipeline, and the unit constant in the scaffolded `test:dom` script. `TEST_TIMEOUT_MS.dom` is now 5000 and the scaffold reads `TEST_TIMEOUT_MS.dom`, so a DOM test gets the same budget in the scaffold, the check pipeline and CI. The scaffold output does not change, because the unit budget is 5000 too.
migration: Apps whose `test:dom` script passes `--timeout=15000` switch to `--timeout=5000` and speed up DOM tests that need longer instead of raising the budget.
-->
