---
"@cosmicdrift/kumiko-guards": minor
---

test-timeouts flags literal Playwright timeouts and timeout raises on extended test objects.

<!-- kumiko-changes
feature: guards
type: breaking
title: test-timeouts flags literal Playwright timeouts and extended test objects
detail: In Playwright files (`e2e*/` directories and `*.spec.ts`), a number literal on a `timeout` option fails; use an `E2E_TIMEOUT_MS` class from `@cosmicdrift/kumiko-testing/e2e`. A one-argument `setTimeout(…)` or `slow()` on any test object there, such as one built with `test.extend(...)`, now counts as raising the timeout. Playwright config files are not checked.
migration: Replace literals with the value-equal class (10_000 → `E2E_TIMEOUT_MS.navigation`, 15_000 → `poll`, 30_000 → `test`; drop 5000 on expect, it is the default). Mark a justified raise with `// kumiko-lint-ignore test-timeouts #<issue> <reason>`.
affects: all
-->
