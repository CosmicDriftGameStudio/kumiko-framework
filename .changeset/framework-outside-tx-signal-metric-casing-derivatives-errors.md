---
"@cosmicdrift/kumiko-framework": patch
---

- `ctx.dbOutsideTransaction` no longer inherits the request's `AbortSignal`. It's built for durability writes that must survive the handler's own transaction rolling back (e.g. after a long paid provider call the client already gave up on) — inheriting the signal made it throw `AbortError` on exactly the disconnected-client case it exists for. `ctx.db` still gets the signal as before.
- `buildMetricName` now normalizes the feature name through `toKebab()` before snake-casing it, so a camelCase feature (e.g. `defineFeature("aiFoundation")`) calling `r.metric()` no longer fails boot — it resolves to the same `kumiko_ai_foundation_*` prefix as its kebab-case equivalent.
- `derivatives.variant()` now throws typed `NotFoundError` (missing/incomplete `fileRef` row) and `InternalError` (no renderer registered for the mimeType) instead of plain `Error`, so write-handler callers get a `404`/`500` HTTP status instead of a generic `500` for all three cases. The renderer error's client-visible message no longer lists the registered renderer names — that detail now travels in the (server-only) error `details`.
