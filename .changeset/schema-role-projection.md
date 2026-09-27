---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

GET /api/schema now returns a per-role projection instead of the full AppSchema to every authenticated user

`buildAppSchema`'s output previously shipped every screen, nav, workspace and content-collection to any signed-in caller, regardless of role — a screen's own `access` rule only ever hid it in the UI, never removed it from the payload a curious client could still read. `projectAppSchemaForRoles` now strips every screen/nav/workspace/content-collection reference the caller's roles can't see (screens, nav entries, row/toolbar/related-list actions, entityEdit redirects, dashboard panels and metric navigation targets, tree actions, workspace nav membership) before the route serializes a response, closing empty parent nav sections and workspaces left with no surviving members along the way. Entities and translations are still shipped in full — the projection is a UI-visibility concern, not an entity-authorization concern; the dispatcher's `hasAccess` default-deny check is unchanged.

The route now builds the full schema lazily once per process and caches the projected JSON/ETag per canonical (deduplicated, sorted) role set — tenant is deliberately not part of the cache key, since the projection only depends on roles.

`isUiAccessGranted` is the new shared default-visible UI predicate in `@cosmicdrift/kumiko-types`, re-exported through `framework/ui-types`. The renderer's `screenAccessAllows` is now an alias of it, and headless nav resolution and renderer-web's workspace filter call it directly instead of carrying their own copies.

A deep link to a screen the caller's roles no longer receive now shows the "screen not found" banner instead of the access-denied banner, because the screen is no longer part of that caller's schema.

<!-- kumiko-changes
feature: framework
type: improvement
title: GET /api/schema now returns a per-role projection instead of the full AppSchema to every authenticated user
-->
