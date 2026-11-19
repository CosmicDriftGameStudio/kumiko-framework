---
"@cosmicdrift/kumiko-guards": minor
---

A lib-test-coverage ignore tag must name the covering test file, and the file must exist.

<!-- kumiko-changes
feature: guards
type: breaking
title: lib-test-coverage ignore tags cite an existing test file
detail: `// kumiko-lint-ignore lib-test-coverage <reason>` exempts an exported lib function only when the reason names at least one `*.test.ts` or `*.test.tsx` file and every named file exists among the scanned tests. A repo-relative path or a bare file name both match by path suffix. A tag without a cited file, or with a file that does not exist, is reported on the function.
migration: Name the covering test in each lib-test-coverage tag, e.g. `// kumiko-lint-ignore lib-test-coverage integration-covered via src/__tests__/lease.integration.test.ts`, or write a unit test for the function.
affects: lib-test-coverage
-->
