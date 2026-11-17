---
"@cosmicdrift/kumiko-guards": patch
---

The test-timeout guard also flags a `timeout` in the options object before the test body.

<!-- kumiko-changes
feature: guards
type: improvement
title: Test-timeout guard checks the options argument
detail: `test(name, { timeout: 15000 }, fn)`, `it(...)` and `describe(...)` with a `timeout` property in the second argument (object literal or a typed variable that has `timeout`) raised the timeout without a finding, because only arguments after the body were checked. They are now reported like a trailing timeout argument. Playwright details without `timeout` (`{ tag }`, `{ annotation }`) and untyped test bodies stay allowed.
migration: Remove the `timeout` from the options object and fix the slow setup, or add `// @timeout-exception: #<issue> <reason>` above the test.
-->
