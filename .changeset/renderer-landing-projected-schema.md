---
"@cosmicdrift/kumiko-renderer-web": patch
---

A pure SystemAdmin (or any caller whose visible screens are all role-restricted) landed on a "no-open-screen" error banner in fetch mode

`AppSchemaBoundary`'s landing fallback (`screenQn ?? firstOpenScreenQn(app.features)`) assumed the fetched `GET /api/schema` still contained the caller's role-restricted screens, but that schema is already role-projected server-side — invisible screens and navs are removed before the client ever sees them. A caller left with only role-restricted screens (e.g. a pure `SystemAdmin`) got `firstOpenScreenQn` returning `undefined` and saw the error banner instead of their app.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Landing fallback for a role-projected fetched schema now considers every nav-reachable screen, not just open-to-all ones
detail: |
  New export `firstLandingScreenQnForProjectedSchema(features)`: tries
  `firstOpenScreenQn(features)` first (so regular users keep today's
  landing), then falls back to the first nav-reachable screen regardless
  of `access` (the server already removed anything the caller's roles may
  not see). `AppSchemaBoundary` now takes a `schemaIsRoleProjected: boolean`
  prop; `KumikoAppRoot` passes `isFetchMode`. The sync path
  (`options.schema`/injected `__KUMIKO_SCHEMA__`, unprojected, pre-auth)
  is unchanged and still strict.
migration: |
  No action needed — this only affects the fetch-mode landing fallback and
  widens it, it never narrows an existing landing choice.
-->
