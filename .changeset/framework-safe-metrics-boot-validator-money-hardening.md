---
"@cosmicdrift/kumiko-framework": patch
---

Several defensive-hardening fixes:

- `rehydrateMoney` now rejects a bigint/string DB amount that parses to an unsafe integer (`Number.isSafeInteger`), not just `NaN` — an amount above 2^53 previously slipped through as silently-wrong money math instead of throwing.
- `createSafeMetricsHandle` now also swallows a `buildMetricName` throw (invalid `featureName`), matching its existing contract of never turning an already-swallowed error into a thrown one.
- Boot validation now rejects an embedded-list field that sets both `required: true` and `minItems: 0` (the two contradict — `required` implies at least one row) and caps image-variant `size`/`maxEdge` at 8192px per edge plus validates `blur` (0..1000 sigma) and `blurRegions` (0..1 fractional bounds), so a malformed spec fails at boot instead of crashing or exhausting memory on first render.
- The job runner now downgrades its lock/queue/worker Redis `error` listeners to `debug` once `stop()` has been called — a graceful shutdown's own "Connection is closed" no longer shows up as an error-rate alert.
