---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`admin-shell`'s `tenant-overview` and `platform-overview` screens now use declarative `dashboard` screens (`kind: "stat"` panels) instead of custom React components — both render through the generic renderer. Fixes the platform-overview "undefined" tile bug: `tenant:query:list` and `jobs:query:list` didn't return `total` even with `totalCount: true` requested, because their Zod schemas stripped the field before the handler ever saw it.

Adds `DashboardStatPanel.params` (`@cosmicdrift/kumiko-types`) — static, author-set query parameters merged under the panel's dynamic `filterParams` (`@cosmicdrift/kumiko-renderer-web`'s dashboard body now does that merge).

Additive query-handler changes: `tenant:query:list` and `jobs:query:list` accept `totalCount: boolean` and return `total` when set (`jobs:query:list`'s total is a real count, not `rows.length`, so it isn't capped by `limit`); `config:query:readiness` gains `missingCount`/`missingTone` alongside the existing `missing` array.

`PlatformOverviewScreen`/`TenantOverviewScreen` and their supporting `overview-layout`/`overview-query` modules are gone (never public exports — the renderer selects screens by `screen.type`, not a client component registry). The `overview-allowlist` exports (`isOverviewQueryAllowed`, `overviewAllowedQueries`, the allow/forbidden-list constants) stay — they're now checked against the screen definitions in tests instead of gating a client-side dispatch call.
