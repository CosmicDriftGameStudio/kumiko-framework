---
"@cosmicdrift/kumiko-testing": patch
---

Browser requests in e2e shared one `per: "ip"` rate-limit bucket

Every Playwright client connects from `::1`. Since the client-IP resolver counts requests without `X-Forwarded-For` instead of skipping them, all browser pages of a parallel e2e run shared one `ip`/`ip+handler` bucket and hit load-dependent 429s on `/api/query`. The kumiko-testing `test` fixture now routes the browser context's same-origin `/api/**` requests through a synthetic `X-Forwarded-For` per test (run token + test id + repeat and retry index), so every test gets its own client IP, including browser logins. The per-user API contexts of `seedTenant` send their user's IP. The e2e webServer trusts exactly one hop (`defineAppE2eConfig`), and production is unchanged.

<!-- kumiko-changes
feature: testing
type: fix
title: e2e test fixture gives every test its own synthetic client IP
detail: |
  `test` from `@cosmicdrift/kumiko-testing/e2e` overrides the `context`
  fixture with a `context.route("**/api/**")` that adds
  `x-forwarded-for: syntheticClientIpFor(perTestClientIpKey(testInfo))` to
  same-origin requests; an explicit `x-forwarded-for` wins. Cross-origin
  requests stay untouched because an extra header would force a CORS
  preflight. Routing disables the HTTP cache of the test's context.
  `seedTenant`'s per-user API contexts send
  `syntheticClientIpFor(user.email)`. The built-in `request` fixture is not
  covered.
migration: |
  Specs that import `test` from `@cosmicdrift/kumiko-testing/e2e` need no
  change. Specs importing `test` straight from `@playwright/test` keep
  sharing the `::1` bucket; switch their import to kumiko-testing.
-->
