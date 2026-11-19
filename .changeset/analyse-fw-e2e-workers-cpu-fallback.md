---
"@cosmicdrift/kumiko-testing": patch
---

`defineAppE2eConfig` no longer hands Playwright `NaN` workers when `availableParallelism()` returns no usable number.

<!-- kumiko-changes
feature: testing
type: fix
title: E2E worker count falls back to os.cpus()
detail: Under Bun, `availableParallelism()` reads `globalThis.navigator`; a library that replaces it (pdfjs did in an app) made the result `NaN`, and Playwright hung without a message on "NaN workers". `resolveE2eWorkers` now falls back to `os.cpus().length` and throws a clear error naming `KUMIKO_E2E_WORKERS` when neither source yields a positive integer. A set `KUMIKO_E2E_WORKERS` still wins and needs no CPU count. Nothing to do for apps.
-->
