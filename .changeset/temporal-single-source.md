---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

One Temporal implementation: `@cosmicdrift/kumiko-types/temporal`

The new export returns the native `globalThis.Temporal` when the runtime has it (Bun 1.4, current browsers) and falls back to `temporal-polyfill` otherwise, installing it on `globalThis`. Framework, bundled features and renderers import from there, so values made by the framework pass `instanceof` and `z.instanceof(Temporal.Instant)` checks in app code. `ensureTemporalPolyfill()` puts the same instance on the global. Apps should import `Temporal` from `@cosmicdrift/kumiko-types/temporal` instead of `temporal-polyfill`.

<!-- kumiko-changes
feature: types
type: improvement
title: New @cosmicdrift/kumiko-types/temporal export resolves one Temporal (native first, polyfill as fallback) for framework and app code
migration: Replace imports from "temporal-polyfill" with "@cosmicdrift/kumiko-types/temporal" so app code and framework share one set of Temporal classes.
-->
