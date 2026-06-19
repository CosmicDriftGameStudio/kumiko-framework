---
"@cosmicdrift/kumiko-framework": patch
---

Add the missing `runDevApp` origin-guard forwarding test (#399/1). `runDevApp`
forwards `allowedOrigins`/`unsafeSkipOriginCheck` to the server exactly like
`runProdApp`, but only the prod path had a test — a typo or wrong spread-key on
the dev path would silently drop the fail-closed CSRF guard and let dev/prod
diverge. The new `run-dev-app.integration.test.ts` mirrors the prod pair:
`cookieDomain` alone rejects with `allowedOrigins is empty`, and
`cookieDomain + allowedOrigins` boots cleanly past the guard. It is an
integration test because the guard fires during server build, after the
ephemeral test DB is up.
