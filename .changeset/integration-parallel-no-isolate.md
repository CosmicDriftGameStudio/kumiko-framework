---
"@cosmicdrift/kumiko-testing": patch
---

kumiko-testing integration --parallel now also passes --no-isolate, so parallel integration workers no longer grow until they are OOM-killed

<!-- kumiko-changes
feature: testing
type: fix
title: Parallel integration runs no longer OOM-kill their workers
detail: |
  bun 1.4.0's --parallel implies --isolate, which leaks native memory per
  test file while the JS heap stays flat: about 4 MB per file for a bare
  setupTestStack, about 40 MB with bundled-features. In publicstatus
  (--parallel 4) each worker grew from ~290 to ~1000 MiB and the run died
  with exit 137 on the 3 GiB CI runner. With --no-isolate the same run
  peaks at 380 MiB and finishes in 28.9 s instead of 49.9 s, with no new
  failures. Without --parallel bun never isolated files, so the tests
  already isolate through data (seedTenant per flow, queue prefix per
  stack), not through processes.
-->
