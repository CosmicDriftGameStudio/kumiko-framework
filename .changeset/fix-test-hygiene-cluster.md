---
"@cosmicdrift/kumiko-framework": patch
---

Test-hygiene cluster (review findings):

- **silent-pass (#377/1):** `renderer-web-css-relocation` integration test uses `test.skipIf(!bunAvailable())` instead of `if (!bunAvailable()) return;`, so a missing `bun` is reported as a visible skip rather than a green pass that hides lost coverage.
- **fragile async flush (#315/2):** `custom-fields-form-section` test waits via `waitFor(...)` instead of two hardcoded `await Promise.resolve()` ticks — robust against an extra microtask in the async save loop.
- **unsafe-cast (#380/1):** documents why the `undefined as never` redis/entityCache stubs are safe in the seed-migration runner test (that path uses neither dependency).
