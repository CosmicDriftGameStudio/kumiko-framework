---
"@cosmicdrift/kumiko-renderer": minor
---

returnTo restores the host screen's search params and nests return chains

A `returnTo` value may now carry the host's search params as a nested query (`token-detail/abc?tab=keys&orders.sort=name`), so jumping back lands on the tab, filter and sort the user left — `use-list-url-state` keys and `layout.mode: "tabs"` included, with no per-key allowlist to keep in sync. The host's own `returnTo` travels inside that snapshot, so a chain (list → edit → action form → back → save) unwinds one level per jump instead of losing its tail. Two syntactic caps bound the URL: at most three screen levels per value, and a snapshot over 512 characters is dropped whole. Both degrade to the previous bare value rather than failing, and a value without a snapshot is byte-identical to before, so existing links keep working. Target validation is unchanged: `resolveReturnTarget` sees only the path part and still rejects anything that is not an accessible in-app screen.

<!-- kumiko-changes
feature: renderer
type: improvement
title: returnTo restores the host screen's search params and nests return chains
-->
