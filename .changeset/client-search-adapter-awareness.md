---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

The client `AppSchema` now carries `FeatureSchema.searchAdapterMissing`, set from the same `context.searchAdapter` presence check that already powers #2051's boot warning. `kumiko-screen.tsx`'s `entityList` search box is gated on it: when the server has no `SearchAdapter` wired, the box no longer renders at all, instead of rendering and then 422'ing on the first query (`search_adapter_not_wired`, #2032). Scoped to `entityList` screens only, matching #2051's own boot-check scope — `projectionList` screens are unaffected. Non-breaking: the flag defaults to "not missing" wherever a schema doesn't flow through `buildAppSchema()` (hand-authored fixtures, legacy `toAppSchema()`), preserving today's render behavior.
