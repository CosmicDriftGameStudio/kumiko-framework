---
"@cosmicdrift/kumiko-guards": patch
---

Spawned `git` calls in `packages/guards/src/_lib/roots.ts` now share their environment-sanitizing allowlist with the new `git-env.ts` helper instead of duplicating it inline. No behavior change for consumers of this package.
