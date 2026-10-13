---
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

An app can file navigation entries of other features, including bundled ones, under a group of its own: `reparentAppSchemaNavs(schema, overrides)` is exported from renderer-web and rewrites parent and order of the entries named by their qualified nav name, without filtering anything. `filterAppSchemaNavsByAllowlist` now uses it, its behaviour is unchanged. A nav entry that only groups (no screen, target, provider or create action) is hidden when all of its children are hidden or absent, so a group no longer shows up empty for users who may open none of its entries. Apps that filter the sidebar with an allowlist (for example offlot) lose such groups from the tree as soon as the allowlist leaves them without children; allow or re-parent at least one child to keep the group.

<!-- kumiko-changes
feature: headless
type: improvement
title: resolveNavigation hides empty groups
detail: A nav node without screen, target, provider and createAction is dropped when none of its children is visible, also for a group that was childless to begin with. Allowlisted sidebars lose groups whose children are all filtered out.
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: reparentAppSchemaNavs
detail: New exported helper that re-parents navs by qualified nav name, extracted from filterAppSchemaNavsByAllowlist.
-->
