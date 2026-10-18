---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
---

Locked screens with a fallback stay in the schema of tenants without the feature

<!-- kumiko-changes
feature: personal-access-tokens
type: fix
title: Tenants whose tier excludes API tokens now reach the lockedFallbackScreen
detail: GET /api/schema removed every screen of a feature the tenant has switched off, and the role projection then dropped the navs of other features that pointed at them. The token list screen was gone, so the upgrade screen set via lockedFallbackScreen was never shown. Screens that declare a fallback (and the same-feature screens those fallbacks name) now stay in the schema; the server still rejects their queries and writes with feature_disabled, which makes the renderer show the fallback. Navs, content collections and workspaces of the disabled feature are still removed.
-->

<!-- kumiko-changes
feature: personal-access-tokens
type: improvement
title: The token list looks like any other Kumiko list
detail: The create button now sits in the page header next to the title, and an empty list shows the standard hint with a create button. The German title of the list screen is "API-Tokens" instead of "Personal Access Tokens", which also fixes the breadcrumb of the mint screen. Renderer, all apps: a projection list without an entity create button now shows its first primary toolbar action (one that needs no confirmation dialog) in the page header on desktop as well, with its label, instead of in the toolbar row; on phones it already did. On desktop only an icon derived from the action id (or declared on the action) is shown; the plus fallback exists only on phones. Consumers get this after the bump without code changes.
-->
