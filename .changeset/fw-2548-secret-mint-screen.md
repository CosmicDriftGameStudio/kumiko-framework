---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-headless": minor
---

fw#2548: new `secretMint` screen type for "mint → one-time reveal → confirm" flows — an API token, recovery codes, or any other secret that a write-handler hands back only once in its success payload. `actionForm` can't express this: it discards the success payload after extracting the navigation id, and no query can ever redisplay a secret that was never stored in the clear. `secretMint` renders the same field/section form as `actionForm`, then swaps to a one-time reveal card built from `reveal.fields` — a whitelist of success-payload fields, never the payload as a whole — with an explicit confirm before navigating on. The revealed values live only in the form component's own state, never in the URL, a query cache, or nav. `TextFieldDef` grows a `format: "password"` render hint (masked input, no storage semantics) — such a field is also excluded from a wizard's persisted draft blob, so it is never written to the server in the clear or restored on resume — and the renderer ships a new `SecretReveal` primitive for the reveal card (falls back to `Grid`/`GridCell` when a platform hasn't registered one).

`personal-access-tokens` is migrated onto it end to end: the former dormant `type: "custom"` screen (a hand-written client component) is now two declarative screens — a `projectionList` for "your tokens" (with a `revoke` row action) and the new `secretMint` for minting one, wired through `patGrantOptions`/`patScopeOptionTranslations`. No app needs a client plugin for this feature anymore.

**BREAKING**

1. `personal-access-tokens:query:mine` now returns the paged envelope `{ rows, nextCursor }` instead of a blank array. Migration: callers read `response.rows`. The handler also newly accepts `limit`/`sort`/`sortDirection` and each row carries a computed `status` (`"active" | "revoked" | "expired"`).

2. The subpath export `@cosmicdrift/kumiko-bundled-features/personal-access-tokens/web` is gone (`personalAccessTokensClient()`, `PatTokensScreen`, `defaultTranslations`). The PAT screens are declarative now and need no client plugin. Migration: remove the `personalAccessTokensClient()` entry from `createKumikoApp({ clientFeatures: [...] })`; an app that embedded `<PatTokensScreen embedded />` directly should navigate to the feature's `api-tokens` screen instead.
