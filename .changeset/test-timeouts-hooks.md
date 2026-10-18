---
"@cosmicdrift/kumiko-guards": minor
---

test-timeouts guard covers hook timeouts, recipes and scripts/bin tests

<!-- kumiko-changes
feature: guards
type: improvement
title: test-timeouts guard flags hook timeouts and scans recipes
detail: The test-timeouts guard now also fails on a timeout argument to beforeAll, beforeEach, afterAll and afterEach, as a number or as a { timeout } object, including renamed and namespace imports from bun:test. The samples/recipes exemption is gone, recipe tests and their e2e dirs are scanned like every other test. The kumiko.json of the framework repo scans tests under scripts and bin as well. There is no baseline.
-->
