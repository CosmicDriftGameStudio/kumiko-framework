---
"@cosmicdrift/kumiko-dev-server": patch
---

Scaffolded `src/seed.ts` now carries a `// skip:` comment above its idempotency check, so freshly generated apps pass `kumiko-guard-silent-skip` in CI out of the box.
