---
"@cosmicdrift/kumiko-testing": patch
---

`@cosmicdrift/kumiko-testing/e2e` exports `SERVICE_ENV_DEFAULTS`, the local service URLs and keys of the test stack.

<!-- kumiko-changes
feature: testing
type: improvement
title: SERVICE_ENV_DEFAULTS from kumiko-testing/e2e
detail: `defineAppE2eConfig` keeps Meilisearch opt-in and hands the webServer only the service env it owns, so an app whose boot requires `MEILI_MASTER_KEY` or derives a value from `DATABASE_URL` in its Playwright config had no local default and failed to start unless the shell exported the values. Such an app now passes `MEILI_URL: process.env["MEILI_URL"] ?? SERVICE_ENV_DEFAULTS.MEILI_URL` (and the like) in `env`; shell and CI values still win.
-->
