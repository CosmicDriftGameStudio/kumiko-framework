---
"@cosmicdrift/kumiko-testing": patch
---

`defineProdBootE2eConfig` boots the built `dist-server/server.js` against a database migrated by `dist-server/kumiko.js schema apply`, and `expectProdBootSecure` checks CSP, security headers and `/health` on it.

<!-- kumiko-changes
feature: testing
type: feature
title: Prod-boot e2e on the built server bundle
detail: `defineProdBootE2eConfig({ port, env?, serverEntry?, cliEntry?, testDir? })` returns a Playwright config with one webServer: it recreates the empty database `kumiko_prod_boot_<port>`, runs the built CLI's `schema apply` like the migrate initContainer, then imports the built server with `NODE_ENV=production`. Throwaway `PLATFORM_KEK`, `KUMIKO_BLIND_INDEX_KEY` and `SMTP_HOST` values are set unless the app env names them; `SUBJECT_KEYS_DATABASE_URL` defaults to the fresh database. `expectProdBootSecure(page)` asserts status 200, a `content-security-policy` header, `x-content-type-options: nosniff` and no CSP violation on `/`, and status 200 on `/health`.
migration: Add `playwright.prod-boot.config.ts` with `defineProdBootE2eConfig` and the app's port from `samples/e2e/e2e-ports.ts`, add one spec in `e2e-prod-boot/` that calls `expectProdBootSecure(page)`, and run that config after the app build.
-->
