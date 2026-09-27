---
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": patch
---

E2e logins started 429ing after the client-IP resolver landed (kumiko-framework#3323): every Playwright client is on `::1`, so the default `trustedProxyHops` (0, socket-only) collapsed every seeded user's login into one shared rate-limit bucket instead of one per user

`defineAppE2eConfig`'s `webServer` now sets `KUMIKO_TRUSTED_PROXY_HOPS=1` (template-owned, added to `RESERVED_ENV_KEYS`), and `loginViaApi` sends a deterministic per-email `X-Forwarded-For` so each seeded user gets their own bucket, the same way a real client behind one trusted reverse-proxy hop would.

<!-- kumiko-changes
feature: framework
type: improvement
title: parseTrustedProxyHopsEnv/TRUSTED_PROXY_HOPS_ENV factored out of runProdApp for runDevApp and consumer tooling to share
detail: |
  `packages/framework/src/api/client-ip.ts` gained
  `parseTrustedProxyHopsEnv(raw, context)` and the
  `TRUSTED_PROXY_HOPS_ENV = "KUMIKO_TRUSTED_PROXY_HOPS"` constant (both
  exported via the `api` barrel), moved out of `runProdApp`'s inline
  parsing. Same validation and error message as before.
migration: |
  No action needed; runProdApp's behavior and error message are unchanged.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: runDevApp now also honors KUMIKO_TRUSTED_PROXY_HOPS as an env fallback, symmetric to runProdApp
detail: |
  Precedence: `options.trustedProxyHops ?? effectiveAuth?.trustedProxyHops
  ?? parseTrustedProxyHopsEnv(envSource[TRUSTED_PROXY_HOPS_ENV], "runDevApp")`.
migration: |
  No action needed for the default (unproxied) dev setup.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runProdApp's KUMIKO_TRUSTED_PROXY_HOPS parsing now shares framework's parseTrustedProxyHopsEnv
detail: |
  The inline digits-only + non-negative-integer validation moved out of
  `run-prod-app.ts` into `parseTrustedProxyHopsEnv`
  (`@cosmicdrift/kumiko-framework/api`); same validation and error message
  as before, no behavioral change.
migration: |
  No action needed.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: defineAppE2eConfig reserves KUMIKO_TRUSTED_PROXY_HOPS; loginViaApi sends a synthetic per-user X-Forwarded-For
detail: |
  `defineAppE2eConfig`'s `webServer.env` now sets
  `KUMIKO_TRUSTED_PROXY_HOPS=1` and rejects that key in a consumer's own
  `env` (template-owned, added to `RESERVED_ENV_KEYS`). `loginViaApi` sends
  `x-forwarded-for: syntheticClientIpFor(credentials.email)`, a new
  exported helper deriving a deterministic private-range IP from
  `sha256(email)`, so each seeded user's login lands in its own
  rate-limit bucket instead of every ::1 client sharing one.
  `loginViaUi` is unchanged.
migration: |
  Consumers using `defineAppE2eConfig` + `loginViaApi` (incl. the
  `seedTenant` fixture) need no changes — each seeded user now logs in
  from its own bucket. Browser logins (`loginViaUi`, raw `fetch` to
  `/api/auth/login` from a page) still share the `::1` bucket. A consumer
  with its own e2e login helper (bypassing `loginViaApi`) should send
  `x-forwarded-for: syntheticClientIpFor(email)` (exported from
  `@cosmicdrift/kumiko-testing`) themselves, and must not set
  `KUMIKO_TRUSTED_PROXY_HOPS` in `defineAppE2eConfig`'s `env` — it's now
  reserved.
-->
