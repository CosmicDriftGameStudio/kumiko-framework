---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": minor
---

`bookCapUsage` and `markCapSoftWarned` now re-read and retry when they lose an optimistic-lock race, so parallel bookings for the same cap period all count instead of failing or getting silently dropped. `withCapEnforcement` now throws on a failed booking instead of discarding the result. The `outsideTransaction` booking path now runs each retry attempt in its own transaction via the new framework export `runInOwnTransaction` (`@cosmicdrift/kumiko-framework/db`), so its event append and projection update stay atomic per attempt.
