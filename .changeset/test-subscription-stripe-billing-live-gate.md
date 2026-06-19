---
"@cosmicdrift/kumiko-framework": patch
---

Harden the subscription-stripe billing-live (`#104`) test coverage. The
invariant "no live checkout while `billing-live` is not true" was only ever
exercised with a stubbed `ctx.config` — no test drove the real
factory → `r.config` → `ctx.config(handle)` chain. A reviewer also flagged the
`runtime.test.ts` fixture for hand-redeclaring the config handles (which could
silently drift from production) and for a key-agnostic `config` mock that hid a
wrong handle name.

- Integration scenario 6 mounts subscription-stripe **without** the api-key
  fallback and proves the gate end-to-end: `billing-live` unset → checkout
  fails `feature_disabled`; setting `billing-live=true` on the canonical config
  QN flips the gate (the failure moves to `unconfigured` at api-key resolution).
  The positive case is what actually proves handle-resolution — a wrong handle
  name would keep `ctx.config` `undefined` and the error would stay
  `feature_disabled`.
- `runtime.test.ts` now derives the config handle names from the canonical
  constants via the same `qn`/`toKebab` qualifier `r.config` applies, so the
  fixture cannot drift, and its `config` mock answers only for the billing-live
  handle so a misread key is caught.

Test-only plus a corrected doc comment (the billing-live key qualifies to
`subscription-stripe:config:billing-live`, not `…:billingLive`).
