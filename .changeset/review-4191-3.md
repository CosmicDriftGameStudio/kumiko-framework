---
"@cosmicdrift/kumiko-testing": patch
---

API example recordings now redact more credential-like keys (`token`, `apiKey`, `authorization`, `credential`, `mfa`) and replace JWT-shaped strings.

<!-- kumiko-changes
feature: api-examples
type: fix
title: api example recordings redact tokens, api keys and JWTs
detail: The recording normalizer only masked values under keys matching `password|secret|mfaCode`, so an `accessToken`, `refreshToken`, `apiKey` or `authorization` value was committed and published verbatim. The key rule is now `password|secret|mfa|token|apikey|api_key|authorization|credential` (string values only; numeric fields such as `tokenCount` are untouched) and any JWT-shaped string in a value is replaced by a fixed placeholder. A recorded `token` field is now `REDACTED` instead of the `kpat_EXAMPLE` placeholder. The committed samples/recipes recordings contain no matching keys and are unchanged.
-->
