---
"@cosmicdrift/kumiko-feature-ast": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-testing": patch
---

Review fixes for the Biome guard move: temporal-polyfill is blocked as a whole, `no-date-api` and `unsafe-json-parse` close their gaps, the codemod judges scope by project-relative path, and the e2e Meilisearch teardown reads the app's `.env`.

<!-- kumiko-changes
feature: framework
type: fix
title: Biome preset closes temporal-polyfill completely and tightens plugin gaps
detail: noRestrictedImports now blocks every import from temporal-polyfill and temporal-polyfill/*, not only the Temporal name. no-date-api also flags optional calls (x?.toISOString(), x?.getTime()). unsafe-json-parse accepts JSON.parse in the try block of try/catch/finally. The allowlists of unsafe-json-parse, error-reasons and admin-api name the framework files by full path, so an app file with the same name no longer inherits the exception. lint-ignore-to-biome matches no-raw-hooks scope against the project-relative path from the plugin's own includes, lists trailing markers instead of converting them, and covers the remaining deleted guard slugs. The e2e Meilisearch teardown resolves MEILI_URL and MEILI_MASTER_KEY from webServer.env, then the app's .env files, then the default.
-->
