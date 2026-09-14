---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`validateBoot` now warns (never throws) when `NODE_ENV=production` and the mounted feature list is missing one of `SECURITY_BASELINE_FEATURE_NAMES` (`sessions`, `crypto-shredding`, `rate-limiting`, `audit`; the list is exported from `@cosmicdrift/kumiko-framework/engine`); a new `securityBaselineFeatures({ includeSessions? })` preset (`@cosmicdrift/kumiko-bundled-features/presets`) mounts all four in one call, with `includeSessions: false` for apps that already pull `sessions` in via `dsgvoSelfServiceFeatures()`.
