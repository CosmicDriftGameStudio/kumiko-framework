---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-cli": patch
---

PR-review fix batch (careful-tier findings):

- `stock-cap-guard`'s `checkStockCap` no longer lets a caller-supplied `where.tenantId` override the real tenant scope (spread order fix).
- `defineCreateWithTenantDefaults` now validates `localeField` against the entity at define-time, matching the existing `currencyFields` check.
- `resolveMfaTokenSecrets` treats an empty-string override the same as `undefined` — falls back to derivation instead of signing MFA tokens with an empty HMAC key.
- `buildUpdateSchema` (schema-builder): a `""` submission for a `select` field with a default now maps to that default, not `null` — matches the insert path's "a field with a default is never unset" invariant, on both optional and required selects.
- `kumiko upgrade`'s enterprise-package changelog discovery is detected by `changes.json` presence, not an `"ai-"` name-prefix heuristic that silently dropped differently-named or renamed packages.
- **Deletion-request magic link** (`user-data-rights`): the verify token now goes in the URL fragment (`#token=`) instead of a query param, so it never lands in proxy/access logs — same convention as the export-download link.
- `InfinityList` (renderer-web) discards a response whose request was superseded by a newer one (request-sequence guard) — a slow response for an old search term can no longer overwrite a faster response for a newer one.
- `END_LABEL_MIN_ROWS` (renderer-web `DataTable`/`InfiniteSentinel`) aligned to the framework's default `pageSize` (50, was 20) so the "end of list" marker's default-case threshold matches reality; per-screen custom `pageSize` still isn't threaded down to this component (follow-up).
