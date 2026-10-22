---
"@cosmicdrift/kumiko-testing": patch
---

The e2e fixture keeps the Chromium HTTP cache on and enforces an app boot budget.

<!-- kumiko-changes
feature: testing
type: breaking
title: e2e tests fail after more than 8 app boots; the per-test client IP no longer disables the HTTP cache
detail: The test fixture sent the per-test X-Forwarded-For through context.route, which turns Chromium's HTTP cache off for the whole context, so every page.goto re-downloaded all assets and GET /api/schema. It now uses setExtraHTTPHeaders and the cache stays on. The fixture also counts GET /api/schema per test and fails a passing test that boots the app more than 8 times (default of the new maxAppBootsPerTest fixture option), and closes pages left open (window.open tabs) before the context closes.
migration: Seed through tenant.api, tenant.seed and tenant.addUser instead of calling page.goto(APP_BASE_PATH) before every seed; each page.goto reloads the app. runMatrix and runScreenshots boot the app once per test themselves, so they need no change; only your own scenario flows or specs that navigate on purpose raise the budget with test.use({ maxAppBootsPerTest: <n> }). Manual migration, there is no codemod. The X-Forwarded-For header is now sent on every request of the context, including cross-origin ones.
-->
