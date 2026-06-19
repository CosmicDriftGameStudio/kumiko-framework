---
"@cosmicdrift/kumiko-framework": patch
---

Two missing-test coverage gaps from review (test-only):

- subscription-stripe `parseStoredSecret`: the error path was untested — the test
  stub always JSON-encoded its values, so a malformed (raw, non-JSON) stored
  credential never exercised `parseJsonOrThrow`. Added a raw-secret stub and a
  test asserting `clientForCtx` throws `Invalid JSON in subscription-stripe
  credential` rather than silently degrading (#393/2).
- encrypted-tenant-config recipe: the recipe's headline claim — that a `mask`
  entry alone makes `buildConfigFeatureSchema` derive the configEdit screen (no
  hand-written `r.screen`/`r.nav`) — was unverified. Added a test asserting the
  `billing-tenant` screen carries `configKeys["stripe-api-key"]` (qualified) and
  the `mask.title` field label (#392/1).
