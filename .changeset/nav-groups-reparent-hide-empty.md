---
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

An app can file navigation entries of other features, including bundled ones, under a group of its own: `reparentAppSchemaNavs(schema, overrides)` is exported from renderer-web and rewrites parent and order of the entries named by their qualified nav name, without filtering anything. `filterAppSchemaNavsByAllowlist` now uses it, its behaviour is unchanged. Behaviour change: `resolveNavigation` no longer renders a nav entry that has no `screen`, `target`, `provider`, `actions` or `createAction` unless at least one of its children is visible. That covers a pure group whose children are all hidden by access or filtered out (for example by an allowlist), and an entry that never had children and declares nothing to open. Before, both rendered as an empty, unclickable heading. Apps that filter the sidebar with an allowlist (for example offlot) lose such groups as soon as the allowlist leaves them without children; allow or re-parent at least one child, or give the entry a `screen`, to keep it.

<!-- kumiko-changes
feature: headless
type: improvement
title: resolveNavigation no longer renders empty groups or entries that open nothing
detail: A nav node with no screen, target, provider, actions and createAction is dropped when none of its children is visible, also when it never had children. Allowlisted sidebars lose groups whose children are all filtered out. Give the entry a screen or keep a child visible to retain it.
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: reparentAppSchemaNavs
detail: New exported helper that re-parents navs by qualified nav name, extracted from filterAppSchemaNavsByAllowlist.
-->
