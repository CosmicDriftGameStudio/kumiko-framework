---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-cli": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-samples": patch
---

New `kumiko api-docs` command writes developer docs for the HTTP API from the registry and the PAT scopes: `openapi.json` plus `overview.md`, `tokens.md` and one reference page per scope in en, de, es, fr and it. `--check` fails on gaps and on drift.

<!-- kumiko-changes
feature: agent-tools
type: improvement
title: kumiko api-docs generates HTTP API docs from the registry and the PAT scopes
detail: `kumiko api-docs [--out <dir>] [--locales en,de] [--check]` reads `kumiko.config.ts` and writes `<out>/openapi.json` (OpenAPI 3.1 with only the handlers some PAT scope reaches, one request wrapper per handler with a `type` discriminator), `<out>/<locale>/overview.md` (endpoints, body, envelopes, error codes with HTTP status, versions, lists, batches, safe retries), `<out>/<locale>/tokens.md` (create path from the app's nav labels, scope table, expiry, rate limit, errors, revoke, security, optional plan note) and `<out>/<locale>/reference/<scope>.md` (per handler: title, description, required grant, field table, curl example, recorded response), plus `<out>/index.json` with order, source versions and language independent anchor ids per heading. Output is plain GFM with only `title` and `description` in the frontmatter, so Astro and Starlight render it as is, and it is byte identical for the same input. New `AppConfig.apiDocs` options: `appName`, `baseUrl` (required), `locales`, `planNote`, `uiOnlyWrites` (pattern plus reason), `texts` (paragraph overrides per locale) and `examplesDir`. `--check` writes nothing and exits 1 when a handler in a scope has no description or no description translation (new gap kind `handlerWithoutDescriptionTranslation`, key `handlerDescriptionKey(qn)`), when a write that a screen triggers lies in no scope and is not listed in `uiOnlyWrites`, when a `uiOnlyWrites` entry matches nothing, or when the committed output differs. Known gap: the screen write check only looks at features with at least one handler in a scope. New exports: `frameworkErrorHttpStatus`, `FrameworkErrorCode`, `patAuthRejectHttpStatus`, `PAT_RATE_LIMITED_CODE`, `qnMatches`, `patAllows`, `handlerDescriptionKey`, `patScopesFromFeature`, `PAT_MAX_EXPIRES_IN_DAYS`, and `ApiExampleFileSchema` from `@cosmicdrift/kumiko-types/api-example`.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: recordApiExample records real API responses for the generated docs
detail: `recordApiExample(http, { name, dir, endpoint, body, token })` from `@cosmicdrift/kumiko-testing/api-examples` sends the request with the token as Bearer and returns status and body. With `KUMIKO_RECORD_API_EXAMPLES=1` it also writes `<dir>/<name>.json` with ids, timestamps, tokens, request ids and cursors replaced by stable placeholders and values under password, secret and mfaCode keys redacted. `kumiko api-docs` uses a recording for the example request and the example response of the matching handler. The recipe `samples/recipes/api-docs` shows the whole flow.
-->
