---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Correctness fixes from PR review:

- `securePageHeaders` now spreads hardened security headers LAST so a caller's `extra` can never override CSP/nosniff/frame-options.
- `assertOriginGuardConfig` throws on the contradictory `unsafeSkipOriginCheck: true` + non-empty `allowedOrigins` combo instead of silently keeping the guard.
- Decimal write-schema scale check is now float-robust (`isRepresentableAtScale`): a computed-but-in-scale value like `0.1 + 0.2` is accepted at scale 2 instead of being falsely rejected.
- `createDecimalField` validates `precision`/`scale` at definition time (integer, `precision ≥ 1`, `0 ≤ scale ≤ precision`) instead of failing at migration time.
- ENV config bridge skips whitespace-only values and trims `select`/`text` values before option matching.
- `fenceLiveTable` rejects `lockTimeoutMs <= 0` (Postgres treats `lock_timeout = 0` as wait-forever, the opposite of fail-fast).
- Deletion verify-URL is built via `URL`/`searchParams` so a base URL with existing query params no longer produces an invalid `?a=b?token=`.
