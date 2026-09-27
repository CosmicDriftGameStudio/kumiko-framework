---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

AppSchema now leaves the server only via an authenticated GET /api/schema

<!-- kumiko-changes
feature: server-runtime
type: breaking
title: Static fallback no longer injects __KUMIKO_SCHEMA__ into HTML
migration: |
  `HostDispatchResult.injectSchema` is deprecated and ignored — HTML never
  carries the schema anymore, in prod or dev. `createKumikoApp` now fetches
  the schema itself from the authenticated `GET /api/schema` after its
  clientFeature gates (e.g. an auth gate) let rendering through, so a
  signed-in admin app keeps working without changes. Anything that read
  `window.__KUMIKO_SCHEMA__` directly (custom clients, e2e fixtures) must
  switch to fetching `/api/schema` instead. An anonymously reachable page
  that used to render schema-based screens needs `createPublicSurface`,
  which never carries a schema. The `@cosmicdrift/kumiko-server-runtime/inject-schema`
  subpath export is removed.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: New GET /api/schema route
detail: |
  Behind the existing `/api/*` auth guard. A signed-in, non-anonymous user
  gets the built `AppSchema` as JSON with `Cache-Control: private, no-cache`
  and a strong `ETag`; a matching `If-None-Match` gets a bodyless 304 (still
  behind the same auth check, so an anonymous request with a stolen/guessed
  ETag still 401s instead of getting a 304). Anonymous or missing auth gets
  the same 401 `unauthenticated` response shape as every other non-public
  route.
-->

<!-- kumiko-changes
feature: dev-server
type: breaking
title: Dev-server HTML no longer injects __KUMIKO_SCHEMA__ either
migration: |
  Same semantics as the prod change: `DevHostDispatchResult.injectSchema`
  is deprecated and ignored. The dev-server's auto-mint mode still sets
  the `kumiko_auth`/`kumiko_csrf` cookies on the HTML response, so a
  client-side fetch to `/api/schema` is authenticated immediately without
  a real login round-trip.
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: createKumikoApp loads the schema after the auth gate, with loading/error states
detail: |
  When neither `options.schema` nor `window.__KUMIKO_SCHEMA__` is set,
  `createKumikoApp` now fetches the schema from `GET /api/schema` itself,
  only after its clientFeature gates let rendering through (so an
  unauthenticated visitor never triggers the request). While the fetch is
  in flight a minimal loading placeholder renders; a 401/403 shows a clear
  "sign in required" message with no auto-retry; any other failure shows a
  retry button. Losing schema access mid-session (a gate withdrawing
  children, e.g. on logout) resets the fetched schema so the next mount
  re-fetches instead of reusing a previous session's — important once
  schemas become role-dependent. An explicit `options.schema` never resets
  this way.
-->
