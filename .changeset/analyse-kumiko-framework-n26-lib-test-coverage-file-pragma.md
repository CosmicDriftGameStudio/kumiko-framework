---
"@cosmicdrift/kumiko-guards": patch
---

`lib-test-coverage` accepts one file-wide exception instead of a tag per export.

<!-- kumiko-changes
feature: guards
type: improvement
title: lib-test-coverage takes a file-wide exception
detail: `// kumiko-lint-ignore-file lib-test-coverage integration-covered via <path/to/x.test.ts>` in the leading comment of a lib file exempts all its exports. The cited test file must exist, as with the per-export tag. Per-export tags keep working.
-->
